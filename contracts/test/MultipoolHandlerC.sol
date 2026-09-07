// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Layer C handler: shared mutualized reserve under cross-pool contention.
///
/// Setup: 3 identical 30-day pools, each 1000 SCALE principal.
///   All principal drawn (anchor draw at t=6D, never repaid).
///   All 3 pools declared Default at t=36D (maturity).
///   Reserve seeded at 1000 SCALE = 1/3 of combined 3000 SCALE principal shortfall.
///   → Genuine first-come-first-served contention: pool[0] consumes the reserve,
///     pool[1] and pool[2] are clamped (drawn=0 < requested).
///
/// Ghost accounting model (per-pool / per-flow):
///   ghost_reserveReceived[i]  tracks drawReserve returns attributed to pool i
///   ghost_directReceived[i]   tracks direct MULTISIG USDC attributed to pool i
///   ghost_totalDraws          cumulative drawReserve returns across all pools
///   ghost_totalTopUps         cumulative topUp amounts (0 in Default-only campaign)
///   ghost_clampCount          times drawn < requested (contention proof)
///
/// Invariants tested by MultipoolInvariantsC:
///   LC1  reserve conservation: reserveBalance == initial + topUps - draws
///   LC2  no cross-pool bleed: covered[i] == direct[i] + reserve[i] (per-pool exact)
///   LC3  draw accounting closes: sum(reserveReceived) == totalDraws
///   LC4  no overdraw, monotonic settlement, non-negative draws
///
/// ── Panic-catch pattern ───────────────────────────────────────────────────
///   try X { } catch Panic(uint256 code) { _recordPanic(code, site); } catch {}
/// Do NOT regress to bare catch{} only — typed Panic fires first.
/// ─────────────────────────────────────────────────────────────────────────
contract MultipoolHandlerC is Test {

    // ── Constants ──────────────────────────────────────────────────────────
    uint256 constant SCALE   = 1e12;
    uint256 constant D       = 86400;
    uint256 constant WAD     = 1e18;
    uint256 constant N_POOLS = 3;

    // Reference model economics: 1/3 coverage forces genuine contention
    uint256 constant POOL_PRINCIPAL = 1_000 * SCALE;
    uint256 constant RESERVE_SEED   = 1_000 * SCALE; // < 3000 total shortfall

    // ── Actors ────────────────────────────────────────────────────────────
    address public LP_A     = address(0xAAAA);
    address public MULTISIG = address(0x1111);
    address public DEPLOYER = address(0x2222);
    address public AGENT1   = address(0x3333);
    address public AGENT2   = address(0x4444);
    address[N_POOLS] public PSPs;

    // ── Contracts ─────────────────────────────────────────────────────────
    MockStablecoin  public usdc;
    TreasuryReserve public treasury;
    PoolFactory     public factory;
    PoolContract[N_POOLS] public pools;

    // ── Ghost: LC reserve accounting ──────────────────────────────────────
    uint256 public ghost_reserveInitial;
    uint256 public ghost_totalTopUps;
    uint256 public ghost_totalDraws;
    uint256[N_POOLS] public ghost_reserveReceived; // per-pool: sum of drawReserve returns
    uint256[N_POOLS] public ghost_directReceived;  // per-pool: sum of direct MULTISIG payments
    uint256 public ghost_clampCount;               // draws where drawn < requested

    // Covered amounts recorded immediately after declareDefault (before any settlement)
    uint256[N_POOLS] public ghost_preDefaultCollected;

    // ── Ghost: fault detection ────────────────────────────────────────────
    bool   public ghost_panicDetected;
    string public ghost_panicInfo;
    bool   public ghost_bleedDetected;
    string public ghost_bleedInfo;

    // ── Pool-isolation snapshot (LC-equivalent of LB2) ────────────────────
    struct PoolSnap {
        uint256 usdcBal;
        uint256 collectedPrincipal;
        uint256 collectedYield;
        uint256 collectedOverrunYield;
        uint256 outstanding;
    }
    PoolSnap[N_POOLS] internal _snap;
    uint256 internal _snapTarget;
    bool    internal _snapTaken;

    // ── Constructor ───────────────────────────────────────────────────────
    constructor() {
        vm.warp(1 * D);

        for (uint256 i = 0; i < N_POOLS; i++) {
            PSPs[i] = address(uint160(0x6000 + i));
        }

        usdc = new MockStablecoin();
        PoolContract impl = new PoolContract();

        // Non-zero risk params: 10% reserve rate so topUp fires if any pool
        // closes normally (won't happen in this campaign, but ghost_totalTopUps tracks it).
        treasury = new TreasuryReserve(
            address(usdc), MULTISIG,
            1e17,           // reserveRate 10%
            10_000 * SCALE, // reserveTarget
            WAD,            // hurdleFrac 100%
            0               // lpBonusShare 0
        );

        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * 86400, // maxFundingDurationSecs (30 days)
            25e16,  // fundingExecBufferDays (0.25 WAD)
            3,      // maxGracePeriodDays
            1,      // minDdDays
            7      // maxDdDays
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));

        for (uint256 i = 0; i < N_POOLS; i++) {
            vm.prank(MULTISIG);
            factory.approvePsp(PSPs[i]);
        }

        usdc.mint(LP_A,     5_000 * SCALE);
        usdc.mint(MULTISIG, 100_000 * SCALE);
        for (uint256 i = 0; i < N_POOLS; i++) {
            usdc.mint(PSPs[i], 10_000 * SCALE);
        }

        // Create 3 identical 30-day pools (matches reference model params)
        // APR check: 5e16 × (5+0.25+30)*D = 5e16 × 35.25*D = 1.523e23
        //            ≤ utilRate(5e14) × 365 × 30 × D = 4.73e23 ✓
        for (uint256 i = 0; i < N_POOLS; i++) {
            vm.prank(DEPLOYER);
            address pa = factory.createPool(PoolFactory.CreatePoolParams({
                pspWallet:        PSPs[i],
                fundingDurationSecs: 5 * 86400,
                softCap:          1 * SCALE,
                hardCap:          9_000_000 * SCALE,
                tenure:           30,
                idleRateDaily:    5e14,
                utilizedRateDaily: 5e14,
                penaltyRateDaily: 1e15,
                penaltyGraceDays: 2,
                minDeposit:       0,
                aprAnnual:        5e16,
                agent1:           address(0x3333),
                agent2:           AGENT2,
                multisig:         MULTISIG
            }));
            pools[i] = PoolContract(pa);

            vm.prank(LP_A);    usdc.approve(pa, type(uint256).max);
            vm.prank(MULTISIG);usdc.approve(pa, type(uint256).max);
            vm.prank(PSPs[i]); usdc.approve(pa, type(uint256).max);
        }

        // Deposit 1000 SCALE per pool (funding window t=1D..6D)
        for (uint256 i = 0; i < N_POOLS; i++) {
            vm.prank(LP_A);
            pools[i].deposit(POOL_PRINCIPAL);
        }

        // Finalize all pools at t=6D (poolFinalityTs = 6D+30D = 36D)
        vm.warp(6 * D);
        for (uint256 i = 0; i < N_POOLS; i++) {
            pools[i].finalizeFunding();
        }

        // Anchor draw: draw ALL principal from each pool, NOT repaid.
        // expiryTs = 6D + 1D = 7D; well overdue by maturity at t=36D.
        // availableToDd = 0 → accIdleFees stays 0 (no idle-fee accumulation).
        for (uint256 i = 0; i < N_POOLS; i++) {
            bytes32 ref = keccak256(abi.encode("LC-ANCHOR", i));
            vm.prank(AGENT2);
            pools[i].executeDrawdown(ref, PSPs[i], POOL_PRINCIPAL, 1);
        }

        // Warp to maturity (t = 36D) and declare default on all pools.
        // At t=36D exactly: _accrueExtensionYield returns immediately (t<=maturity),
        // so overrunYield=0. availableToDd=0 → collectedPrincipal=0 after default.
        // outstanding = POOL_PRINCIPAL = 1000 SCALE per pool.
        vm.warp(36 * D);
        for (uint256 i = 0; i < N_POOLS; i++) {
            vm.prank(AGENT2);
            pools[i].declareDefault();
        }

        // Record pre-default covered amounts (all 0 in this setup)
        for (uint256 i = 0; i < N_POOLS; i++) {
            ghost_preDefaultCollected[i] = pools[i].collectedPrincipal()
                + pools[i].collectedYield()
                + pools[i].collectedOverrunYield();
        }

        // Seed reserve: 1000 SCALE below total 3000 SCALE shortfall.
        // Ownable's _owner at slot 0; reserveBalance at slot 1.
        usdc.mint(address(treasury), RESERVE_SEED);
        vm.store(address(treasury), bytes32(uint256(1)), bytes32(RESERVE_SEED));

        ghost_reserveInitial = RESERVE_SEED;
    }

    // ── Internal helpers ───────────────────────────────────────────────────

    function _poolIdx(uint256 seed) internal pure returns (uint256) {
        return seed % N_POOLS;
    }

    function _recordPanic(uint256 code, string memory site) internal {
        if (!ghost_panicDetected) {
            ghost_panicDetected = true;
            ghost_panicInfo = string.concat(
                "LAYERC PANIC code=", vm.toString(code),
                " in ", site,
                " (17=overflow 18=div-by-zero 50=array-OOB)"
            );
        }
    }

    // Snapshot non-target pools before an op. Excludes treasury (shared, legitimately changes).
    function _snapBefore(uint256 target) internal {
        _snapTarget = target;
        _snapTaken  = true;
        for (uint256 i = 0; i < N_POOLS; i++) {
            if (i == target) continue;
            PoolContract p = pools[i];
            _snap[i] = PoolSnap({
                usdcBal:               usdc.balanceOf(address(p)),
                collectedPrincipal:    p.collectedPrincipal(),
                collectedYield:        p.collectedYield(),
                collectedOverrunYield: p.collectedOverrunYield(),
                outstanding:           p.outstanding()
            });
        }
    }

    // Verify non-target pools unchanged after op.
    function _snapAfter() internal {
        if (!_snapTaken) return;
        _snapTaken = false;
        if (ghost_bleedDetected) return;

        for (uint256 i = 0; i < N_POOLS; i++) {
            if (i == _snapTarget) continue;
            PoolContract  p = pools[i];
            PoolSnap memory s = _snap[i];
            string memory pre = string.concat(
                "LC-snap: pool[", vm.toString(_snapTarget),
                "] op bled into pool[", vm.toString(i), "]: "
            );

            if (usdc.balanceOf(address(p)) != s.usdcBal) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "usdcBal"); return;
            }
            if (p.collectedPrincipal() != s.collectedPrincipal) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "collectedPrincipal"); return;
            }
            if (p.collectedYield() != s.collectedYield) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "collectedYield"); return;
            }
            if (p.collectedOverrunYield() != s.collectedOverrunYield) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "collectedOverrunYield"); return;
            }
            if (p.outstanding() != s.outstanding) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "outstanding"); return;
            }
        }
    }

    // ── Handler: settleDefaultPrincipal ───────────────────────────────────
    function handler_settleDefaultPrincipal(uint256 pSeed, uint256 directAmtSeed) external {
        uint256 idx = _poolIdx(pSeed);
        PoolContract p = pools[idx];
        if (p.status() != PoolContract.Status.Default) return;

        uint256 owed = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        if (owed == 0) return;

        // pct ∈ [0,100]: fraction of owed covered directly by MULTISIG
        uint256 pct       = bound(directAmtSeed, 0, 100);
        uint256 directAmt = owed * pct / 100;

        // directUsed = min(directAmt, owed); requested = remainder → goes to reserve
        uint256 directUsed = directAmt < owed ? directAmt : owed;
        uint256 requested  = owed - directUsed;

        if (directUsed > 0 && usdc.balanceOf(MULTISIG) < directUsed) {
            usdc.mint(MULTISIG, directUsed);
        }

        uint256 cpBefore   = p.collectedPrincipal();
        uint256 rBalBefore = treasury.reserveBalance();

        _snapBefore(idx);

        bool settled = false;
        vm.prank(MULTISIG);
        try p.settleDefaultPrincipal(directAmt) {
            settled = true;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_settleDefaultPrincipal");
        } catch {}

        if (!settled) { _snapAfter(); return; }

        uint256 cpAfter   = p.collectedPrincipal();
        uint256 rBalAfter = treasury.reserveBalance();

        uint256 drawn        = rBalBefore > rBalAfter ? rBalBefore - rBalAfter : 0;
        uint256 toppedUp     = rBalAfter > rBalBefore ? rBalAfter - rBalBefore : 0;
        uint256 paid         = cpAfter - cpBefore;
        uint256 directActual = paid > drawn ? paid - drawn : 0;

        ghost_reserveReceived[idx] += drawn;
        ghost_directReceived[idx]  += directActual;
        ghost_totalDraws           += drawn;
        ghost_totalTopUps          += toppedUp;

        // Clamp: reserve returned less than was requested
        if (requested > 0 && drawn < requested) ghost_clampCount++;

        _snapAfter();
    }

    // ── Handler: settleDefaultYield ───────────────────────────────────────
    function handler_settleDefaultYield(uint256 pSeed, uint256 directAmtSeed) external {
        uint256 idx = _poolIdx(pSeed);
        PoolContract p = pools[idx];
        if (p.status() != PoolContract.Status.Default) return;
        if (p.collectedPrincipal() < p.principal()) return; // principal must be whole first

        uint256 yieldShort   = p.yieldOwed() > p.collectedYield()
            ? p.yieldOwed() - p.collectedYield() : 0;
        uint256 overrunShort = p.overrunYield() > p.collectedOverrunYield()
            ? p.overrunYield() - p.collectedOverrunYield() : 0;
        uint256 owed = yieldShort + overrunShort;
        if (owed == 0) return;

        uint256 pct       = bound(directAmtSeed, 0, 100);
        uint256 directAmt = owed * pct / 100;

        uint256 directUsed = directAmt < owed ? directAmt : owed;
        uint256 requested  = owed - directUsed;

        if (directUsed > 0 && usdc.balanceOf(MULTISIG) < directUsed) {
            usdc.mint(MULTISIG, directUsed);
        }

        uint256 cyBefore   = p.collectedYield() + p.collectedOverrunYield();
        uint256 rBalBefore = treasury.reserveBalance();

        _snapBefore(idx);

        bool settled = false;
        vm.prank(MULTISIG);
        try p.settleDefaultYield(directAmt) {
            settled = true;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_settleDefaultYield");
        } catch {}

        if (!settled) { _snapAfter(); return; }

        uint256 cyAfter   = p.collectedYield() + p.collectedOverrunYield();
        uint256 rBalAfter = treasury.reserveBalance();

        uint256 drawn        = rBalBefore > rBalAfter ? rBalBefore - rBalAfter : 0;
        uint256 toppedUp     = rBalAfter > rBalBefore ? rBalAfter - rBalBefore : 0;
        uint256 paidYield    = cyAfter - cyBefore;
        uint256 directActual = paidYield > drawn ? paidYield - drawn : 0;

        ghost_reserveReceived[idx] += drawn;
        ghost_directReceived[idx]  += directActual;
        ghost_totalDraws           += drawn;
        ghost_totalTopUps          += toppedUp;

        if (requested > 0 && drawn < requested) ghost_clampCount++;

        _snapAfter();
    }

    // ── Handler: warpTime ─────────────────────────────────────────────────
    function handler_warpTime(uint256 days_) external {
        days_ = bound(days_, 0, 5);
        vm.warp(block.timestamp + days_ * D);
    }

    // ── Break-test helpers ────────────────────────────────────────────────

    // Phantom credit: inflate pool[0] ghost receipt without a real draw.
    // LC2 fires (covered_0 != ghost_0); LC3 fires (sum > totalDraws).
    function helper_injectPhantomBleed_forTest() external {
        ghost_reserveReceived[0] += RESERVE_SEED;
        // ghost_totalDraws NOT updated → sum(ghost) > totalDraws → LC3 fires
    }

    // Swap attribution: swap pool[0] and pool[1] ghost receipts.
    // LC2 fires for both (misattribution); LC3 holds (sum unchanged).
    function helper_injectSwapBleed_forTest() external {
        uint256 tmp = ghost_reserveReceived[0];
        ghost_reserveReceived[0] = ghost_reserveReceived[1];
        ghost_reserveReceived[1] = tmp;
    }

    // ── View helpers ───────────────────────────────────────────────────────
    function poolStatus(uint256 idx) external view returns (PoolContract.Status) {
        return pools[idx].status();
    }
}
