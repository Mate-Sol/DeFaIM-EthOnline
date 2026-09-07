// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Layer B handler: multi-pool economic independence.
///
/// Drives 3 pools through their full economic lifecycle simultaneously.
///
/// Pool layout:
///   pool[0] tenure=365d, pgd=2, softCap=1 SCALE  — long, sustained cycling
///   pool[1] tenure=365d, pgd=2, softCap=1 SCALE  — identical to pool[0] (LB3)
///   pool[2] tenure=30d,  pgd=0, softCap=5 SCALE  — short, matures at t≈36D
///
/// Pool[2] anchor draw (constructor, NOT tracked in refs/ddActive):
///   POOL2_ANCHOR_REF drawn for 2 SCALE, settleDays=7 → expiryTs=13D.
///   After t=13D: _hasOverdueUnsettled()=true → new draws on pool[2] blocked.
///   After t=36D: any call triggers:
///     _accrueExtensionYield → overrunYield (outstanding=2 SCALE > 0)
///     _accrueIdleFees       → accPenalty   (accIdleFees > 0, pgd=0)
///
/// ── Panic-catch pattern ───────────────────────────────────────────────────
///   try X { } catch Panic(uint256 code) { _recordPanic(code, site); } catch {}
///
/// Do NOT regress to bare catch{} only — that swallowed real bugs previously.
/// ─────────────────────────────────────────────────────────────────────────
contract MultipoolHandlerB is Test {

    // ── Constants ──────────────────────────────────────────────────────────
    uint256 constant SCALE   = 1e12;
    uint256 constant D       = 86400;
    uint256 constant WAD     = 1e18;
    uint256 constant N_POOLS = 3;
    uint256 constant N_REFS  = 3;

    // Hidden anchor: drawdown on pool[2] NOT in refs[2][k] / ddActive[2][k].
    // The handler's overdue-clear and repay loops cannot touch it.
    bytes32 constant POOL2_ANCHOR_REF = bytes32("POOL2_ANCHOR");

    // ── Actors ────────────────────────────────────────────────────────────
    address public LP_A     = address(0xAAAA);
    address public LP_B     = address(0xBBBB);
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

    // ── Drawdown tracking ─────────────────────────────────────────────────
    bytes32[N_REFS][N_POOLS] public refs;
    bool[N_REFS][N_POOLS]    public ddActive;

    // ── Ghost: economic coverage counters ─────────────────────────────────
    uint256 public ghost_drawSuccessCount;              // executeDrawdown successes
    uint256 public ghost_repaySuccessCount;             // repay successes (handler + overdue-clear)
    uint256 public ghost_claimSuccessCount;             // claimYield + claimPrincipal successes
    uint256 public ghost_overdueCount;                  // overdue drawdowns found in handler_draw
    uint256 public ghost_crossPoolOpsWhileOtherMidDraw; // op on X while Y has outstanding>0
    uint256 public ghost_checksWithOverrunYield;        // _updateGhosts where any pool overrunYield>0
    uint256 public ghost_checksWithAccPenalty;          // _updateGhosts where any pool accPenalty>0
    uint256 public ghost_checksWithAccIdleFees;         // _updateGhosts where any pool accIdleFees>0
    uint256 public ghost_maxSimultaneousActive;
    uint256 public ghost_identicalParamsDiverged;       // pool[0]/pool[1] states differ

    // ── Ghost: draw failure breakdown (diagnostic) ────────────────────────
    uint256 public ghost_draw_notActive;    // status != Active at entry
    uint256 public ghost_draw_availSmall;   // availableToDd < 1 SCALE after overdue-clear
    uint256 public ghost_draw_noFreeSlot;   // all N_REFS slots occupied
    uint256 public ghost_draw_execFail;     // executeDrawdown caught
    uint256 public ghost_draw_calls;        // total handler_draw invocations

    // ── Ghost: fault detection ────────────────────────────────────────────
    bool   public ghost_bleedDetected;
    string public ghost_bleedInfo;
    bool   public ghost_panicDetected;
    string public ghost_panicInfo;

    // ── LB2 snapshot ──────────────────────────────────────────────────────
    struct PoolSnap {
        uint256 usdcBal;
        uint256 principal;
        uint256 outstanding;
        uint256 collectedPrincipal;
        uint256 collectedYield;
        uint256 claimedPrincipal;
        uint256 claimedYield;
        uint256 accIdleFees;
        uint256 yieldOwed;
        uint256 protocolFees;
    }

    PoolSnap[N_POOLS] internal _snap;
    uint256 internal _snapTarget;
    bool    internal _snapTaken;

    // ── Constructor ───────────────────────────────────────────────────────
    constructor() {
        vm.warp(1 * D);

        for (uint256 i = 0; i < N_POOLS; i++) {
            PSPs[i] = address(uint160(0x5000 + i));
        }

        // Unique ref slots per pool: poolIdx*10 + slotIdx + 1
        for (uint256 i = 0; i < N_POOLS; i++) {
            for (uint256 j = 0; j < N_REFS; j++) {
                refs[i][j] = bytes32(uint256(i * 10 + j + 1));
            }
        }

        usdc = new MockStablecoin();
        PoolContract impl = new PoolContract();

        treasury = new TreasuryReserve(
            address(usdc), MULTISIG,
            0,   // reserveRate 0%
            0,   // reserveTarget 0
            WAD, // hurdleFrac 100%
            0    // lpBonusShare 0
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

        usdc.mint(LP_A,     10_000_000 * SCALE);
        usdc.mint(LP_B,     10_000_000 * SCALE);
        usdc.mint(MULTISIG, 50_000_000 * SCALE);
        for (uint256 i = 0; i < N_POOLS; i++) {
            usdc.mint(PSPs[i], 50_000_000 * SCALE);
        }

        // ── Pool 0 & 1: long tenure=365d, pgd=2 ──────────────────────────
        // APR check: 5e16 × (5+0.25+365+2)*D = 5e16 × 372.25*D = 1.608e24
        //            ≤ utilRate(5e14) × 365 × 365 × D = 5.754e24 ✓
        for (uint256 i = 0; i < 2; i++) {
            vm.prank(DEPLOYER);
            address pa = factory.createPool(PoolFactory.CreatePoolParams({
                pspWallet:         PSPs[i],
                fundingDurationSecs: 5 * 86400,
                softCap:           1 * SCALE,
                hardCap:           9_000_000 * SCALE,
                tenure:            365,
                idleRateDaily:     5e14,
                utilizedRateDaily: 5e14,
                penaltyRateDaily:  1e15,
                penaltyGraceDays:  2,
                minDeposit:        0,
                aprAnnual:         5e16,
                agent1:            address(0x3333),
                agent2:            AGENT2,
                multisig:          MULTISIG
            }));
            pools[i] = PoolContract(pa);
        }

        // ── Pool 2: short tenure=30d, pgd=0 (matures at 6D+30D=36D) ─────
        // APR check: 5e16 × (5+0.25+30)*D = 5e16 × 35.25*D = 1.523e23
        //            ≤ utilRate(5e14) × 365 × 30 × D = 4.73e23 ✓
        {
            vm.prank(DEPLOYER);
            address pa = factory.createPool(PoolFactory.CreatePoolParams({
                pspWallet:         PSPs[2],
                fundingDurationSecs: 5 * 86400,
                softCap:           5 * SCALE,
                hardCap:           9_000_000 * SCALE,
                tenure:            30,
                idleRateDaily:     5e14,
                utilizedRateDaily: 5e14,
                penaltyRateDaily:  1e15,
                penaltyGraceDays:  0,
                minDeposit:        0,
                aprAnnual:         5e16,
                agent1:            address(0x3333),
                agent2:            AGENT2,
                multisig:          MULTISIG
            }));
            pools[2] = PoolContract(pa);
        }

        // Unlimited approvals: every actor → every pool
        for (uint256 i = 0; i < N_POOLS; i++) {
            address pa = address(pools[i]);
            vm.prank(LP_A);    usdc.approve(pa, type(uint256).max);
            vm.prank(LP_B);    usdc.approve(pa, type(uint256).max);
            vm.prank(MULTISIG);usdc.approve(pa, type(uint256).max);
            vm.prank(PSPs[i]); usdc.approve(pa, type(uint256).max);
        }

        // ── Pre-fund: deposits during funding window (t=1D..6D) ──────────
        // Large deposits relative to the per-draw cap (10 SCALE) ensure the
        // fuzzer can cycle draw→repay→draw hundreds of times per pool.
        vm.prank(LP_A); pools[0].deposit(1000 * SCALE);   // pool[0]: 1000 SCALE
        vm.prank(LP_B); pools[1].deposit(1000 * SCALE);   // pool[1]: 1000 SCALE
        vm.prank(LP_A); pools[2].deposit(1200 * SCALE);   // pool[2]: 1200 SCALE (>= softCap=5)

        // ── Pre-finalize: warp to fMaturityTs=6D and lock all pools ──────
        // pool[0,1]: poolFinalityTs = 6D + 365D = 371D
        // pool[2]:   poolFinalityTs = 6D + 30D  =  36D
        vm.warp(6 * D);
        pools[0].finalizeFunding();
        pools[1].finalizeFunding();
        pools[2].finalizeFunding();

        // ── Pool 2 anchor draw: hidden drawdown ───────────────────────────
        // POOL2_ANCHOR_REF is NOT in refs[2][k] → handler can never repay it.
        // pool[2] after this: outstanding=2 SCALE, availableToDd=1198 SCALE.
        // anchor expiryTs = 6D + 7D = 13D.
        // After t=13D: _hasOverdueUnsettled()=true → new draws blocked.
        // After t=36D: any pool[2] call triggers overrunYield & accPenalty.
        vm.prank(AGENT2);
        pools[2].executeDrawdown(POOL2_ANCHOR_REF, PSPs[2], 2 * SCALE, 7);
    }

    // ── Internal helpers ───────────────────────────────────────────────────

    function _poolIdx(uint256 seed) internal pure returns (uint256) {
        return seed % N_POOLS;
    }

    function _lp(uint256 seed) internal view returns (address) {
        return seed % 2 == 0 ? LP_A : LP_B;
    }

    function _recordPanic(uint256 code, string memory site) internal {
        if (!ghost_panicDetected) {
            ghost_panicDetected = true;
            ghost_panicInfo = string.concat(
                "LAYERB PANIC code=", vm.toString(code),
                " in ", site,
                " (17=overflow 18=div-by-zero 50=array-OOB)"
            );
        }
    }

    function _lpPrincipal(uint256 idx, address lp) internal view returns (uint256 p_) {
        (p_, , , , , ) = pools[idx].getLpPosition(lp);
    }

    // ── LB2: snapshot non-target pools before op ──────────────────────────
    function _snapBefore(uint256 target) internal {
        _snapTarget = target;
        _snapTaken  = true;
        for (uint256 i = 0; i < N_POOLS; i++) {
            if (i == target) continue;
            PoolContract p = pools[i];
            _snap[i] = PoolSnap({
                usdcBal:            usdc.balanceOf(address(p)),
                principal:          p.principal(),
                outstanding:        p.outstanding(),
                collectedPrincipal: p.collectedPrincipal(),
                collectedYield:     p.collectedYield(),
                claimedPrincipal:   p.claimedPrincipal(),
                claimedYield:       p.claimedYield(),
                accIdleFees:        p.accIdleFees(),
                yieldOwed:          p.yieldOwed(),
                protocolFees:       p.protocolFees()
            });
        }
    }

    // ── LB2: verify non-target pools unchanged after op ───────────────────
    function _snapAfter() internal {
        if (!_snapTaken) return;
        _snapTaken = false;
        if (ghost_bleedDetected) return;

        for (uint256 i = 0; i < N_POOLS; i++) {
            if (i == _snapTarget) continue;
            PoolContract p    = pools[i];
            PoolSnap memory s = _snap[i];
            string memory pre = string.concat(
                "LB2: pool[", vm.toString(_snapTarget),
                "] op bled into pool[", vm.toString(i), "]: "
            );

            if (usdc.balanceOf(address(p)) != s.usdcBal) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "usdcBal"); return;
            }
            if (p.principal() != s.principal) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "principal"); return;
            }
            if (p.outstanding() != s.outstanding) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "outstanding"); return;
            }
            if (p.collectedPrincipal() != s.collectedPrincipal) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "collectedPrincipal"); return;
            }
            if (p.collectedYield() != s.collectedYield) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "collectedYield"); return;
            }
            if (p.claimedPrincipal() != s.claimedPrincipal) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "claimedPrincipal"); return;
            }
            if (p.claimedYield() != s.claimedYield) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "claimedYield"); return;
            }
            if (p.accIdleFees() != s.accIdleFees) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "accIdleFees"); return;
            }
            if (p.yieldOwed() != s.yieldOwed) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "yieldOwed"); return;
            }
            if (p.protocolFees() != s.protocolFees) {
                ghost_bleedDetected = true; ghost_bleedInfo = string.concat(pre, "protocolFees"); return;
            }
        }
    }

    // ── Ghost: update coverage counters ───────────────────────────────────
    // Reads lazy-accrual state variables directly from storage.
    // These reflect the last committed value, not theoretical current value.
    // A non-zero read means a triggering function call has already set them.
    function _updateGhosts(uint256 targetIdx) internal {
        uint256 activeCount    = 0;
        bool    otherMidDraw   = false;
        bool    hasOverrun     = false;
        bool    hasPenalty     = false;
        bool    hasIdleFees    = false;

        for (uint256 i = 0; i < N_POOLS; i++) {
            PoolContract p = pools[i];
            if (p.status() == PoolContract.Status.Active) {
                activeCount++;
                if (i != targetIdx && p.outstanding() > 0) otherMidDraw = true;
            }
            if (p.overrunYield() > 0) hasOverrun   = true;
            if (p.accPenalty()   > 0) hasPenalty   = true;
            if (p.accIdleFees()  > 0) hasIdleFees  = true;
        }

        if (activeCount > ghost_maxSimultaneousActive)
            ghost_maxSimultaneousActive = activeCount;
        if (otherMidDraw)
            ghost_crossPoolOpsWhileOtherMidDraw++;
        if (hasOverrun   && activeCount >= 2) ghost_checksWithOverrunYield++;
        if (hasPenalty   && activeCount >= 2) ghost_checksWithAccPenalty++;
        if (hasIdleFees  && activeCount >= 2) ghost_checksWithAccIdleFees++;

        if (pools[0].principal()   != pools[1].principal() ||
            pools[0].outstanding() != pools[1].outstanding())
            ghost_identicalParamsDiverged++;
    }

    // ── Handler: draw ──────────────────────────────────────────────────────
    // Before attempting a new draw: repay any overdue TRACKED drawdowns (known
    // refs only — anchor is invisible). This models realistic PSP behaviour and
    // clears _hasOverdueUnsettled() for tracked-draw-only overdue situations.
    // Pool[2] after t=13D stays permanently blocked (anchor overdue, unreachable).
    function handler_draw(uint256 pSeed, uint256 amount, uint256 refSeed) external {
        ghost_draw_calls++;
        uint256 idx = _poolIdx(pSeed);
        PoolContract p = pools[idx];
        if (p.status() != PoolContract.Status.Active) { ghost_draw_notActive++; return; }

        _snapBefore(idx);
        _updateGhosts(idx);

        // Overdue-clear: repay known tracked drawdowns that have expired.
        for (uint256 k = 0; k < N_REFS; k++) {
            if (!ddActive[idx][k]) continue;
            (, , uint256 ddExpiry,) = p.drawDowns(refs[idx][k]);
            if (ddExpiry == 0 || ddExpiry >= block.timestamp) continue;

            ghost_overdueCount++;
            (, , uint256 repayTotal) = p.getRepaymentOwed(refs[idx][k]);
            if (usdc.balanceOf(PSPs[idx]) < repayTotal)
                usdc.mint(PSPs[idx], repayTotal);

            vm.prank(PSPs[idx]);
            try p.repay(refs[idx][k]) {
                ddActive[idx][k] = false;
                ghost_repaySuccessCount++;
            } catch Panic(uint256 code) {
                _recordPanic(code, "handler_draw_repayOverdue");
            } catch {}

            if (p.status() != PoolContract.Status.Active) { _snapAfter(); return; }
        }

        uint256 avail = p.availableToDd();
        // Guard against bound() revert when avail < min draw.
        if (avail < 1 * SCALE) { ghost_draw_availSmall++; _snapAfter(); return; }

        // Find a free ref slot.
        uint256 slot  = refSeed % N_REFS;
        bool    found = false;
        for (uint256 k = 0; k < N_REFS; k++) {
            uint256 j = (slot + k) % N_REFS;
            if (!ddActive[idx][j]) { slot = j; found = true; break; }
        }
        if (!found) { ghost_draw_noFreeSlot++; _snapAfter(); return; }

        bytes32 ref = refs[idx][slot];

        // Cap per-draw at 10 SCALE so the fuzzer cannot drain the pool in one call,
        // ensuring hundreds of draw→repay cycles are possible across the campaign.
        uint256 maxAmt = avail < 10 * SCALE ? avail : 10 * SCALE;
        amount = bound(amount, 1 * SCALE, maxAmt);

        vm.prank(AGENT2);
        try p.executeDrawdown(ref, PSPs[idx], amount, 1) {
            ddActive[idx][slot] = true;
            ghost_drawSuccessCount++;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_draw_executeDrawdown");
            ghost_draw_execFail++;
        } catch { ghost_draw_execFail++; }
        _snapAfter();
    }

    // ── Handler: repay ─────────────────────────────────────────────────────
    function handler_repay(uint256 pSeed, uint256 refSeed) external {
        uint256 idx = _poolIdx(pSeed);
        PoolContract p = pools[idx];
        if (p.status() != PoolContract.Status.Active) return;

        uint256 slot  = refSeed % N_REFS;
        bool    found = false;
        for (uint256 k = 0; k < N_REFS; k++) {
            uint256 j = (slot + k) % N_REFS;
            if (ddActive[idx][j]) { slot = j; found = true; break; }
        }
        if (!found) return;

        bytes32 ref = refs[idx][slot];
        (, , uint256 total) = p.getRepaymentOwed(ref);
        if (usdc.balanceOf(PSPs[idx]) < total) usdc.mint(PSPs[idx], total);

        _snapBefore(idx);
        _updateGhosts(idx);

        vm.prank(PSPs[idx]);
        try p.repay(ref) {
            ddActive[idx][slot] = false;
            ghost_repaySuccessCount++;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_repay");
        } catch {}
        _snapAfter();
    }

    // ── Handler: payIdle ───────────────────────────────────────────────────
    function handler_payIdle(uint256 pSeed) external {
        uint256 idx = _poolIdx(pSeed);
        PoolContract p = pools[idx];
        if (p.status() != PoolContract.Status.Active) return;

        (, , uint256 owed) = p.getIdleFeesBreakdown();
        if (owed == 0) return;
        if (usdc.balanceOf(PSPs[idx]) < owed) usdc.mint(PSPs[idx], owed);

        _snapBefore(idx);
        _updateGhosts(idx);

        vm.prank(PSPs[idx]);
        try p.payAccruedIdleFees(owed) {
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_payIdle");
        } catch {}
        _snapAfter();
    }

    // ── Handler: claimYield ────────────────────────────────────────────────
    function handler_claimYield(uint256 pSeed, uint256 lpSeed) external {
        uint256 idx = _poolIdx(pSeed);
        PoolContract p = pools[idx];
        PoolContract.Status s = p.status();
        if (s != PoolContract.Status.Active &&
            s != PoolContract.Status.Closed  &&
            s != PoolContract.Status.Default) return;

        address lp = _lp(lpSeed);
        if (_lpPrincipal(idx, lp) == 0) return;

        _snapBefore(idx);
        _updateGhosts(idx);

        vm.prank(lp);
        try p.claimYield() {
            ghost_claimSuccessCount++;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_claimYield");
        } catch {}
        _snapAfter();
    }

    // ── Handler: claimPrincipal ────────────────────────────────────────────
    function handler_claimPrincipal(uint256 pSeed, uint256 lpSeed) external {
        uint256 idx = _poolIdx(pSeed);
        PoolContract p = pools[idx];
        PoolContract.Status s = p.status();
        if (s != PoolContract.Status.Active &&
            s != PoolContract.Status.Closed  &&
            s != PoolContract.Status.Default) return;

        address lp = _lp(lpSeed);
        if (_lpPrincipal(idx, lp) == 0) return;

        _snapBefore(idx);
        _updateGhosts(idx);

        vm.prank(lp);
        try p.claimPrincipal() {
            ghost_claimSuccessCount++;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_claimPrincipal");
        } catch {}
        _snapAfter();
    }

    // ── Handler: declareDefault ────────────────────────────────────────────
    // Guard: only fire post-maturity. Without this, declareDefault() kills
    // pools within the first ~50 campaign calls (no overdue requirement in
    // the contract), leaving 200,000 total draw calls as dead no-ops.
    function handler_declareDefault(uint256 pSeed) external {
        uint256 idx = _poolIdx(pSeed);
        PoolContract p = pools[idx];
        if (p.status() != PoolContract.Status.Active) return;
        if (block.timestamp < p.poolFinalityTs()) return;

        _snapBefore(idx);
        _updateGhosts(idx);

        vm.prank(AGENT2);
        try p.declareDefault() {
            for (uint256 k = 0; k < N_REFS; k++) ddActive[idx][k] = false;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_declareDefault");
        } catch {}
        _snapAfter();
    }

    // ── Handler: settleDefault ─────────────────────────────────────────────
    function handler_settleDefault(uint256 pSeed, uint256 amount) external {
        uint256 idx = _poolIdx(pSeed);
        PoolContract p = pools[idx];
        if (p.status() != PoolContract.Status.Default) return;

        amount = bound(amount, 1, 5_000_000 * SCALE);
        if (usdc.balanceOf(MULTISIG) < amount) return;

        _snapBefore(idx);
        _updateGhosts(idx);

        vm.prank(MULTISIG);
        try p.settleDefaultPrincipal(amount) {
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_settleDefault");
        } catch {}
        _snapAfter();
    }

    // ── Handler: warpTime ──────────────────────────────────────────────────
    // 0–5 day range: exercises overdue circuit-breaker, penalty accrual,
    // overrun yield, and idle-fee accumulation at realistic PSP cadence.
    function handler_warpTime(uint256 days_) external {
        days_ = bound(days_, 0, 5);
        vm.warp(block.timestamp + days_ * D);
    }

    // ── Handler: deposit ───────────────────────────────────────────────────
    // Kept for coverage tests; NOT included in the fuzzer selector list.
    function handler_deposit(uint256 pSeed, uint256 amount, uint256 lpSeed) external {
        uint256 idx = _poolIdx(pSeed);
        PoolContract p = pools[idx];
        if (p.status() != PoolContract.Status.Funding) return;

        amount = bound(amount, 1 * SCALE, 3_000_000 * SCALE);
        address lp = _lp(lpSeed);
        if (usdc.balanceOf(lp) < amount) return;
        if (p.principal() + amount > p.hardCap()) return;

        _snapBefore(idx);
        _updateGhosts(idx);

        vm.prank(lp);
        try p.deposit(amount) {
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_deposit");
        } catch {}
        _snapAfter();
    }

    // ── Break-test helpers (called only by test_LB*_breakVerification) ───────

    // LB0: route a deliberate Panic(0x11) through the ghost recording path.
    // Confirms typed catch Panic(uint256) fires before bare catch{}.
    function helper_deliberatePanic() external pure returns (uint256) {
        uint256 x = 0;
        return x - 1; // Panic(0x11): arithmetic underflow
    }

    function helper_injectPanic_forTest() external {
        try this.helper_deliberatePanic() returns (uint256) {}
        catch Panic(uint256 code) { _recordPanic(code, "helper_injectPanic_forTest"); }
        catch {}
    }

    // ── Test-only: deliberate bleed injection for LB2 verify-it-can-fail ──
    // Snapshots all pools with target=0, then mints 1 SCALE directly into
    // pool[1] (simulating a bug where a pool[0] op credits pool[1]),
    // then runs the snapshot check. ghost_bleedDetected must be set to true.
    // NOT included in the fuzzer selector list.
    function helper_injectBleed_forTest() external {
        _snapBefore(0);
        usdc.mint(address(pools[1]), 1 * SCALE);
        _snapAfter();
    }

    // ── View helpers ───────────────────────────────────────────────────────
    function poolStatus(uint256 idx) external view returns (PoolContract.Status) {
        return pools[idx].status();
    }
}
