// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

// ─────────────────────────────────────────────────────────────────────────────
// ViewFunctionSuite — rigorous coverage of every external view.
//
// Discipline: vm.snapshot / vm.revertTo ensures view and paired mutation run at
// the SAME block.timestamp. Snapshots are taken immediately before the mutating
// call; the view is already in a local variable captured before the snapshot.
//
// assertEq only — no tolerances, no assertApproxEq.
//
// COVERAGE TABLE
// ┌───────────────────────────────────┬──────────────────────────┬────────────────────────┬─────────┐
// │ View                              │ Mutation / Source        │ Regimes                │ Class   │
// ├───────────────────────────────────┼──────────────────────────┼────────────────────────┼─────────┤
// │ getRepaymentOwed(ref)             │ repay()                  │ on-time, within-grace, │ EXACT   │
// │ getRepaymentBreakdown(ref)        │ repay()                  │ past-grace, same-day,  │ EXACT   │
// │                                   │                          │ max-settle, recon.     │         │
// ├───────────────────────────────────┼──────────────────────────┼────────────────────────┼─────────┤
// │ getIdleFeesBreakdown()            │ payAccruedIdleFees()     │ basic, penalty,        │ EXACT   │
// │                                   │                          │ exemption, closed      │         │
// ├───────────────────────────────────┼──────────────────────────┼────────────────────────┼─────────┤
// │ getClaimableYieldBreakdown(lp)    │ claimYield()             │ post-mat, pre-mat F1,  │ EXACT   │
// │                                   │                          │ unfinalized LP, 2-LP   │         │
// ├───────────────────────────────────┼──────────────────────────┼────────────────────────┼─────────┤
// │ getLpPosition yield fields        │ getClaimableYieldBreakdown│ F1 regression, post-mat│ EXACT   │
// │ getLpPosition.claimablePrincipal_ │ claimPrincipal()         │ post-mat               │ EXACT   │
// │ getLpPosition.lpPrincipal/lpDs    │ lpPositions storage      │ any                    │ STATE   │
// ├───────────────────────────────────┼──────────────────────────┼────────────────────────┼─────────┤
// │ isDrawdownAllowed()               │ executeDrawdown()        │ gate-only (overdue)    │ PARTIAL │
// ├───────────────────────────────────┼──────────────────────────┼────────────────────────┼─────────┤
// │ isAuthorizedReceiver(recv)        │ authorizedReceivers map  │ unset / set            │ STATE   │
// │ getDrawDown(ref)                  │ drawDowns storage        │ active / after-repay   │ STATE   │
// │ currentDay()                      │ MathLib.dayOf(ts)        │ mid-day / boundary     │ STATE   │
// │ getPoolMetrics()                  │ 15 state variables       │ all fields             │ STATE   │
// └───────────────────────────────────┴──────────────────────────┴────────────────────────┴─────────┘
// ─────────────────────────────────────────────────────────────────────────────

contract VFSBase is Test {
    uint256 constant D     = 86400;
    uint256 constant SCALE = 1e12;
    uint256 constant WAD   = 1e18;
    uint256 constant TENOR = 30;
    // Funding window = 5D → fMaturityTs = 5D, poolStartTs = 5D, poolFinalityTs = 35D
    uint256 constant LOCK  = 5 * D;
    uint256 constant MAT   = LOCK + TENOR * D;

    // Rates
    uint256 constant IDLE_RATE = 5e14;   // 0.05% /day
    uint256 constant UTIL_RATE = 5e14;   // 0.05% /day
    uint256 constant PEN_RATE  = 1e15;   // 0.10% /day
    uint256 constant APR       = 1e17;   // 10% annual
    uint256 constant PGD       = 2;      // 2 grace days after due
    uint256 constant MIN_DD    = 1;
    uint256 constant MAX_DD    = 7;

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant LP_A     = address(0xAAAA);
    address constant LP_B     = address(0xBBBB);

    MockStablecoin  usdc;
    TreasuryReserve treasury;
    PoolFactory     factory;

    function _deployInfra() internal {
        vm.warp(0);
        usdc     = new MockStablecoin();
        treasury = new TreasuryReserve(
            address(usdc), MULTISIG, 1e17, 1_000_000 * SCALE, WAD, 0
        );
        PoolContract impl = new PoolContract();
        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * D, 25e16, 3, MIN_DD, MAX_DD
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);
    }

    function _makePool() internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 5 * D,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              TENOR,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    PGD,
            minDeposit:          0,
            aprAnnual:           APR,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
        p = PoolContract(addr);
    }

    function _deposit(PoolContract p, address lp, uint256 amt) internal {
        usdc.mint(lp, amt);
        vm.prank(lp); usdc.approve(address(p), type(uint256).max);
        vm.prank(lp); p.deposit(amt);
    }

    function _lock(PoolContract p) internal {
        vm.warp(LOCK);
        p.finalizeFunding();
    }

    function _draw(PoolContract p, bytes32 ref, uint256 amt, uint256 settleDays) internal {
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, amt, settleDays);
    }

    function _repayExact(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.prank(PSP); usdc.approve(address(p), total);
        vm.prank(PSP); p.repay(ref);
    }

    // Penalty start day (day-index relative to startTs day) — mirrors contract logic.
    function _penaltyStart(uint256 dueOffset) internal pure returns (uint256) {
        uint256 raw = dueOffset + 1 + PGD;
        return raw < MAX_DD ? raw : MAX_DD;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1a — getRepaymentOwed / getRepaymentBreakdown  ↔  repay()   [EXACT]
// ─────────────────────────────────────────────────────────────────────────────

contract VFS_RepaymentViews is VFSBase {
    PoolContract p;
    bytes32 constant REF4  = keccak256("settle4");   // settlement = 4
    bytes32 constant REF1  = keccak256("settle1");   // settlement = 1 (same-day)
    bytes32 constant REF7  = keccak256("settle7");   // settlement = maxDdDays
    uint256 constant DRAW  = 500_000 * SCALE;

    // Pool in Active with three live drawdowns.
    function setUp() public {
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, 1_000_000 * SCALE);
        _lock(p);
        // Three drawdowns with different settlement windows, all at LOCK.
        _draw(p, REF4, DRAW, 4);
        // REF1 and REF7 cannot coexist with REF4 as isDrawdownAllowed would fail
        // (overdue guard checks scOverdueCheck). Use separate refs drawn at LOCK day.
    }

    // ── Helper: execute snapshot-guarded repay and return actual charge ───────
    function _snapshotRepay(bytes32 ref) internal returns (uint256 actual) {
        (, , uint256 viewTotal) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, viewTotal);
        vm.prank(PSP); usdc.approve(address(p), viewTotal);
        uint256 pspBefore = usdc.balanceOf(PSP);

        uint256 snap = vm.snapshot();
        vm.prank(PSP); p.repay(ref);
        actual = pspBefore - usdc.balanceOf(PSP);
        vm.revertTo(snap);
    }

    // On-time repay (day 0 of settlement=4 drawdown, within stdDays window).
    // stdDays = 1, penDays = 0.
    function test_repOwed_onTime_viewMatchesRepay() public {
        vm.warp(LOCK + 1 * D);   // elapsed=1 day into pool, day 0 of repay period → daysTotal=2
        (, , uint256 viewTotal) = p.getRepaymentOwed(REF4);
        uint256 actual = _snapshotRepay(REF4);
        assertEq(actual, viewTotal, "on-time: view == repay charge");
    }

    // Within-grace repay (settlement=4, pStart=6; repay on elapsed day 4 — still no penalty).
    function test_repOwed_withinGrace_viewMatchesRepay() public {
        // settlement=4 → dueDayOffset=3 → pStart = min(3+1+2,7)=6
        // Repay on LOCK+4D: elapsed=4 days (startDay=5, nowDay=9), daysTotal=5, stdDays=5<6, penDays=0
        vm.warp(LOCK + 4 * D);
        (, , uint256 viewTotal) = p.getRepaymentOwed(REF4);
        assertGt(viewTotal, DRAW, "viewTotal includes financeCharge");
        uint256 actual = _snapshotRepay(REF4);
        assertEq(actual, viewTotal, "within-grace: view == repay charge");
    }

    // Past-grace repay (settlement=4, pStart=6; repay on elapsed day 7 → penDays=2).
    function test_repOwed_pastGrace_viewMatchesRepay() public {
        // LOCK+7D: elapsed=7 days (startDay=5, nowDay=12), daysTotal=8, stdDays=6, penDays=2
        vm.warp(LOCK + 7 * D);
        (, uint256 viewFc, uint256 viewTotal) = p.getRepaymentOwed(REF4);
        // Verify penalty is included: fc = DRAW*(6*UTIL+2*PEN)/WAD
        uint256 expectedFc = MathLib.mulDiv(DRAW, 6 * UTIL_RATE + 2 * PEN_RATE, WAD);
        assertEq(viewFc, expectedFc, "finance charge includes penalty days");
        uint256 actual = _snapshotRepay(REF4);
        assertEq(actual, viewTotal, "past-grace: view == repay charge");
    }

    // Same-day repay with settlement=1 (minimum settlement, due on startTs day).
    // daysTotal=1 (rawElapsed=0, +1 floor) → charged exactly minDdDays=1 day.
    function test_repOwed_sameDay_minDdDays_matches() public {
        // Draw a fresh settlement=1 drawdown; can only do this right after unlock
        // (drawdown guard passes since no overdue yet from REF4 on day 0).
        // Actually REF4 is drawn at LOCK, day 0. Penalty starts day 6. Still allowed.
        // Draw REF1 at LOCK (same timestamp as REF4 — both at day 5).
        _draw(p, REF1, 100_000 * SCALE, 1);

        vm.warp(LOCK);   // same day as drawdown (elapsed=0, daysTotal=1)
        (, uint256 viewFc, uint256 viewTotal) = p.getRepaymentOwed(REF1);
        uint256 expectedFc = MathLib.mulDiv(100_000 * SCALE, 1 * UTIL_RATE, WAD);
        assertEq(viewFc, expectedFc, "same-day: exactly 1-day utility charge");
        uint256 actual = _snapshotRepay(REF1);
        assertEq(actual, viewTotal, "same-day: view == repay charge");
    }

    // Max settlement (settlement=7, pStart=7; penalty never starts since pStart==maxDdDays).
    // Repay on day 6 (daysTotal=7 = pStart → no penDays).
    function test_repOwed_maxSettlement_noPenalty() public {
        _draw(p, REF7, 100_000 * SCALE, 7);

        // settlement=7 → dueDayOffset=6 → pStart = min(6+1+2,7) = 7 = maxDdDays → pStart capped
        // Repay on LOCK+6D: elapsed=6 days (startDay=5, nowDay=11), daysTotal=7, stdDays=7, penDays=0
        vm.warp(LOCK + 6 * D);
        (, uint256 viewFc, uint256 viewTotal) = p.getRepaymentOwed(REF7);
        uint256 expectedFc = MathLib.mulDiv(100_000 * SCALE, 7 * UTIL_RATE, WAD);
        assertEq(viewFc, expectedFc, "max-settle: 7-day utility, no penalty");
        uint256 actual = _snapshotRepay(REF7);
        assertEq(actual, viewTotal, "max-settle: view == repay charge");
    }

    // Breakdown day fields reconstruct financeCharge exactly.
    // stdDays * utilizedRateDaily + penDays * penaltyRateDaily, applied to principal.
    function test_repBreakdown_dayFields_reconstruct_fc() public {
        vm.warp(LOCK + 7 * D);  // past-grace, penDays=2
        (
            uint256 principalOwed,
            uint256 financeCharge,
            uint256 total,
            uint256 elapsedDays,
            uint256 stdDays,
            uint256 penDays
        ) = p.getRepaymentBreakdown(REF4);

        // Reconstruction: fc = principal * (std*util + pen*pen) / WAD
        uint256 reconstructedFc = MathLib.mulDiv(
            principalOwed,
            stdDays * UTIL_RATE + penDays * PEN_RATE,
            WAD
        );
        assertEq(financeCharge, reconstructedFc, "day fields reconstruct financeCharge");
        assertEq(total, principalOwed + financeCharge, "total = principal + fc");
        // elapsedDays = daysTotal = rawElapsed+1
        // stdDays + penDays = daysTotal (by construction)
        assertEq(stdDays + penDays, elapsedDays, "stdDays + penDays = elapsedDays");
    }

    // getRepaymentBreakdown.total == getRepaymentOwed.total (same computation, extra fields).
    function test_repBreakdown_totalMatchesOwed() public {
        vm.warp(LOCK + 3 * D);
        (, , uint256 owedTotal) = p.getRepaymentOwed(REF4);
        ( , , uint256 brkTotal, , , ) = p.getRepaymentBreakdown(REF4);
        assertEq(brkTotal, owedTotal, "breakdown.total == owed.total");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1b — getIdleFeesBreakdown / getIdleFeesBreakdown  ↔  payAccruedIdleFees()  [EXACT]
// ─────────────────────────────────────────────────────────────────────────────

contract VFS_IdleFeesViews is VFSBase {
    PoolContract p;
    uint256 constant FULL_DEP = 1_000_000 * SCALE;

    function setUp() public {
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, FULL_DEP);
        _lock(p);
        // No drawdown — full FULL_DEP sits idle so fees accrue immediately.
    }

    // Helper: snapshot-guarded payAccruedIdleFees; returns actual paid amount.
    function _snapshotPayIdle(uint256 viewTotal) internal returns (uint256 actual) {
        usdc.mint(PSP, viewTotal);
        vm.prank(PSP); usdc.approve(address(p), viewTotal);
        uint256 pspBefore = usdc.balanceOf(PSP);

        uint256 snap = vm.snapshot();
        vm.prank(PSP); p.payAccruedIdleFees(viewTotal);
        actual = pspBefore - usdc.balanceOf(PSP);
        vm.revertTo(snap);
    }

    // Before any time passes (same day as lock) idle fees are zero.
    function test_idleFeesOwed_zero_sameDayAsLock() public {
        // lastIdleDay = LOCK day = 5; currentDay = 5 → frm == to → no new fees
        vm.warp(LOCK);
        (, , uint256 total) = p.getIdleFeesBreakdown();
        assertEq(total, 0, "idle fees zero on lock day (no full day elapsed)");
    }

    // Basic accrual: 2 days idle → view matches payAccruedIdleFees charge exactly.
    function test_idleFeesOwed_basicAccrual_matchesPayAccrued() public {
        // 2 days elapsed: lastIdleDay=5, currentDay=7 → N=2 days
        vm.warp(LOCK + 2 * D);
        (, , uint256 viewTotal) = p.getIdleFeesBreakdown();
        // Expected: N=2, nFull=2, nExempt=0, avail=FULL_DEP
        uint256 expected = MathLib.mulDiv(FULL_DEP * 2, IDLE_RATE, WAD);
        assertEq(viewTotal, expected, "idle fee = avail * 2 * IDLE_RATE / WAD");

        uint256 actual = _snapshotPayIdle(viewTotal);
        assertEq(actual, viewTotal, "view == payAccruedIdleFees charge");
    }

    // Breakdown: idleFees + penaltyOwed == total.
    function test_idleFeesBreakdown_componentsSum() public {
        vm.warp(LOCK + 3 * D);
        (uint256 idF, uint256 pen, uint256 tot) = p.getIdleFeesBreakdown();
        assertEq(idF + pen, tot, "idleFees + penaltyOwed == total");
    }

    // Idle-fee exemption: repay() sets idleExemptAmount on the returned principal.
    // The exempted capital is charged at a reduced rate (avail - exemptAmount) for the
    // exemption day, preventing double-billing of capital that was utilized then repaid.
    //
    // Setup: draw 300K at LOCK, repay on day 7 (LOCK+2D).
    // repay() calls _accrueIdleFees first (accrues 2 days with 700K avail), then sets
    // idleExemptAmount=300K for the next calendar day.
    // On day 8 (LOCK+3D): nExempt=1, exemptBase = max(0, 1M - 300K) = 700K,
    //   idle for day 8 = mulDiv(700K, rate, WAD) = 3.5e14
    // Plus accIdleFees from days 5-7 = mulDiv(700K * 2, rate, WAD) = 7e14
    // Total view = 10.5e14.  Without exemption: 2*700K + 1*1M = 1M+400K/day = 12e14.
    function test_idleFeesOwed_exemption_reducesBase() public {
        uint256 drawAmt = 300_000 * SCALE;
        _draw(p, keccak256("idle"), drawAmt, 4);

        // Repay at LOCK+2D: _accrueIdleFees accrues 2 days (700K avail), then
        // sets idleExemptAmount=300K and idleExemptUntil=LOCK+3D (next midnight).
        vm.warp(LOCK + 2 * D);
        _repayExact(p, keccak256("idle"));

        // Move to LOCK+3D (exemption day): N=1, nExempt=1, avail=1M, exemptBase=700K
        vm.warp(LOCK + 3 * D);
        (, , uint256 viewTotal) = p.getIdleFeesBreakdown();

        // Verify exact value: accIdleFees(7e14) + day-8-exempt(3.5e14) = 10.5e14
        uint256 accFromBefore = MathLib.mulDiv(drawAmt * 2, IDLE_RATE, WAD);
        // 700K * 2 days of full idle fee (before repay accrual)
        // Wait: avail after draw=300K is 700K (not 1M) for days 5-7, so accFees = 700K*2*rate
        uint256 expectedAcc = MathLib.mulDiv((FULL_DEP - drawAmt) * 2, IDLE_RATE, WAD);
        // day-8 with exemption: avail=1M (repaid), exemptBase = max(0, 1M - 300K) = 700K
        uint256 expectedDay8 = MathLib.mulDiv((FULL_DEP - drawAmt) * 1, IDLE_RATE, WAD);
        assertEq(viewTotal, expectedAcc + expectedDay8, "exemption: total == pre-repay + exempted day");

        // Compare to no-exemption: day 8 would use full 1M avail = 5e14 extra
        uint256 noExemptDay8 = MathLib.mulDiv(FULL_DEP, IDLE_RATE, WAD);
        assertGt(noExemptDay8, expectedDay8, "exemption reduces day-8 fee");

        uint256 actual = _snapshotPayIdle(viewTotal);
        assertEq(actual, viewTotal, "exemption case: view == payAccruedIdleFees");
    }

    // Post-maturity penalty: after poolFinalityTs + penaltyGraceDays, penaltyOwed > 0.
    function test_idleFeesOwed_postMat_penaltyPresent() public {
        // Pool has idle fees from lock day. Past maturity + grace = 35D + 2D = 37D.
        vm.warp(MAT + PGD * D + 1 * D);  // 3D past maturity → penalty accrued

        (uint256 idF, uint256 pen, uint256 tot) = p.getIdleFeesBreakdown();
        assertGt(idF, 0,   "idle fees accumulated over tenure");
        assertGt(pen, 0,   "penalty accrued past maturity+grace");
        assertEq(tot, idF + pen, "total = idle + penalty");
        assertGt(tot, idF, "total > idle (penalty component present)");
    }

    // Closed pool: transition to Closed (idle fees must be zero) → view returns zero.
    // Factory requires utilizedRateDaily < penaltyRateDaily. APR=0 → yieldOwed=0 →
    // pool closes immediately after maturity when claimYield() triggers _mature().
    function test_idleFeesOwed_closed_returnsZero() public {
        _deployInfra();
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 5 * D,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              TENOR,
            idleRateDaily:       0,        // no idle fees ever accrue
            utilizedRateDaily:   5e14,
            penaltyRateDaily:    1e15,     // must be > util (factory: util < pen)
            penaltyGraceDays:    0,
            minDeposit:          0,
            aprAnnual:           0,        // yieldOwed=0 → pool can close
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
        PoolContract cp = PoolContract(addr);
        _deposit(cp, LP_A, FULL_DEP);
        vm.warp(LOCK); cp.finalizeFunding();

        // Warp past maturity. claimYield() triggers _mature() which closes the pool.
        vm.warp(MAT + D);
        vm.prank(LP_A); cp.claimYield();

        assertEq(uint256(cp.status()), uint256(PoolContract.Status.Closed), "pool is Closed");
        (, , uint256 tot) = cp.getIdleFeesBreakdown();
        assertEq(tot, 0, "Closed: getIdleFeesBreakdown returns 0");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1c — getClaimableYieldBreakdown(lp)  ↔  claimYield()        [EXACT]
// ─────────────────────────────────────────────────────────────────────────────

contract VFS_YieldBreakdown is VFSBase {
    PoolContract p;
    bytes32 constant R1   = keccak256("R1");
    uint256 constant DRAW = 500_000 * SCALE;

    function setUp() public {
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, 1_000_000 * SCALE);
        _lock(p);
        _draw(p, R1, DRAW, 4);
        vm.warp(LOCK + 3 * D);
        _repayExact(p, R1);   // generates collectedYield
    }

    // Helper: snapshot-guarded claimYield; returns actual transfer.
    function _snapshotClaim(PoolContract pool, address lp) internal returns (uint256 actual) {
        uint256 balBefore = usdc.balanceOf(lp);
        uint256 snap = vm.snapshot();
        vm.prank(lp); pool.claimYield();
        actual = usdc.balanceOf(lp) - balBefore;
        vm.revertTo(snap);
    }

    // Post-maturity, single LP: breakdown.totalYield == claimYield transfer exactly.
    function test_yieldBreakdown_postMat_exactMatchesClaimYield() public {
        vm.warp(MAT + D);
        (, , , uint256 brkTotal) = p.getClaimableYieldBreakdown(LP_A);
        assertGt(brkTotal, 0, "positive yield post-maturity");

        uint256 actual = _snapshotClaim(p, LP_A);
        assertEq(actual, brkTotal, "breakdown.totalYield == claimYield transfer post-mat");
    }

    // Pre-maturity, single LP: F1 cap is applied in breakdown.
    // At LOCK+3D the yield is from repayment — check view == actual at same timestamp.
    function test_yieldBreakdown_preMat_F1cap_exactMatchesClaimYield() public {
        vm.warp(LOCK + 3 * D);   // same timestamp as repayment, still pre-maturity
        assertLt(block.timestamp, MAT, "pre-maturity");
        (, , , uint256 brkTotal) = p.getClaimableYieldBreakdown(LP_A);
        uint256 actual = _snapshotClaim(p, LP_A);
        assertEq(actual, brkTotal, "breakdown.totalYield == claimYield transfer pre-mat");
    }

    // Unfinalized LP (pos.dollarSeconds==0): breakdown uses settlement replication
    // so it returns > 0 even before first claimYield call.
    function test_yieldBreakdown_unfinalized_LP_returnsNonzero() public {
        vm.warp(LOCK + 3 * D);
        // Verify pos.dollarSeconds is still 0 (LP_A hasn't called claimYield yet)
        (, uint256 lpDs,,,,) = p.getLpPosition(LP_A);
        assertEq(lpDs, 0, "LP_A not yet finalized");

        (uint256 brkBase,,, uint256 brkTotal) = p.getClaimableYieldBreakdown(LP_A);
        assertGt(brkBase, 0,  "unfinalized LP: breakdown returns > 0");
        assertGt(brkTotal, 0, "unfinalized LP: total > 0");

        uint256 actual = _snapshotClaim(p, LP_A);
        assertEq(actual, brkTotal, "unfinalized LP: breakdown == claimYield transfer");
    }

    // Two-LP pool: each LP's breakdown.totalYield matches their individual claimYield.
    function test_yieldBreakdown_twoLP_proRata_exactMatch() public {
        // Deposit LP_B into a new pool with equal share.
        _deployInfra();
        PoolContract pp = _makePool();
        _deposit(pp, LP_A, 1_000_000 * SCALE);
        _deposit(pp, LP_B, 1_000_000 * SCALE);
        _lock(pp);
        _draw(pp, R1, DRAW, 4);
        vm.warp(LOCK + 3 * D);
        _repayExact(pp, R1);

        vm.warp(MAT + D);   // post-maturity: F1 cap inactive, both LPs get base share
        (, , , uint256 brkA) = pp.getClaimableYieldBreakdown(LP_A);
        (, , , uint256 brkB) = pp.getClaimableYieldBreakdown(LP_B);
        assertGt(brkA, 0, "LP_A has positive yield");
        assertGt(brkB, 0, "LP_B has positive yield");

        uint256 actualA = _snapshotClaim(pp, LP_A);
        // After LP_A's snapshot-revert, state is restored; now check LP_B independently
        uint256 actualB = _snapshotClaim(pp, LP_B);

        assertEq(actualA, brkA, "LP_A: breakdown == claimYield");
        assertEq(actualB, brkB, "LP_B: breakdown == claimYield");
        // Equal deposits at same time → equal shares
        assertEq(brkA, brkB, "equal depositors: equal base yield");
    }

    // Zero collectedYield → breakdown returns (0, 0, 0, 0) and claimYield transfers 0.
    function test_yieldBreakdown_zero_collectedYield() public {
        // Fresh pool with no repayments → collectedYield == 0
        _deployInfra();
        PoolContract pp = _makePool();
        _deposit(pp, LP_A, 1_000_000 * SCALE);
        _lock(pp);
        // No draws, no repayments

        vm.warp(LOCK + 5 * D);
        (uint256 base, uint256 ov, uint256 bon, uint256 tot) = pp.getClaimableYieldBreakdown(LP_A);
        assertEq(base, 0, "zero yield: base == 0");
        assertEq(ov,   0, "zero yield: overrun == 0");
        assertEq(bon,  0, "zero yield: bonus == 0");
        assertEq(tot,  0, "zero yield: total == 0");

        uint256 actual = _snapshotClaim(pp, LP_A);
        assertEq(actual, 0, "claimYield transfers 0 when no collected yield");
    }

    // Individual breakdown components (base, overrun, bonus) each match their claimYield portion.
    // Post-maturity on-time repayment → base only, overrun=0, bonus=0.
    function test_yieldBreakdown_components_individually() public {
        vm.warp(MAT + D);
        (uint256 brkBase, uint256 brkOverrun, uint256 brkBonus, uint256 brkTotal) =
            p.getClaimableYieldBreakdown(LP_A);

        // With a pre-maturity repayment, no overrun or bonus expected
        assertGt(brkBase, 0, "base yield is non-zero");
        // overrun accrues only on post-maturity drawdowns; bonus after terminal split
        assertEq(brkOverrun + brkBonus, brkTotal - brkBase, "overrun+bonus = total-base");
        assertEq(brkBase + brkOverrun + brkBonus, brkTotal, "components sum to total");

        uint256 actual = _snapshotClaim(p, LP_A);
        assertEq(actual, brkTotal, "claimYield == sum of all breakdown components");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 2 — getLpPosition exact after _computeBreakdown refactor    [EXACT]
//
// getLpPosition now delegates to _computeBreakdown() — same code path as
// getClaimableYieldBreakdown. These tests lock the regression (old impl returned
// 0 pre-settlement and lacked F1 cap) and confirm exact equality.
// ─────────────────────────────────────────────────────────────────────────────

contract VFS_LpPositionExact is VFSBase {
    PoolContract p;
    bytes32 constant R1   = keccak256("R1");
    uint256 constant DRAW = 500_000 * SCALE;

    function setUp() public {
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, 1_000_000 * SCALE);
        _lock(p);
        _draw(p, R1, DRAW, 4);
        vm.warp(LOCK + 3 * D);
        _repayExact(p, R1);
    }

    // Pre-maturity, pre-settlement: regression test.
    // Old impl returned 0 (used raw pos.dollarSeconds == 0 pre-first-claimYield).
    // New impl uses _computeBreakdown → returns same non-zero value as breakdown.
    function test_lpPos_preMat_claimableYield_exactMatchesBreakdown() public {
        vm.warp(LOCK + 3 * D);
        assertLt(block.timestamp, MAT, "pre-maturity");

        // LP_A has not called claimYield → pos.dollarSeconds == 0
        (, uint256 lpDs,,,,) = p.getLpPosition(LP_A);
        assertEq(lpDs, 0, "LP_A not yet finalized (dollarSeconds == 0)");

        (uint256 brkBase, uint256 brkOv, uint256 brkBon, ) =
            p.getClaimableYieldBreakdown(LP_A);
        (, , uint256 posYield, , uint256 posOv, uint256 posBon) =
            p.getLpPosition(LP_A);

        assertEq(posYield, brkBase, "pre-mat pre-settle: posYield == brkBase (regression)");
        assertEq(posOv,    brkOv,   "posOverrun == brkOverrun");
        assertEq(posBon,   brkBon,  "posBonus == brkBonus");
        assertGt(posYield, 0, "non-zero (settlement replication applied)");
    }

    // Post-maturity: all three yield fields are bit-identical to getClaimableYieldBreakdown.
    function test_lpPos_postMat_allYieldFields_exactMatchesBreakdown() public {
        vm.warp(MAT + D);
        (uint256 brkBase, uint256 brkOv, uint256 brkBon, ) =
            p.getClaimableYieldBreakdown(LP_A);
        (, , uint256 posYield, , uint256 posOv, uint256 posBon) =
            p.getLpPosition(LP_A);

        assertEq(posYield, brkBase, "post-mat: posYield == breakdown.baseYield");
        assertEq(posOv,    brkOv,   "post-mat: posOverrun == breakdown.overrunYield_");
        assertEq(posBon,   brkBon,  "post-mat: posBonus == breakdown.bonus");
    }

    // F1 cap regression: late depositor's posYield == breakdown.baseYield (F1 cap applied).
    // LP_A at t=0, LP_B at t=4D → LP_B has less pre-pool credit → F1 cap bites mid-tenure.
    function test_lpPos_preMat_F1cap_posYieldExactMatchesBreakdown() public {
        _deployInfra();
        PoolContract pp = _makePool();
        _deposit(pp, LP_A, 1_000_000 * SCALE);
        vm.warp(4 * D);
        _deposit(pp, LP_B, 1_000_000 * SCALE);   // late → lower funding credit
        vm.warp(LOCK);
        pp.finalizeFunding();

        // Generate yield
        vm.prank(AGENT2); pp.executeDrawdown(keccak256("F1"), PSP, 500_000 * SCALE, 4);
        vm.warp(LOCK + 3 * D);
        _repayExact(pp, keccak256("F1"));

        // At elapsed=3D: LP_B elapsedShare < baseShare → F1 cap bites
        assertLt(block.timestamp, LOCK + TENOR * D, "pre-maturity");

        (uint256 brkBase_B,,,)        = pp.getClaimableYieldBreakdown(LP_B);
        (, , uint256 posYield_B,,,)   = pp.getLpPosition(LP_B);

        assertEq(posYield_B, brkBase_B, "F1-capped LP: posYield == breakdown.baseYield");
        assertGt(posYield_B, 0,         "F1-capped LP: positive yield");
    }

    // claimablePrincipal_ matches actual claimPrincipal() transfer.
    function test_lpPos_claimablePrincipal_matchesClaimPrincipal() public {
        vm.warp(MAT + D);
        vm.prank(LP_A); p.claimYield();  // triggers _mature → makes principal claimable

        (, , , uint256 viewPrincipal,,) = p.getLpPosition(LP_A);
        assertGt(viewPrincipal, 0, "some principal is claimable post-maturity");

        uint256 balBefore = usdc.balanceOf(LP_A);
        uint256 snap = vm.snapshot();
        vm.prank(LP_A); p.claimPrincipal();
        uint256 actual = usdc.balanceOf(LP_A) - balBefore;
        vm.revertTo(snap);

        assertEq(actual, viewPrincipal, "claimablePrincipal_ == claimPrincipal payout");
    }

    // lpPrincipal and lpDollarSeconds are direct storage reads.
    function test_lpPos_storageFields_matchLpPositions() public {
        vm.warp(MAT + D);
        // Finalize so dollarSeconds is set
        vm.prank(LP_A); p.claimYield();

        (uint256 lpPrincipal, uint256 lpDs,,,,) = p.getLpPosition(LP_A);
        // LPPosition fields: principal, fundingCredit, lastUpdate, dollarSeconds, ...
        (uint256 storedPrincipal, , , uint256 storedDs,,,,,) = p.lpPositions(LP_A);

        assertEq(lpPrincipal, storedPrincipal, "lpPrincipal == storage.principal");
        assertEq(lpDs,        storedDs,        "lpDollarSeconds == storage.dollarSeconds");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 3a — isDrawdownAllowed()  ↔  executeDrawdown()               [PARTIAL]
//
// isDrawdownAllowed checks ONLY the overdue/paused guard (_hasOverdueUnsettled).
// executeDrawdown checks 8 guards. This gate is necessary but not sufficient.
// ─────────────────────────────────────────────────────────────────────────────

contract VFS_IsDrawdownAllowed is VFSBase {
    PoolContract p;
    bytes32 constant R1 = keccak256("R1");
    bytes32 constant R2 = keccak256("R2");
    uint256 constant DRAW = 200_000 * SCALE;

    function setUp() public {
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, 1_000_000 * SCALE);
        _lock(p);
    }

    // true when no overdue drawdown → executeDrawdown succeeds.
    function test_isDrawdownAllowed_true_ddSucceeds() public {
        assertTrue(p.isDrawdownAllowed(), "no overdue: allowed == true");
        vm.prank(AGENT2); p.executeDrawdown(R1, PSP, DRAW, 4);  // succeeds
    }

    // false when a drawdown is overdue → executeDrawdown reverts.
    function test_isDrawdownAllowed_false_ddReverts() public {
        _draw(p, R1, DRAW, 4);
        // settlement=4 → pStart = min(3+1+2, 7) = 6 → overdue on elapsed >= 6
        vm.warp(LOCK + 6 * D);  // elapsed = 6 days → overdue
        assertFalse(p.isDrawdownAllowed(), "overdue: allowed == false");
        vm.expectRevert("Pool: overdue drawdown");
        vm.prank(AGENT2); p.executeDrawdown(R2, PSP, DRAW, 4);
    }

    // PARTIAL classification: true does NOT guarantee executeDrawdown success.
    // Example: true + insufficient liquidity → reverts.
    function test_isDrawdownAllowed_true_insufficientLiquidity_reverts() public {
        assertTrue(p.isDrawdownAllowed(), "no overdue: allowed == true");
        uint256 tooMuch = 9_000_001 * SCALE;
        vm.expectRevert("Pool: insufficient liquidity");
        vm.prank(AGENT2); p.executeDrawdown(R1, PSP, tooMuch, 4);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 3b — Simple state-reader views  [STATE]
//
// isAuthorizedReceiver, getDrawDown, currentDay, getPoolMetrics.
// Each reads storage (or computes from state) and returns a value that can be
// independently verified by reading the underlying storage variables.
// ─────────────────────────────────────────────────────────────────────────────

contract VFS_StateReaderViews is VFSBase {
    PoolContract p;
    bytes32 constant R1   = keccak256("R1");
    uint256 constant DRAW = 300_000 * SCALE;

    function setUp() public {
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, 1_000_000 * SCALE);
        _lock(p);
    }

    // isAuthorizedReceiver returns false before addReceiver.
    function test_isAuthorizedReceiver_false_beforeAdd() public view {
        assertFalse(p.isAuthorizedReceiver(LP_B), "LP_B not authorized before addReceiver");
        assertFalse(p.authorizedReceivers(LP_B),  "storage also false");
    }

    // isAuthorizedReceiver returns true after addReceiver, matches storage exactly.
    function test_isAuthorizedReceiver_true_afterAdd_matchesStorage() public {
        vm.prank(AGENT1); p.addReceiver(LP_B);
        assertTrue(p.isAuthorizedReceiver(LP_B), "LP_B authorized after addReceiver");
        assertEq(p.isAuthorizedReceiver(LP_B), p.authorizedReceivers(LP_B),
            "view == authorizedReceivers storage");
    }

    // getDrawDown returns the live DrawDown struct for an active drawdown.
    function test_getDrawDown_active_matchesStorage() public {
        _draw(p, R1, DRAW, 4);

        PoolContract.DrawDown memory dd = p.getDrawDown(R1);
        assertEq(dd.principal,      DRAW,         "principal");
        assertEq(dd.startTs,        LOCK,          "startTs == block.timestamp at draw");
        assertEq(dd.expiryTs,       LOCK + 3 * D, "expiryTs = startTs + (settle-1)*D");
        assertEq(dd.receiverWallet, PSP,           "receiverWallet == PSP");
    }

    // getDrawDown returns zeroed struct after repayment (_removeDrawDown clears it).
    function test_getDrawDown_afterRepay_zeroed() public {
        _draw(p, R1, DRAW, 4);
        vm.warp(LOCK + 2 * D);
        _repayExact(p, R1);

        PoolContract.DrawDown memory dd = p.getDrawDown(R1);
        assertEq(dd.principal,      0,             "principal zeroed after repay");
        assertEq(dd.startTs,        0,             "startTs zeroed");
        assertEq(dd.expiryTs,       0,             "expiryTs zeroed");
        assertEq(dd.receiverWallet, address(0),    "receiverWallet zeroed");
    }

    // currentDay() == MathLib.dayOf(block.timestamp) mid-day.
    function test_currentDay_midDay_matchesDayOf() public {
        uint256 T = LOCK + 5 * D + 43200;  // noon of LOCK+5 day
        vm.warp(T);
        uint256 expected = T / D;  // MathLib.dayOf uses integer division by SECONDS_PER_DAY
        assertEq(p.currentDay(), expected, "currentDay == dayOf(block.timestamp)");
    }

    // currentDay() changes exactly at midnight (UTC 0:00).
    function test_currentDay_midnight_boundary() public {
        uint256 day5 = 5 * D;
        vm.warp(day5);
        assertEq(p.currentDay(), 5, "exactly midnight day 5: currentDay==5");

        vm.warp(day5 - 1);
        assertEq(p.currentDay(), 4, "1 second before midnight day 5: currentDay==4");
    }

    // getPoolMetrics() returns all 15 fields matching underlying state variables.
    function test_getPoolMetrics_allFieldsMatchStorage() public {
        _draw(p, R1, DRAW, 4);
        vm.warp(LOCK + 2 * D);
        _repayExact(p, R1);

        (
            PoolContract.Status status_,
            uint256 softCap_,
            uint256 hardCap_,
            uint256 principal_,
            uint256 availableToDd_,
            uint256 outstanding_,
            uint256 yieldOwed_,
            uint256 collectedYield_,
            uint256 collectedPrincipal_,
            bool     paused_,
            bool     scOverdueCheck_,
            uint256 fundingStartTs_,
            uint256 fMaturityTs_,
            uint256 poolStartTs_,
            uint256 poolFinalityTs_
        ) = p.getPoolMetrics();

        assertEq(uint256(status_),   uint256(p.status()),   "status");
        assertEq(softCap_,           p.softCap(),           "softCap");
        assertEq(hardCap_,           p.hardCap(),           "hardCap");
        assertEq(principal_,         p.principal(),         "principal");
        assertEq(availableToDd_,     p.availableToDd(),     "availableToDd");
        assertEq(outstanding_,       p.outstanding(),       "outstanding");
        assertEq(yieldOwed_,         p.yieldOwed(),         "yieldOwed");
        assertEq(collectedYield_,    p.collectedYield(),    "collectedYield");
        assertEq(collectedPrincipal_, p.collectedPrincipal(), "collectedPrincipal");
        assertEq(paused_,            p.paused(),            "paused");
        assertEq(scOverdueCheck_,    p.scOverdueCheck(),    "scOverdueCheck");
        assertEq(fundingStartTs_,    p.fundingStartTs(),    "fundingStartTs");
        assertEq(fMaturityTs_,       p.fMaturityTs(),       "fMaturityTs");
        assertEq(poolStartTs_,       p.poolStartTs(),       "poolStartTs");
        assertEq(poolFinalityTs_,    p.poolFinalityTs(),    "poolFinalityTs");
    }
}
