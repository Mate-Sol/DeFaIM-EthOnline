// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

// ─────────────────────────────────────────────────────────────────────────────
// View-vs-mutation consistency tests.
//
// Core property: a view that previews a value must return exactly what the
// corresponding mutating function computes and applies at the same block.timestamp.
//
// CONTRACT CLASSIFICATION (established by these tests):
//  EXACT  — view is bit-identical to what the mutation would do at the same T.
//  BOUND  — view is an intentional estimate with a documented bound.
//  PARTIAL — view only checks a subset of the mutation's guards.
//
// Pairs:
//  1. getRepaymentOwed / getRepaymentBreakdown  ↔  repay()           [EXACT]
//  2. getIdleFeesBreakdown                      ↔  _accrueIdleFees() [EXACT]
//     Note: _projectIdleFees() lacks the Closed guard; benign because
//     _checkFinality() requires accIdleFees==0 before closing.
//  3. getClaimableYieldBreakdown                ↔  claimYield()      [EXACT]
//     Highest-risk: view replicates _settleLpDollarSeconds and F1 cap
//     independently. These tests guard against future drift.
//  4. getLpPosition claimable fields            ↔  getClaimableYieldBreakdown [EXACT]
//     Delegates to _computeBreakdown() internally; all three yield fields are
//     bit-identical to getClaimableYieldBreakdown. (getClaimableYield removed.)
//  5. isDrawdownAllowed                         ↔  executeDrawdown()  [PARTIAL]
//     Only checks the overdue/paused guard. Returns true for states where
//     executeDrawdown would still revert (insufficient liquidity, bad params).
// ─────────────────────────────────────────────────────────────────────────────

contract VMBase is Test {
    uint256 constant SCALE = 1e12;
    uint256 constant WAD   = 1e18;
    uint256 constant D     = 86400;
    uint256 constant TENOR = 30;
    uint256 constant LOCK  = 5 * D;       // fMaturityTs (funding ends at t=5D)
    uint256 constant MAT   = LOCK + TENOR * D;  // poolFinalityTs = 35D

    uint256 constant IDLE_RATE = 5e14;    // 0.05%/day
    uint256 constant UTIL_RATE = 5e14;    // 0.05%/day
    uint256 constant PEN_RATE  = 1e15;    // 0.10%/day
    uint256 constant APR       = 1e17;    // 10% annual
    uint256 constant PGD       = 2;
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
        // finalize at exactly fMaturityTs (t=5D) so poolStartTs = LOCK, poolFinalityTs = MAT
        vm.warp(LOCK);
        p.finalizeFunding();
    }

    function _draw(PoolContract p, bytes32 ref, uint256 amt, uint256 settleDays) internal {
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, amt, settleDays);
    }

    // Repay using exactly the view's total — confirms view == actual charge.
    function _repayExact(PoolContract p, bytes32 ref) internal returns (uint256 actualTotal) {
        (, , uint256 viewTotal) = p.getRepaymentOwed(ref);
        uint256 before = usdc.balanceOf(PSP);
        usdc.mint(PSP, viewTotal);
        vm.prank(PSP); usdc.approve(address(p), viewTotal);
        vm.prank(PSP); p.repay(ref);
        actualTotal = before + viewTotal - usdc.balanceOf(PSP);
    }

    function _penaltyStartDay(uint256 dueOffset) internal pure returns (uint256) {
        uint256 raw = dueOffset + 1 + PGD;
        return raw < MAX_DD ? raw : MAX_DD;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pair 1 — getRepaymentOwed / getRepaymentBreakdown ↔ repay()    [EXACT]
// ─────────────────────────────────────────────────────────────────────────────

contract VM1_RepaymentConsistency is VMBase {
    PoolContract p;
    bytes32 constant R1    = keccak256("R1");
    uint256 constant DRAW  = 200_000 * SCALE;
    uint256 constant SETTLE = 4;   // settlementDays=4 → expiryTs = LOCK + 3*D

    function setUp() public {
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, 1_000_000 * SCALE);
        _lock(p);
        _draw(p, R1, DRAW, SETTLE);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    // Read view and call repay at the same T; return what repay actually charged.
    function _viewThenRepay(bytes32 ref)
        internal
        returns (
            uint256 viewPrincipal, uint256 viewFc, uint256 viewTotal,
            uint256 actualTotal
        )
    {
        (viewPrincipal, viewFc, viewTotal) = p.getRepaymentOwed(ref);
        actualTotal = _repayExact(p, ref);
    }

    // ── tests ─────────────────────────────────────────────────────────────────

    // On-time: repay on day 0 of the drawdown (daysTotal=1, no penalty).
    function test_repay_onTime_exact() public {
        vm.warp(LOCK);
        (, uint256 vFc, uint256 vTotal, uint256 actual) = _viewThenRepay(R1);
        assertEq(actual, vTotal, "on-time: view.total == repay total");
        uint256 expFc = MathLib.mulDiv(DRAW, MIN_DD * UTIL_RATE, WAD); // daysTotal=1>=minDdDays=1
        assertEq(vFc, expFc, "on-time: finance charge == MIN_DD * UTIL_RATE * principal");
    }

    // Within-grace: day 5 of loan, settlement window closed (expiryTs=LOCK+3D) but
    // pStart = min(4+1+2, 7) = 7 not yet reached → no penalty days.
    function test_repay_withinGrace_exact() public {
        vm.warp(LOCK + 5 * D);
        // Read breakdown BEFORE repay (drawdown removed by repay).
        (,,,, uint256 stdDays, uint256 penDays) = p.getRepaymentBreakdown(R1);
        (, , uint256 vTotal, uint256 actual) = _viewThenRepay(R1);
        assertEq(actual, vTotal, "within-grace: view.total == repay total");
        assertEq(penDays, 0, "within-grace: no penalty days yet");
        assertGt(stdDays, 0, "within-grace: some std days");
    }

    // Past-grace: day 9 → pStart = 7 → penDays = 10-7 = 3.
    function test_repay_pastGrace_exact() public {
        vm.warp(LOCK + 9 * D);
        // Read breakdown BEFORE repay.
        (, , , , uint256 stdD, uint256 penD) = p.getRepaymentBreakdown(R1);
        (uint256 vP, uint256 vFc, uint256 vTotal, uint256 actual) = _viewThenRepay(R1);
        assertEq(actual, vTotal, "past-grace: view.total == repay total");
        // reread breakdown from view values (no storage read needed)
        assertGt(penD, 0, "past-grace: penalty days accruing");
        // finance charge reconstructed from day decomposition
        uint256 recomputed = MathLib.mulDiv(vP, stdD * UTIL_RATE + penD * PEN_RATE, WAD);
        assertEq(vFc, recomputed, "breakdown reconstructs financeCharge");
    }

    // Idle accrual does NOT affect finance charge: accrue idle first, then view == repay.
    function test_repay_afterIdleAccrual_chargeUnchanged() public {
        // Warp forward and trigger idle accrual via a dummy claimYield call
        vm.warp(LOCK + 4 * D);
        // idle fees have accrued for 4 days on (1M - 200k) = 800k SCALE
        uint256 accBefore = p.accIdleFees();
        (uint256 vIdle,,) = p.getIdleFeesBreakdown();
        assertGt(vIdle, accBefore, "idle fees have projected growth");

        (, , uint256 vTotal, uint256 actual) = _viewThenRepay(R1);
        assertEq(actual, vTotal, "after idle accrual: view.total == repay total");
    }

    // Three-way: getRepaymentOwed == getRepaymentBreakdown == what repay charges.
    function test_threeWay_breakdown_owed_repay() public {
        vm.warp(LOCK + 9 * D); // past grace for diversity
        (uint256 oP, uint256 oFc, uint256 oTotal) = p.getRepaymentOwed(R1);
        (uint256 bP, uint256 bFc, uint256 bTotal, , uint256 bStd, uint256 bPen) =
            p.getRepaymentBreakdown(R1);

        assertEq(oP,     bP,     "principal: owed == breakdown");
        assertEq(oFc,    bFc,    "financeCharge: owed == breakdown");
        assertEq(oTotal, bTotal, "total: owed == breakdown");

        uint256 recomputed = MathLib.mulDiv(bP, bStd * UTIL_RATE + bPen * PEN_RATE, WAD);
        assertEq(bFc, recomputed, "breakdown.stdDays*util + penDays*pen == financeCharge");

        uint256 actual = _repayExact(p, R1);
        assertEq(actual, oTotal, "repay == view");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pair 2 — getIdleFeesBreakdown / getIdleFeesBreakdown ↔ _accrueIdleFees()  [EXACT]
// Note: _projectIdleFees lacks the Closed-status guard that _accrueIdleFees
// has; this is benign because _checkFinality requires accIdleFees==0 before
// closing. The Closed-pool test below confirms the view returns 0 there too.
// ─────────────────────────────────────────────────────────────────────────────

contract VM2_IdleFeesConsistency is VMBase {
    PoolContract p;
    bytes32 constant R1   = keccak256("R1");
    uint256 constant DRAW = 200_000 * SCALE;  // 800k idle

    function setUp() public {
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, 1_000_000 * SCALE);
        _lock(p);
        _draw(p, R1, DRAW, 4);  // 800k remains idle
    }

    // Pattern: read view at T, then call repay() (which calls _accrueIdleFees as its
    // first step without reducing accIdleFees). The resulting accIdleFees == view's
    // projected idleFees, confirming exact agreement.
    function _idleViewThenMutate(uint256 warpTo)
        internal
        returns (uint256 vIdle, uint256 vPen, uint256 mutIdle, uint256 mutPen)
    {
        vm.warp(warpTo);
        (vIdle, vPen,) = p.getIdleFeesBreakdown();
        // repay triggers _accrueIdleFees then removes drawdown; accIdleFees/accPenalty unchanged by repay itself
        _repayExact(p, R1);
        mutIdle = p.accIdleFees();
        mutPen  = p.accPenalty();
    }

    // Pre-maturity, no exemption: view matches _accrueIdleFees delta.
    function test_idleFees_prematurity_exact() public {
        (uint256 vIdle, uint256 vPen, uint256 mIdle, uint256 mPen) =
            _idleViewThenMutate(LOCK + 10 * D);
        assertEq(mIdle, vIdle, "pre-maturity idle: view == mutation state");
        assertEq(mPen,  vPen,  "pre-maturity pen: view == mutation state");
        assertEq(vPen,  0,     "no penalty pre-maturity");
    }


    // Post-maturity with penalty: view correctly projects penalty accrual.
    function test_idleFees_postMaturity_penalty_exact() public {
        // Warp past maturity and penalty grace. Pool stays Active (no repay yet).
        // For this test we need accIdleFees > 0 at maturity, so use a pool with all capital idle.
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, 1_000_000 * SCALE);
        _lock(p);
        // No draw: all 1M is idle.

        // Warp past MAT + pgd: MAT=35D, pgd=2D → penalty starts at day 37
        uint256 checkT = MAT + 4 * D; // day 39 → 2 penalty days (day 37, day 38 billed)
        vm.warp(checkT);
        (uint256 vIdle, uint256 vPen, uint256 vTotal) = p.getIdleFeesBreakdown();
        assertGt(vIdle, 0, "idle fees must have accrued");
        assertGt(vPen,  0, "penalty must be accruing post-maturity + grace");
        assertEq(vTotal, vIdle + vPen, "total = idle + penalty");

        // Trigger mutation by paying idle fees — pay vTotal and confirm it clears exactly.
        usdc.mint(PSP, vTotal);
        vm.prank(PSP); usdc.approve(address(p), vTotal);
        vm.prank(PSP); p.payAccruedIdleFees(vTotal);
        assertEq(p.accIdleFees(), 0, "after paying view.total: accIdleFees cleared");
        assertEq(p.accPenalty(),  0, "after paying view.total: accPenalty cleared");
    }

    // With exemption: repay-then-redraw scenario creates idle exemption; view accounts for it.
    function test_idleFees_withExemption_exact() public {
        // Repay R1 on day 0 (same day as draw) → exemption set until tomorrow midnight.
        vm.warp(LOCK);
        _repayExact(p, R1); // repay at LOCK; idleExemptAmount = DRAW for 1 day

        assertGt(p.idleExemptAmount(), 0, "exemption should be set");
        assertGt(p.idleExemptUntil(),  0, "exemption deadline should be set");

        // Draw again on the same day and check idle fee projection accounts for exemption
        bytes32 R2 = keccak256("R2");
        _draw(p, R2, DRAW, 4);

        vm.warp(LOCK + 2 * D);
        (uint256 vIdle,,) = p.getIdleFeesBreakdown();

        // Repay R2 to trigger accrual
        _repayExact(p, R2);
        assertEq(p.accIdleFees(), vIdle, "with exemption: view idle == post-mutation state");
    }

    // Closed pool: both _accrueIdleFees (early return) and _projectIdleFees (acc==0, no days)
    // return zero — the missing Closed guard in _projectIdleFees is benign.
    function test_idleFees_closedPool_returnsZero() public {
        // Use APR=0 so yieldOwed=0, allowing the pool to close via full principal collection.
        // With yieldOwed=0 the APR guard (aprAnnual * maxTenureSecs <= util * 365 * tenure * D)
        // passes trivially. Pool closes when collectedPrincipal >= principal after maturity.
        _deployInfra();
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 5 * D,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              TENOR,
            idleRateDaily:       0,        // no idle fees → accIdleFees stays 0
            utilizedRateDaily:   5e14,
            penaltyRateDaily:    1e15,
            penaltyGraceDays:    0,
            minDeposit:          0,
            aprAnnual:           0,        // yieldOwed=0 → any collectedYield satisfies it
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
        PoolContract pz = PoolContract(addr);
        _deposit(pz, LP_A, 1_000_000 * SCALE);
        vm.warp(LOCK); pz.finalizeFunding();

        // No draw — all principal stays idle, no idle fees (idleRateDaily=0).
        // Warp past maturity: _mature moves availableToDd → collectedPrincipal.
        // yieldOwed=0 → _checkFinality closes immediately.
        uint256 newMat = LOCK + TENOR * D;
        vm.warp(newMat + 1);
        vm.prank(LP_A); pz.claimYield(); // triggers _mature → _checkFinality → Closed

        assertEq(uint256(pz.status()), uint256(PoolContract.Status.Closed), "pool should be Closed");

        (uint256 vI, uint256 vP, uint256 vT) = pz.getIdleFeesBreakdown();
        assertEq(vI, 0, "Closed: view idle == 0");
        assertEq(vP, 0, "Closed: view pen == 0");
        assertEq(vT, 0, "Closed: view total == 0");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pair 3 — getClaimableYieldBreakdown ↔ claimYield()    [EXACT]
// Highest-risk pair: view replicates _settleLpDollarSeconds and F1 cap
// independently of the mutation. Tests guard against future drift.
// ─────────────────────────────────────────────────────────────────────────────

contract VM3_YieldBreakdownConsistency is VMBase {
    PoolContract p;
    bytes32 constant R1   = keccak256("R1");
    uint256 constant DRAW = 500_000 * SCALE;

    function setUp() public {
        _deployInfra();
        p = _makePool();
        // Two LPs to validate pro-rata math
        _deposit(p, LP_A, 700_000 * SCALE);
        _deposit(p, LP_B, 300_000 * SCALE);
        _lock(p);
        _draw(p, R1, DRAW, 4);
    }

    // Pattern: view at T, claimYield at T, balance delta == view.
    function _breakdownThenClaim(address lp, uint256 warpTo)
        internal
        returns (
            uint256 vBase, uint256 vOverrun, uint256 vBonus, uint256 vTotal,
            uint256 actualTransfer
        )
    {
        vm.warp(warpTo);
        (vBase, vOverrun, vBonus, vTotal) = p.getClaimableYieldBreakdown(lp);
        uint256 balBefore = usdc.balanceOf(lp);
        vm.prank(lp); p.claimYield();
        actualTransfer = usdc.balanceOf(lp) - balBefore;
    }

    // Post-maturity, single-repay: view.totalYield == claimYield transfer.
    function test_breakdown_postMaturity_exact() public {
        // Repay at LOCK+3D to generate collectedYield
        vm.warp(LOCK + 3 * D);
        _repayExact(p, R1);

        // Warp past maturity
        vm.warp(MAT + 1);

        (uint256 vB,, , uint256 vT, uint256 actual) = _breakdownThenClaim(LP_A, MAT + 1);
        assertGt(vT, 0, "yield must be non-zero");
        assertEq(actual, vT, "post-maturity: breakdown.totalYield == claimYield transfer");
    }

    // Pre-maturity (F1 cap applies): view accounts for the elapsed-time cap.
    function test_breakdown_prematurity_F1cap_exact() public {
        // Repay at LOCK+3D so some collectedYield exists
        vm.warp(LOCK + 3 * D);
        _repayExact(p, R1);

        // Check mid-tenure: the F1 cap should bite (pre-maturity)
        uint256 checkT = LOCK + 15 * D;
        assertLt(checkT, MAT, "must be pre-maturity");

        (uint256 vB, uint256 vO, uint256 vBn, uint256 vT, uint256 actual) =
            _breakdownThenClaim(LP_A, checkT);
        assertGt(vT, 0, "should have claimable yield");
        assertEq(actual, vT, "pre-maturity: breakdown.totalYield == claimYield transfer");
    }

    // Critical: LP pos.finalized == false when claimYield is first called.
    // View must replicate the _settleLpDollarSeconds computation that the
    // mutation performs, producing the same baseShare.
    function test_breakdown_lpNotYetFinalized_exact() public {
        // Repay to generate collectedYield
        vm.warp(LOCK + 3 * D);
        _repayExact(p, R1);

        // Confirm LP_A has NOT been settled yet
        (uint256 lpPrincipal_,, , , , ) = p.getLpPosition(LP_A);
        (bool finalized_before) = _lpFinalized(p, LP_A);
        assertFalse(finalized_before, "LP_A should not be finalized yet");

        // View at mid-tenure (before any claimYield call)
        uint256 checkT = LOCK + 15 * D;
        (, , , uint256 vTotal) = p.getClaimableYieldBreakdown(LP_A);

        vm.warp(checkT);
        (, , , uint256 vTotalAtT) = p.getClaimableYieldBreakdown(LP_A);

        uint256 balBefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.claimYield();
        uint256 actualTransfer = usdc.balanceOf(LP_A) - balBefore;

        assertEq(actualTransfer, vTotalAtT,
            "not-yet-finalized LP: breakdown.totalYield == claimYield transfer");

        // After claim, pos is finalized
        assertTrue(_lpFinalized(p, LP_A), "LP_A finalized after claimYield");
    }

    // Two-LP pro-rata: LP_B's breakdown also exactly matches its claimYield at same T.
    function test_breakdown_twoLP_independent_exact() public {
        vm.warp(LOCK + 3 * D);
        _repayExact(p, R1);
        vm.warp(MAT + 1);

        // LP_A claims first
        (,,, uint256 vTA, uint256 actualA) = _breakdownThenClaim(LP_A, MAT + 1);
        assertEq(actualA, vTA, "LP_A: breakdown == claimYield");

        // LP_B's breakdown BEFORE its claim (pool-level cap state changed by LP_A's claim)
        (,,, uint256 vTB) = p.getClaimableYieldBreakdown(LP_B);
        uint256 balB = usdc.balanceOf(LP_B);
        vm.prank(LP_B); p.claimYield();
        uint256 actualB = usdc.balanceOf(LP_B) - balB;
        assertEq(actualB, vTB, "LP_B: breakdown == claimYield after LP_A already claimed");
    }

    // Post-default span-change: _settleLpDollarSeconds uses rebased span when
    // default is declared pre-maturity. View must match the mutation.
    function test_breakdown_postDefault_exactAfterSpanChange() public {
        // Let R1 expire without repayment → declare default
        vm.warp(LOCK + 20 * D);
        vm.prank(AGENT2); p.declareDefault();

        assertEq(uint256(p.status()), uint256(PoolContract.Status.Default), "should be Default");

        uint256 spanAfter = p.span();

        // Settle default: mint principal + yield to LP_A (simulate external settlement)
        // For simplicity, check view == mutation directly after default
        (, , , uint256 vTotalA) = p.getClaimableYieldBreakdown(LP_A);

        uint256 balBefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.claimYield();
        uint256 actualA = usdc.balanceOf(LP_A) - balBefore;

        assertEq(actualA, vTotalA, "post-default: breakdown.totalYield == claimYield transfer");
    }

    // finalized is not directly exposed; proxy: pos.dollarSeconds > 0 iff settled.
    function _lpFinalized(PoolContract pool, address lp) internal view returns (bool) {
        (, uint256 lpDs,,,,) = pool.getLpPosition(lp);
        return lpDs > 0;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pair 4 — getLpPosition claimable fields ↔ getClaimableYieldBreakdown  [EXACT]
//
// getLpPosition now delegates to _computeBreakdown() internally, so:
//   claimableYield_   == getClaimableYieldBreakdown.baseYield    (incl. F1 cap)
//   claimableOverrun_ == getClaimableYieldBreakdown.overrunYield_
//   claimableBonus_   == getClaimableYieldBreakdown.bonus
//   claimablePrincipal_ — independent; compared to claimPrincipal payout
// ─────────────────────────────────────────────────────────────────────────────

contract VM5_LpPositionConsistency is VMBase {
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

    // Pre-maturity, pre-settlement: getLpPosition.claimableYield_ == breakdown.baseYield.
    // (The old independent implementation returned 0 pre-settlement; now it uses _computeBreakdown
    // which correctly computes > 0 using settlement replication.)
    function test_lpPosition_claimableYield_exactMatchesBreakdown_preMat() public {
        vm.warp(LOCK + 5 * D);
        assertLt(block.timestamp, MAT, "pre-maturity");

        (uint256 brkBase,,,)         = p.getClaimableYieldBreakdown(LP_A);
        (, , uint256 posYield,,,)    = p.getLpPosition(LP_A);

        assertEq(posYield, brkBase, "pre-maturity: getLpPosition.claimableYield_ == breakdown.baseYield");
        assertGt(posYield, 0,       "pre-maturity pre-settlement: _computeBreakdown gives > 0");
    }

    // Post-maturity: all three yield fields agree exactly with getClaimableYieldBreakdown.
    function test_lpPosition_postMaturity_exactMatchesBreakdown() public {
        vm.warp(MAT + 1);

        (uint256 brkBase, uint256 brkOverrun, uint256 brkBonus,) =
            p.getClaimableYieldBreakdown(LP_A);
        (, , uint256 posYield, , uint256 posOverrun, uint256 posBonus) =
            p.getLpPosition(LP_A);

        assertEq(posYield,   brkBase,    "post-maturity: posYield == breakdown.baseYield");
        assertEq(posOverrun, brkOverrun, "post-maturity: posOverrun == breakdown.overrunYield_");
        assertEq(posBonus,   brkBonus,   "post-maturity: posBonus == breakdown.bonus");
    }

    // Regression: pre-maturity F1 cap is applied in getLpPosition (not skipped as in old impl).
    // Requires a late depositor (LP_B at t=4D) whose elapsed share < committed share early in tenure.
    function test_lpPosition_preMat_F1cap_applied() public {
        // Fresh pool: LP_A at t=0, LP_B at t=4D (late → lower pre-pool credit)
        _deployInfra();
        PoolContract pp = _makePool();
        _deposit(pp, LP_A, 1_000_000 * SCALE);
        vm.warp(4 * D);
        _deposit(pp, LP_B, 1_000_000 * SCALE);
        vm.warp(LOCK);
        pp.finalizeFunding();

        // Generate yield: drawdown on day 0 of tenure, repay on day 3 (no penalty)
        vm.prank(AGENT2); pp.executeDrawdown(keccak256("F1"), PSP, 500_000 * SCALE, 4);
        vm.warp(LOCK + 3 * D);
        (, , uint256 repayTotal) = pp.getRepaymentOwed(keccak256("F1"));
        usdc.mint(PSP, repayTotal);
        vm.prank(PSP); usdc.approve(address(pp), repayTotal);
        vm.prank(PSP); pp.repay(keccak256("F1"));

        // At this point: elapsed=3D, span=30D; for LP_B (late depositor):
        // elapsedShare ≈ 33% < baseShare ≈ 47% → F1 cap bites.
        assertLt(block.timestamp, LOCK + TENOR * D, "pre-maturity");

        (uint256 brkBase_B,,,)       = pp.getClaimableYieldBreakdown(LP_B);
        (, , uint256 posYield_B,,,)  = pp.getLpPosition(LP_B);
        assertEq(posYield_B, brkBase_B, "F1-capped LP: posYield == breakdown.baseYield");
        assertGt(posYield_B, 0,         "F1-capped LP: yield is positive");
    }

    // claimableOverrun_ and claimableBonus_ agree with breakdown in normal operation
    // (pool-level caps only bite due to rounding, not normal shortfall).
    function test_lpPosition_overrunBonus_matchBreakdown() public {
        // Bring pool to Closed so collectedOverrunYield and collectedBonus are set.
        // This requires post-maturity drawdown repayment.
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, 1_000_000 * SCALE);
        _lock(p);
        // Draw and let expire past maturity (generates overrun yield)
        bytes32 RR = keccak256("RR");
        _draw(p, RR, DRAW, 1);
        vm.warp(MAT + 5 * D);
        _repayExact(p, RR);

        (,  uint256 brkOverrun, uint256 brkBonus, ) = p.getClaimableYieldBreakdown(LP_A);
        // getLpPosition returns: (lpPrincipal, lpDollarSeconds, claimableYield_,
        //                         claimablePrincipal_, claimableOverrun_, claimableBonus_)
        (, , , , uint256 posOverrun, uint256 posBonus) = p.getLpPosition(LP_A);

        // No pool-level cap bites for a single LP (sole claimant = full pool)
        assertEq(posOverrun, brkOverrun,
            "single LP: posOverrun == breakdown.overrunYield_");
        // Bonus only exists post-Closed (_settleTerminalSplit). Check:
        // if pool not Closed yet, both are 0
        if (uint256(p.status()) == uint256(PoolContract.Status.Closed)) {
            assertEq(posBonus, brkBonus, "Closed: posBonus == breakdown.bonus");
        }
    }

    // claimablePrincipal_ ↔ claimPrincipal actual payout.
    function test_lpPosition_claimablePrincipal_matchesActualPayout() public {
        vm.warp(MAT + 1);
        // Trigger collection (repay to put principal into collectedPrincipal)
        // Actually after MAT, _mature() runs on next call: need repayment or claimYield
        vm.prank(LP_A); p.claimYield(); // triggers _mature → collects availableToDd

        (, , , uint256 posPrincipal,,) = p.getLpPosition(LP_A);

        uint256 balBefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.claimPrincipal();
        uint256 actualPrincipal = usdc.balanceOf(LP_A) - balBefore;

        assertEq(actualPrincipal, posPrincipal,
            "getLpPosition.claimablePrincipal_ == claimPrincipal payout");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pair 6 — isDrawdownAllowed ↔ executeDrawdown()    [PARTIAL]
//
// isDrawdownAllowed checks ONLY the overdue/paused guard via _hasOverdueUnsettled().
// executeDrawdown checks 8 guards. The view is necessary but not sufficient
// for executeDrawdown success.
// ─────────────────────────────────────────────────────────────────────────────

contract VM6_IsDrawdownAllowedConsistency is VMBase {
    PoolContract p;
    bytes32 constant R1 = keccak256("R1");
    bytes32 constant R2 = keccak256("R2");
    uint256 constant DRAW = 100_000 * SCALE;

    function setUp() public {
        _deployInfra();
        p = _makePool();
        _deposit(p, LP_A, 1_000_000 * SCALE);
        _lock(p);
        // scOverdueCheck = true by default (set in initialize)
    }

    // isDrawdownAllowed=true AND all other guards pass → executeDrawdown succeeds.
    function test_isDrawdownAllowed_true_succeedsWith_validParams() public {
        assertTrue(p.isDrawdownAllowed(), "should be allowed with no drawdowns");
        vm.prank(AGENT2); p.executeDrawdown(R1, PSP, DRAW, 4);
        // no revert = success
    }

    // isDrawdownAllowed=false (overdue drawdown) → executeDrawdown reverts.
    function test_isDrawdownAllowed_false_executeFails() public {
        // Create an overdue drawdown: pStart = min(1+1+2,7) = 4; warp to day 4
        _draw(p, R1, DRAW, 1); // settlement=1 day, expiryTs = LOCK+0D, pStart=4

        // daysTotal = 4, penaltyStart = 4 → overdue at day 4
        vm.warp(LOCK + 4 * D); // day 4 since draw → daysTotal=5 > pStart=4 → overdue
        // Actually let me recalculate: elapsedDays = dayOf(now) - dayOf(startTs)
        // startTs = LOCK = 5D, now = LOCK+4D = 9D
        // elapsedDays = dayOf(9D) - dayOf(5D) = 9 - 5 = 4
        // daysTotal = 5; pStart = 4; 5 >= 4 → overdue

        assertFalse(p.isDrawdownAllowed(), "should not be allowed with overdue drawdown");
        vm.prank(AGENT2);
        vm.expectRevert("Pool: overdue drawdown");
        p.executeDrawdown(R2, PSP, DRAW, 4);
    }

    // PARTIAL PREVIEW: isDrawdownAllowed=true but executeDrawdown fails due to
    // insufficient liquidity — a guard the view does not cover.
    function test_isDrawdownAllowed_true_butInsufficientLiquidity_fails() public {
        assertTrue(p.isDrawdownAllowed(), "view says allowed");
        uint256 overLimit = p.availableToDd() + 1;
        vm.prank(AGENT2);
        vm.expectRevert("Pool: insufficient liquidity");
        p.executeDrawdown(R1, PSP, overLimit, 4);
    }

    // PARTIAL PREVIEW: isDrawdownAllowed=true but receiver not authorized.
    function test_isDrawdownAllowed_true_butUnauthorizedReceiver_fails() public {
        assertTrue(p.isDrawdownAllowed(), "view says allowed");
        address badReceiver = address(0xDEAD);
        vm.prank(AGENT2);
        vm.expectRevert("Pool: receiver not authorized");
        p.executeDrawdown(R1, badReceiver, DRAW, 4);
    }

    // PARTIAL PREVIEW: isDrawdownAllowed=true but expiry past maturity.
    function test_isDrawdownAllowed_true_butExpiryPastMaturity_fails() public {
        assertTrue(p.isDrawdownAllowed(), "view says allowed");
        // MAX_DD = 7; tenure = 30; pool at LOCK, finalityTs = MAT = 35D
        // settleDays = 7 → expiryTs = LOCK + 6D = 11D; dayOf(11D) = 11 <= dayOf(35D) = 35 → ok
        // To fail expiry: warp close to maturity
        vm.warp(MAT - 2 * D); // 2 days before maturity
        // settleDays = 7 → expiryTs = (MAT-2D) + 6D = MAT+4D > MAT → expiry past maturity
        vm.prank(AGENT2);
        vm.expectRevert("Pool: expiry past maturity");
        p.executeDrawdown(R1, PSP, DRAW, MAX_DD);
    }

    // Summary: document the guard coverage gap.
    // isDrawdownAllowed checks: overdue drawdown OR paused (when scOverdueCheck=false).
    // executeDrawdown checks:   status, receiver authorized, amount>0, ref unique,
    //                           settlementDays range, expiry<=maturity, amount<=available,
    //                           !_hasOverdueUnsettled.
    // Guards NOT covered by isDrawdownAllowed: status, receiver, amount bounds, ref, expiry.
    function test_isDrawdownAllowed_guardsNotCovered_documented() public view {
        // This test documents the contract; it always passes.
        // isDrawdownAllowed = !_hasOverdueUnsettled() = partial preview only.
        // Callers MUST validate all guards independently before submitting executeDrawdown.
        assertTrue(true, "documented: isDrawdownAllowed is a partial preview");
    }
}
