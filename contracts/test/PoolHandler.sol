// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Handler for Foundry invariant testing.
///
/// Drives a single pool through random valid state transitions. Maintains ghost
/// variables that shadow the external reserve bucket so the invariant suite can
/// check conservation without reading treasury internals.
///
/// Actor addresses are deterministic so the invariant suite can read LP positions
/// directly.
///
/// ── Panic-catch pattern (reuse in multipool harness) ──────────────────────────
///
/// Every pool call uses THREE typed catch clauses:
///
///   try pool.X(args) {
///       /* success body */
///   } catch Panic(uint256 code) {
///       // Arithmetic overflow/underflow (0x11=17), div-by-zero (0x12=18),
///       // array index OOB (0x32=50). Must NEVER occur on a valid sequence.
///       _recordPanic(code, "handler_X");   // sets ghost, does NOT revert
///   } catch {
///       // Bare wildcard: catches Error(string) from require guards AND raw
///       // bytes from empty/custom-error reverts. These are EXPECTED on
///       // invalid sequences (wrong status, bad amount, wrong caller, etc.)
///       // and are silently ignored.
///   }
///
/// Discrimination guarantee: Solidity routes Panic(uint256) to the typed clause
/// BEFORE the wildcard. A `catch {}` at the end never sees a Panic; only string
/// and bytes reverts reach it. This is the key correctness property.
///
/// Why NOT revert/assertFalse inside catch Panic:
///   foundry.toml has fail_on_revert=false (not set = false by default).
///   Handler reverts are discarded by the fuzzer; only invariant-function
///   failures surface counterexamples. Ghost + invariant_I0_noPanicInPool()
///   is the correct path.
///
/// Verification: call helper_deliberatePanic() via try this.X() to inject a
/// Panic(0x11) through an external call; confirm invariant_I0 fails with the
/// right handler name. Also confirm an expected-revert call does NOT set the
/// ghost (the discrimination proof).
/// ─────────────────────────────────────────────────────────────────────────────
contract PoolHandler is Test {
    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 constant SCALE  = 1e12;
    uint256 constant D      = 86400;
    uint256 constant WAD    = 1e18;

    uint256 constant LOCK     = 5 * D;   // funding_days = 5
    uint256 constant TENURE   = 30;
    uint256 constant MATURITY = LOCK + TENURE * D;

    // ── Actors ────────────────────────────────────────────────────────────────

    address public LP_A     = address(0xAAAA);
    address public LP_B     = address(0xBBBB);
    address public PSP      = address(0x5555);
    address public AGENT1   = address(0x3333);
    address public AGENT2   = address(0x4444);
    address public MULTISIG = address(0x1111);
    address public DEPLOYER = address(0x2222);

    // ── Contracts ─────────────────────────────────────────────────────────────

    MockStablecoin  public usdc;
    TreasuryReserve public treasury;
    PoolFactory     public factory;
    PoolContract    public pool;

    // ── Ref tracking (at most 3 concurrent drawdowns) ─────────────────────────

    bytes32[3] public refs;
    bool[3]    public ddActive;

    // ── Ghost variables ────────────────────────────────────────────────────────

    bool public ghost_defaultDeclared;
    // True when declareDefault fired AND the I13 identity (yieldOwed==mulDiv(ds,apr,WAD*SPY))
    // still holds post-default — i.e. Case 1 (pre-maturity rebase) or post-maturity default.
    // False when Case 2 fired (yieldOwed=collectedYield, identity broken by design).
    bool public ghost_caseOneDefaulted;

    // I16: collectedYield captured at the moment declareDefault fires.
    // Any increase beyond this in Default status came from settleDefaultYield, which
    // requires collectedPrincipal >= principal. Used by invariant_I16.
    uint256 public ghost_collectedYieldAtDefault;

    // Ghost: Default→Closed with non-zero acc_idle_fees (phantom-accrual regression).
    // Set whenever the pool transitions to Closed with accIdleFees > 0; records the
    // accPenalty value at that moment so the invariant can verify it never grows.
    bool    public ghost_closedWithFrozenIdleFees;
    uint256 public ghost_closedAccPenalty;

    // Panic detection: first-panic-only (subsequent panics do not overwrite).
    bool    public ghost_panicDetected;
    uint256 public ghost_panicCode;
    string  public ghost_panicHandler;
    string  public ghost_panicInfo;

    // ── Ghost: draw (handler_draw) breakdown ──────────────────────────────────
    uint256 public ghost_draw_calls;        // total invocations
    uint256 public ghost_drawSuccessCount;  // executeDrawdown successes
    uint256 public ghost_draw_notActive;    // early-return: status != Active
    uint256 public ghost_draw_availZero;    // early-return: avail == 0
    uint256 public ghost_draw_availSmall;   // early-return: 0 < avail < 1 SCALE
    // ghost_draw_expiryGuard removed — handler now clamps settleDays so expiryTs <= poolFinalityTs
    uint256 public ghost_draw_noFreeSlot;   // early-return: all 3 slots busy
    uint256 public ghost_draw_execFail;     // executeDrawdown expected-revert

    // ── Ghost: repay breakdown ─────────────────────────────────────────────────
    uint256 public ghost_repay_calls;
    uint256 public ghost_repaySuccessCount;
    uint256 public ghost_repay_notActive;
    uint256 public ghost_repay_noSlot;

    // ── Ghost: claim / settle / lifecycle ─────────────────────────────────────
    uint256 public ghost_claimYieldSuccessCount;
    uint256 public ghost_claimPrincipalSuccessCount;
    uint256 public ghost_payIdleSuccessCount;
    uint256 public ghost_settleDefaultPrincipalSuccessCount;
    uint256 public ghost_settleDefaultYieldSuccessCount;
    uint256 public ghost_depositSuccessCount;
    uint256 public ghost_finalizeSuccessCount;

    // ── Ghost: pool terminal outcome (for afterInvariant coverage check) ───────
    bool    public ghost_poolWentActive;        // finalize → Active this run
    bool    public ghost_poolWentUnsuccessful;  // finalize → Unsuccessful this run
    uint256 public ghost_principalAtFinalize;   // pool.principal() captured at finalize
    uint256 public ghost_lpCountAtFinalize;     // LPs with principal>0 at finalize

    // ── Constructor ────────────────────────────────────────────────────────────

    constructor() {
        vm.warp(0);

        refs[0] = bytes32("r0");
        refs[1] = bytes32("r1");
        refs[2] = bytes32("r2");

        usdc = new MockStablecoin();
        PoolContract impl = new PoolContract();
        treasury = new TreasuryReserve(
            address(usdc), MULTISIG,
            1e17,                 // reserve_rate 10%
            1_000_000 * SCALE,    // reserve_target
            WAD,                  // hurdle_frac 100%
            0                     // lp_bonus 0%
        );
        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * 86400, 25e16, 3, 1, 7
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);

        // Fund actors
        usdc.mint(LP_A,      5_000_000 * SCALE);
        usdc.mint(LP_B,      5_000_000 * SCALE);
        usdc.mint(PSP,      50_000_000 * SCALE);
        usdc.mint(MULTISIG, 50_000_000 * SCALE);

        // Create pool
        vm.prank(DEPLOYER);
        address poolAddr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           3 * SCALE,   // 2 deposits of [1,2] SCALE needed; 1 deposit → Unsuccessful+principal>0
            hardCap:           9_000_000 * SCALE,
            tenure:            TENURE,
            idleRateDaily:     5e14,
            utilizedRateDaily: 5e14,
            penaltyRateDaily:  1e15,
            penaltyGraceDays:  2,
            minDeposit:        0,
            aprAnnual:         1e17,
            agent1:            address(0x3333),
            agent2:            AGENT2,
            multisig:          MULTISIG
        }));
        pool = PoolContract(poolAddr);

        // Unlimited approvals
        vm.prank(LP_A);    usdc.approve(address(pool), type(uint256).max);
        vm.prank(LP_B);    usdc.approve(address(pool), type(uint256).max);
        vm.prank(PSP);     usdc.approve(address(pool), type(uint256).max);
        vm.prank(MULTISIG);usdc.approve(address(pool), type(uint256).max);
    }

    // ── Helper: read LP principal from the position struct ────────────────────

    function lpPrincipal(address lp) public view returns (uint256 p) {
        (p, , , , , ) = pool.getLpPosition(lp);
    }

    // ── Internal: record a caught panic ───────────────────────────────────────
    // Called from every catch Panic block. Does NOT revert (see pattern note above).

    function _recordPanic(uint256 code, string memory site) internal {
        if (!ghost_panicDetected) {
            ghost_panicDetected = true;
            ghost_panicCode     = code;
            ghost_panicHandler  = site;
            ghost_panicInfo = string.concat(
                "POOL PANIC code=", vm.toString(code),
                " in ", site,
                " (17=overflow/underflow  18=div-by-zero  50=array-OOB)"
            );
        }
    }

    // ── Verification helper ────────────────────────────────────────────────────
    // Triggers Panic(0x11) via arithmetic underflow in an external call.
    // Inject via:  try this.helper_deliberatePanic() returns (uint256) {}
    //              catch Panic(uint256 code) { _recordPanic(code, "INJECTION"); }
    //              catch {}
    // Confirms the ghost wiring fires on real panics. Remove injection after verify.

    function helper_deliberatePanic() external pure returns (uint256) {
        uint256 x = 0;
        return x - 1; // Panic(0x11): arithmetic underflow
    }

    // ── Lifecycle actions ─────────────────────────────────────────────────────

    function handler_deposit(uint256 amount, uint256 lpSeed) external {
        if (pool.status() != PoolContract.Status.Funding) return;
        amount = bound(amount, 1 * SCALE, 2 * SCALE);  // max 2 SCALE: one deposit never meets softCap=3
        address lp = (lpSeed % 2 == 0) ? LP_A : LP_B;
        if (usdc.balanceOf(lp) < amount) return;
        if (pool.principal() + amount > pool.hardCap()) return;
        vm.prank(lp);
        try pool.deposit(amount) {
            ghost_depositSuccessCount++;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_deposit");
        } catch {}
    }

    function handler_withdraw(uint256 amount, uint256 lpSeed) external {
        PoolContract.Status s = pool.status();
        if (s != PoolContract.Status.Funding && s != PoolContract.Status.Unsuccessful) return;
        address lp = (lpSeed % 2 == 0) ? LP_A : LP_B;
        uint256 pos = lpPrincipal(lp);
        if (pos == 0) return;
        amount = bound(amount, 1, pos);
        vm.prank(lp);
        try pool.withdraw(amount) {
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_withdraw");
        } catch {}
    }

    function handler_finalizeFunding() external {
        if (pool.status() != PoolContract.Status.Funding) return;
        if (block.timestamp < pool.fMaturityTs()) {
            vm.warp(pool.fMaturityTs());
        }
        try pool.finalizeFunding() {
            ghost_finalizeSuccessCount++;
            // Record which terminal state the pool reached and snapshot LP positions.
            PoolContract.Status newStatus = pool.status();
            if (newStatus == PoolContract.Status.Active) {
                ghost_poolWentActive = true;
            } else if (newStatus == PoolContract.Status.Unsuccessful) {
                ghost_poolWentUnsuccessful = true;
                ghost_principalAtFinalize = pool.principal();
                uint256 lps = 0;
                (uint256 pa, , , , , , , , ) = pool.lpPositions(LP_A);
                (uint256 pb, , , , , , , , ) = pool.lpPositions(LP_B);
                if (pa > 0) lps++;
                if (pb > 0) lps++;
                ghost_lpCountAtFinalize = lps;
            }
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_finalizeFunding");
        } catch {}
    }

    function handler_draw(uint256 amount, uint256 settleDays, uint256 refSeed) external {
        ghost_draw_calls++;
        if (pool.status() != PoolContract.Status.Active) { ghost_draw_notActive++; return; }

        // Past maturity: executeDrawdown requires dayOf(expiryTs) <= dayOf(poolFinalityTs).
        // With block.timestamp > poolFinalityTs, even settleDays=0 gives dayOf(now) > dayOf(fin).
        // No draw is possible — count alongside notActive so the afterInvariant gate excludes it.
        uint256 poolFin = pool.poolFinalityTs();
        if (block.timestamp > poolFin) { ghost_draw_notActive++; return; }

        uint256 avail = pool.availableToDd();
        if (avail == 0)             { ghost_draw_availZero++;  return; }
        if (avail < 1 * SCALE)      { ghost_draw_availSmall++; return; }

        amount = bound(amount, 1 * SCALE, avail);

        // Clamp settleDays so dayOf(expiryTs) <= dayOf(poolFinalityTs).
        // minDdDays=1: need at least 1 day; if maxDays < 1, no draw is possible.
        uint256 maxDays = (poolFin - block.timestamp) / D;
        if (maxDays > 7) maxDays = 7;
        if (maxDays < 1) { ghost_draw_notActive++; return; }
        settleDays = bound(settleDays, 1, maxDays);

        // Find first inactive ref slot starting from refSeed % 3.
        uint256 idx = refSeed % 3;
        for (uint256 i = 0; i < 3; i++) {
            uint256 j = (idx + i) % 3;
            if (!ddActive[j]) { idx = j; break; }
            if (i == 2) { ghost_draw_noFreeSlot++; return; }
        }

        bytes32 ref = refs[idx];

        vm.prank(AGENT2);
        try pool.executeDrawdown(ref, PSP, amount, settleDays) {
            ddActive[idx] = true;
            ghost_drawSuccessCount++;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_executeDrawdown");
            ghost_draw_execFail++;
        } catch {
            ghost_draw_execFail++;
        }
    }

    function handler_repay(uint256 refSeed) external {
        ghost_repay_calls++;
        if (pool.status() != PoolContract.Status.Active) { ghost_repay_notActive++; return; }

        uint256 idx = refSeed % 3;
        for (uint256 i = 0; i < 3; i++) {
            uint256 j = (idx + i) % 3;
            if (ddActive[j]) { idx = j; break; }
            if (i == 2) { ghost_repay_noSlot++; return; }
        }
        if (!ddActive[idx]) { ghost_repay_noSlot++; return; }

        bytes32 ref = refs[idx];
        (, , uint256 total) = pool.getRepaymentOwed(ref);
        if (usdc.balanceOf(PSP) < total) usdc.mint(PSP, total);
        vm.prank(PSP);
        try pool.repay(ref) {
            ddActive[idx] = false;
            ghost_repaySuccessCount++;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_repay");
        } catch {}
    }

    function handler_payIdleFees() external {
        if (pool.status() != PoolContract.Status.Active) return;
        (, , uint256 owed) = pool.getIdleFeesBreakdown();
        if (owed == 0) return;
        if (usdc.balanceOf(PSP) < owed) usdc.mint(PSP, owed);
        vm.prank(PSP);
        try pool.payAccruedIdleFees(owed) {
            ghost_payIdleSuccessCount++;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_payIdleFees");
        } catch {}
    }

    function handler_claimYield(uint256 lpSeed) external {
        PoolContract.Status s = pool.status();
        if (s != PoolContract.Status.Active &&
            s != PoolContract.Status.Closed &&
            s != PoolContract.Status.Default) return;
        address lp = (lpSeed % 2 == 0) ? LP_A : LP_B;
        if (lpPrincipal(lp) == 0) return;
        vm.prank(lp);
        try pool.claimYield() {
            ghost_claimYieldSuccessCount++;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_claimYield");
        } catch {}
    }

    function handler_claimPrincipal(uint256 lpSeed) external {
        PoolContract.Status s = pool.status();
        if (s != PoolContract.Status.Active &&
            s != PoolContract.Status.Closed &&
            s != PoolContract.Status.Default) return;
        address lp = (lpSeed % 2 == 0) ? LP_A : LP_B;
        if (lpPrincipal(lp) == 0) return;
        vm.prank(lp);
        try pool.claimPrincipal() {
            ghost_claimPrincipalSuccessCount++;
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_claimPrincipal");
        } catch {}
    }

    function handler_declareDefault() external {
        if (pool.status() != PoolContract.Status.Active) return;
        if (ghost_defaultDeclared) return;
        // Only meaningful if there are outstanding drawdowns
        if (pool.outstanding() == 0) return;
        vm.prank(AGENT2);
        try pool.declareDefault() {
            ghost_defaultDeclared = true;
            ghost_collectedYieldAtDefault = pool.collectedYield();
            if (pool.yieldOwed() == MathLib.mulDiv(
                    pool.dollarSeconds(), pool.aprAnnual(), MathLib.WAD * MathLib.SECONDS_PER_YEAR)) {
                ghost_caseOneDefaulted = true;
            }
            // declareDefault can immediately close the pool (waterfall covers all shortfalls).
            if (pool.status() == PoolContract.Status.Closed && pool.accIdleFees() > 0) {
                ghost_closedWithFrozenIdleFees = true;
                ghost_closedAccPenalty = pool.accPenalty();
            }
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_declareDefault");
        } catch {}
    }

    function handler_settleDefaultPrincipal(uint256 amount) external {
        if (pool.status() != PoolContract.Status.Default) return;
        amount = bound(amount, 0, pool.principal());
        if (usdc.balanceOf(MULTISIG) < amount) usdc.mint(MULTISIG, amount);
        vm.startPrank(MULTISIG);
        usdc.approve(address(pool), amount);
        try pool.settleDefaultPrincipal(amount) {
            ghost_settleDefaultPrincipalSuccessCount++;
            if (pool.status() == PoolContract.Status.Closed && pool.accIdleFees() > 0) {
                ghost_closedWithFrozenIdleFees = true;
                ghost_closedAccPenalty = pool.accPenalty();
            }
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_settleDefaultPrincipal");
        } catch {}
        vm.stopPrank();
    }

    function handler_settleDefaultYield(uint256 amount) external {
        if (pool.status() != PoolContract.Status.Default) return;
        if (pool.collectedPrincipal() < pool.principal()) return;
        amount = bound(amount, 0, pool.yieldOwed());
        if (usdc.balanceOf(MULTISIG) < amount) usdc.mint(MULTISIG, amount);
        vm.startPrank(MULTISIG);
        usdc.approve(address(pool), amount);
        try pool.settleDefaultYield(amount) {
            ghost_settleDefaultYieldSuccessCount++;
            if (pool.status() == PoolContract.Status.Closed && pool.accIdleFees() > 0) {
                ghost_closedWithFrozenIdleFees = true;
                ghost_closedAccPenalty = pool.accPenalty();
            }
        } catch Panic(uint256 code) {
            _recordPanic(code, "handler_settleDefaultYield");
        } catch {}
        vm.stopPrank();
    }

    function handler_warpTime(uint256 days_) external {
        days_ = bound(days_, 0, 10);
        uint256 newTs = block.timestamp + days_ * D;
        if (newTs > MATURITY + 100 * D) return;
        vm.warp(newTs);
    }

    function handler_warpToLock() external {
        if (block.timestamp < LOCK) vm.warp(LOCK);
    }

    function handler_warpToMaturity() external {
        if (block.timestamp < MATURITY) vm.warp(MATURITY);
    }

    // ── Treasury ghost helpers (called by TreasuryReserve events) ─────────────
    // We can't hook events directly; instead the invariants use the actual
    // reserveBalance and compare via the conservation formula.

    // ── Break-test helpers (called only by test_I*_breakVerification) ─────────
    //
    // Each helper either drives the pool to a specific guard-passing state or
    // corrupts internal state via vm.store (bypassing contract logic so the
    // resulting state is one the contract cannot produce itself).
    //
    // Slot numbers from: forge inspect PoolContract storageLayout
    //   28 = span           29 = principal       30 = availableToDd
    //   31 = outstanding    32 = fundingCredit   33 = dollarSeconds
    //   34 = yieldOwed      36 = accIdleFees     37 = accPenalty
    //   39 = collectedYield 41 = reservedYield   42 = protocolFees
    //   44 = claimedYield   48 = lastIdleDay     49 = lastPenaltyDay
    //   50 = idleExemptAmount  51 = idleExemptUntil
    //   55 = drawDowns mapping   58 = lpPositions mapping
    //
    // Slot numbers from: forge inspect PoolFactory storageLayout
    //    1 = psps mapping  (PspRecord: bool approved @ offset 0, address activePool @ offset 1, packed in 1 slot)

    // I0: route a deliberate Panic(0x11) through the ghost recording path.
    function helper_injectPanic_forTest() external {
        try this.helper_deliberatePanic() returns (uint256) {}
        catch Panic(uint256 code) { _recordPanic(code, "helper_injectPanic_forTest"); }
        catch {}
    }

    // I2/I5/I6: drive pool Funding → Active (4 SCALE deposited >= softCap=3).
    function helper_setupActive_forTest() external {
        vm.prank(LP_A); pool.deposit(2 * SCALE);
        vm.prank(LP_B); pool.deposit(2 * SCALE);
        vm.warp(pool.fMaturityTs());
        pool.finalizeFunding();
        require(pool.status() == PoolContract.Status.Active, "setup: not Active");
    }

    // I6: from Active, draw 1 SCALE then declare default.
    // declareDefault() requires only Active + AGENT2; no maturity warp needed.
    function helper_setupDefault_forTest() external {
        require(pool.status() == PoolContract.Status.Active, "setup: not Active");
        vm.prank(AGENT2); pool.executeDrawdown(refs[0], PSP, 1 * SCALE, 1);
        ddActive[0] = true;
        vm.prank(AGENT2); pool.declareDefault();
        ghost_defaultDeclared         = true;
        ghost_collectedYieldAtDefault = pool.collectedYield();
        require(pool.status() == PoolContract.Status.Default, "setup: not Default");
    }

    // I8: two LPs deposit 1 SCALE each at staggered times → Unsuccessful.
    // Total 2 SCALE < softCap=3. LP_A at t=0, LP_B at t=1D → different lastUpdates.
    function helper_setupUnsuccessfulWith2LPs_forTest() external {
        vm.prank(LP_A); pool.deposit(1 * SCALE);
        vm.warp(1 * D);
        vm.prank(LP_B); pool.deposit(1 * SCALE);
        vm.warp(pool.fMaturityTs());
        pool.finalizeFunding();
        require(pool.status() == PoolContract.Status.Unsuccessful, "setup: not Unsuccessful");
    }

    // I2: inflate outstanding by excess (breaks partition: out+avail+coll > principal).
    function helper_corruptOutstanding_forTest(uint256 excess) external {
        vm.store(address(pool), bytes32(uint256(31)), bytes32(pool.outstanding() + excess));
    }

    // I3 pool-level: set pool.claimedYield > collectedYield.
    function helper_corruptPoolClaimedYield_forTest(uint256 newVal) external {
        vm.store(address(pool), bytes32(uint256(44)), bytes32(newVal));
    }

    // I3-F1: set pool.collectedYield to newVal (needed to pass the collectedYield==0 guard).
    function helper_corruptCollectedYield_forTest(uint256 newVal) external {
        vm.store(address(pool), bytes32(uint256(39)), bytes32(newVal));
    }

    // I3-F1: set LP's claimedYield (struct depth 4 = mapping base slot + 4).
    function helper_corruptLpClaimedYield_forTest(address lp, uint256 newVal) external {
        bytes32 base = keccak256(abi.encode(lp, uint256(58)));
        vm.store(address(pool), bytes32(uint256(base) + 4), bytes32(newVal));
    }

    // I5: overwrite pool.dollarSeconds on a locked pool.
    function helper_corruptDollarSeconds_forTest(uint256 newVal) external {
        vm.store(address(pool), bytes32(uint256(33)), bytes32(newVal));
    }

    // I6: inject protocolFees on a Default pool.
    function helper_corruptProtocolFees_forTest(uint256 val) external {
        vm.store(address(pool), bytes32(uint256(42)), bytes32(val));
    }

    // I7: corrupt factory.psps[PSP].activePool to fakePool.
    // PspRecord{bool approved; address activePool} packed in 1 slot.
    // Slot value = (uint256(uint160(activePool)) << 8) | (approved ? 1 : 0)
    function helper_corruptFactoryActivePool_forTest(address fakePool) external {
        bytes32 slot = bytes32(uint256(keccak256(abi.encode(PSP, uint256(1)))));
        vm.store(address(factory), slot, bytes32((uint256(uint160(fakePool)) << 8) | 1));
    }

    // I8 sub-property: push LP_A.lastUpdate past pool.lastUpdate (struct depth 2 = base+2).
    function helper_corruptLpLastUpdatePastPool_forTest() external {
        bytes32 base = keccak256(abi.encode(LP_A, uint256(58)));
        vm.store(address(pool), bytes32(uint256(base) + 2), bytes32(pool.lastUpdate() + 1));
    }

    // I8 equality: inflate LP_A.fundingCredit by delta (struct depth 1 = base+1).
    function helper_corruptLpFundingCredit_forTest(uint256 delta) external {
        (, uint256 fc, , , , , , , ) = pool.lpPositions(LP_A);
        bytes32 base = keccak256(abi.encode(LP_A, uint256(58)));
        vm.store(address(pool), bytes32(uint256(base) + 1), bytes32(fc + delta));
    }

    // I9: drive to Active, draw refs[0], then return — caller can corrupt drawdown.
    function helper_setupActiveWithDraw_forTest() external {
        vm.prank(LP_A); pool.deposit(2 * SCALE);
        vm.prank(LP_B); pool.deposit(2 * SCALE);
        vm.warp(pool.fMaturityTs());
        pool.finalizeFunding();
        require(pool.status() == PoolContract.Status.Active, "setup: not Active");
        vm.prank(AGENT2); pool.executeDrawdown(refs[0], PSP, 1 * SCALE, 1);
        ddActive[0] = true;
    }

    // I9: inflate drawDowns[refs[refIdx]].principal by delta without touching outstanding.
    // drawDowns mapping is at slot 55; DrawDown.principal is at depth 0 (no struct offset).
    function helper_corruptDrawdownPrincipal_forTest(uint256 refIdx, uint256 delta) external {
        bytes32 ref = refs[refIdx];
        (uint256 currentPrin, , ,) = pool.drawDowns(ref);
        bytes32 slot = keccak256(abi.encode(ref, uint256(55)));
        vm.store(address(pool), slot, bytes32(currentPrin + delta));
    }

    // I10/I11: drive to Closed via normal maturity (no default).
    // With no drawdowns, 100% idle for 30 days accrues enough idle fees to cover yieldOwed.
    // payAccruedIdleFees fills collectedYield; _mature sweeps availableToDd; _checkFinality closes.
    function helper_setupClosed_forTest() external {
        vm.prank(LP_A); pool.deposit(2 * SCALE);
        vm.prank(LP_B); pool.deposit(2 * SCALE);
        vm.warp(pool.fMaturityTs());
        pool.finalizeFunding();
        require(pool.status() == PoolContract.Status.Active, "setup: not Active");
        vm.warp(pool.poolFinalityTs());
        (, , uint256 idleOwed) = pool.getIdleFeesBreakdown();
        if (usdc.balanceOf(PSP) < idleOwed) usdc.mint(PSP, idleOwed);
        vm.prank(PSP); pool.payAccruedIdleFees(idleOwed);
        require(pool.status() == PoolContract.Status.Closed, "setup: not Closed");
    }

    // I12: inflate yieldOwed past collectedYield on a Closed pool.
    // Slot 34 = yieldOwed.
    function helper_corruptYieldOwed_forTest(uint256 delta) external {
        vm.store(address(pool), bytes32(uint256(34)), bytes32(pool.yieldOwed() + delta));
    }

    // I13: corrupt yieldOwed on a locked (Active) pool without touching dollarSeconds.
    // Slot 34 = yieldOwed. delta added so yieldOwed != mulDiv(dollarSeconds, apr, WAD*SPY).
    function helper_corruptYieldOwedActive_forTest(uint256 delta) external {
        vm.store(address(pool), bytes32(uint256(34)), bytes32(pool.yieldOwed() + delta));
    }

    // I10: inject accIdleFees into a Closed pool (slot 36).
    function helper_corruptAccIdleFees_forTest(uint256 val) external {
        vm.store(address(pool), bytes32(uint256(36)), bytes32(val));
    }

    // I11: inject reservedYield into a Closed pool (slot 41).
    function helper_corruptReservedYield_forTest(uint256 val) external {
        vm.store(address(pool), bytes32(uint256(41)), bytes32(val));
    }

    // I13 Case-1 break: drive to Default via Case 1 (pre-maturity, earned > collectedYield).
    // With collectedYield==0 at the time of default, any positive elapsed time satisfies Case 1.
    // Pool stays in Default (not inline-closed) because refs[0] drawdown leaves outstanding > 0
    // and reservedYield+protocolFees are zero, so the waterfall can't fill yieldOwed.
    function helper_setupDefaultCaseOne_forTest() external {
        vm.prank(LP_A); pool.deposit(2 * SCALE);
        vm.prank(LP_B); pool.deposit(2 * SCALE);
        vm.warp(pool.fMaturityTs());
        pool.finalizeFunding();
        require(pool.status() == PoolContract.Status.Active, "caseOne: not Active");
        vm.prank(AGENT2); pool.executeDrawdown(refs[0], PSP, 1 * SCALE, 1);
        ddActive[0] = true;
        // Warp to mid-pool — pre-maturity so the Case-1/2 branch fires, enough elapsed
        // for earned > 0 = collectedYield.
        vm.warp(pool.poolStartTs() + (pool.poolFinalityTs() - pool.poolStartTs()) / 2);
        vm.prank(AGENT2); pool.declareDefault();
        ghost_defaultDeclared  = true;
        ghost_caseOneDefaulted = true; // by construction: collectedYield==0 so earned > collectedYield
        ghost_collectedYieldAtDefault = pool.collectedYield();
        require(pool.status() == PoolContract.Status.Default, "caseOne: not Default");
    }

    // I13 Case-1 break: corrupt yieldOwed in Default state without touching dollarSeconds.
    // Slot 34 = yieldOwed (same slot used for Active-state corruption).
    function helper_corruptYieldOwedDefault_forTest(uint256 delta) external {
        vm.store(address(pool), bytes32(uint256(34)), bytes32(pool.yieldOwed() + delta));
    }

    // IDLE1 break: set idleExemptAmount (slot 50) to availableToDd + 1.
    // Requires Active state where availableToDd > 0 (helper_setupActive gives 4*SCALE avail).
    function helper_corruptExemptAboveAvail_forTest() external {
        vm.store(address(pool), bytes32(uint256(50)), bytes32(pool.availableToDd() + 1));
    }

    // IDLE3 break: inject a non-zero idleExemptAmount (slot 50) into a terminal pool.
    // Use after helper_setupClosed_forTest or helper_setupDefault_forTest.
    function helper_corruptExemptInTerminal_forTest(uint256 val) external {
        vm.store(address(pool), bytes32(uint256(50)), bytes32(val));
    }

    // IDLE4 break: push lastIdleDay (slot 48) above dayOf(poolFinalityTs).
    // Caller computes badDay = dayOf(poolFinalityTs) + 1.
    function helper_corruptLastIdleDayAboveFinality_forTest(uint256 badDay) external {
        vm.store(address(pool), bytes32(uint256(48)), bytes32(badDay));
    }

    // IDLE9 break: push lastIdleDay (slot 48) to a future calendar day.
    // Caller computes futureDay = dayOf(block.timestamp) + 1.
    function helper_corruptLastIdleDayToFuture_forTest(uint256 futureDay) external {
        vm.store(address(pool), bytes32(uint256(48)), bytes32(futureDay));
    }

    // CLOSED-IDLE break: force pool status to an arbitrary value.
    // status is packed with factory address in slot 21:
    //   offset 0  (bits 0-159)  = factory address (20 bytes)
    //   offset 20 (bits 160-167) = status enum (1 byte)
    // enum: Funding=0 Active=1 Unsuccessful=2 Closed=3 Default=4
    function helper_forceStatus_forTest(uint8 newStatus) external {
        bytes32 slot = bytes32(uint256(21));
        uint256 current = uint256(vm.load(address(pool), slot));
        current &= ~(uint256(0xFF) << 160);         // clear the status byte
        current |=  uint256(newStatus) << 160;       // write new status
        vm.store(address(pool), slot, bytes32(current));
    }

    // CLOSED-IDLE break: overwrite accPenalty (slot 37) directly.
    function helper_corruptAccPenalty_forTest(uint256 val) external {
        vm.store(address(pool), bytes32(uint256(37)), bytes32(val));
    }

    // I17 break: inject collectedBonus (slot 43) into a Closed pool.
    function helper_corruptCollectedBonus_forTest(uint256 val) external {
        vm.store(address(pool), bytes32(uint256(43)), bytes32(val));
    }

    // I18 break: overwrite LP's pos.principal to val, bypassing the withdraw guard.
    // lpPositions mapping is at slot 58; LPPosition.principal is at struct depth 0.
    function helper_corruptLpPrincipal_forTest(address lp, uint256 val) external {
        bytes32 base = keccak256(abi.encode(lp, uint256(58)));
        vm.store(address(pool), base, bytes32(val));
    }

    // I17 break: artificially mark the pool as having gone through Default.
    // Used to test the invariant: Default→Closed pools must have collectedBonus == 0.
    function helper_corruptGhostDefault_forTest() external {
        ghost_defaultDeclared = true;
    }
}
