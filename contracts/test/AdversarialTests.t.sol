// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Adversarial "try to break it" tests.
///
/// Focuses on paths not covered by SecurityTests.t.sol or PoolInvariants.t.sol:
///   A1 Post-maturity repay close-out (pool stays open until idle fees paid)
///   A2 overrunYield == collectedOverrunYield at close
///   A3 Second draw blocked when first is overdue (scOverdueCheck=true)
///   A4 Duplicate ref rejected until drawdown settled; ref reusable after repay
///   A5 Pre-maturity default rebases yieldOwed to actual elapsed
///   A6 executeDrawdown for amount > availableToDd reverts
///   A7 Funding below softCap → Unsuccessful; deposits withdrawable
///   A8 settleDefaultYield reverts until principal fully settled
contract AdversarialTest is Test {
    uint256 constant SCALE = 1e12;
    uint256 constant D     = 86400;
    uint256 constant YEAR  = 365 * D;

    // Pool parameters
    uint256 constant APR       = 1e17;   // 10 % annual
    uint256 constant IDLE_RATE = 5e14;
    uint256 constant UTIL_RATE = 5e14;
    uint256 constant PEN_RATE  = 1e15;
    uint256 constant PGD       = 2;      // penaltyGraceDays
    uint256 constant TENURE    = 30;
    uint256 constant RESERVE_RATE   = 1e17;
    uint256 constant RESERVE_TARGET = 1_000_000 * SCALE;
    uint256 constant HURDLE_FRAC    = 1e18;
    uint256 constant LP_BONUS       = 0;

    uint256 constant LOCK_TS  = 5 * D;  // fundingDays * D
    uint256 constant MATURITY = LOCK_TS + TENURE * D;

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant LP_A     = address(0xAAAA);
    address constant LP_B     = address(0xBBBB);

    MockStablecoin usdc;
    TreasuryReserve treasury;
    PoolFactory    factory;
    PoolContract   impl;

    function setUp() public {
        vm.warp(0);
        usdc     = new MockStablecoin();
        impl     = new PoolContract();

        treasury = new TreasuryReserve(
            address(usdc), MULTISIG,
            RESERVE_RATE, RESERVE_TARGET, HURDLE_FRAC, LP_BONUS
        );

        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * 86400, 25e16, 3, 1, 7  // fundingDurationSecs, bufferWAD, maxGrace, minDd, maxDd
        );

        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _newPool() internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           9_000_000 * SCALE,
            tenure:            TENURE,
            idleRateDaily:     IDLE_RATE,
            utilizedRateDaily: UTIL_RATE,
            penaltyRateDaily:  PEN_RATE,
            penaltyGraceDays:  PGD,
            minDeposit:        0,
            aprAnnual:         APR,
            agent1:            AGENT1,
            agent2:            AGENT2,
            multisig:          MULTISIG
        }));
        p = PoolContract(addr);
    }

    function _deposit(PoolContract p, address lp, uint256 rawAmt) internal {
        uint256 amt = rawAmt * SCALE;
        usdc.mint(lp, amt);
        vm.prank(lp); usdc.approve(address(p), amt);
        vm.prank(lp); p.deposit(amt);
    }

    function _lock(PoolContract p) internal {
        vm.warp(LOCK_TS);
        p.finalizeFunding();
    }

    function _draw(PoolContract p, bytes32 ref, uint256 rawAmt, uint256 settle) internal {
        uint256 amt = rawAmt * SCALE;
        vm.prank(AGENT2);
        p.executeDrawdown(ref, PSP, amt, settle);
    }

    function _repay(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.prank(PSP); usdc.approve(address(p), total);
        vm.prank(PSP); p.repay(ref);
    }

    function _payIdle(PoolContract p) internal {
        (, , uint256 total) = p.getIdleFeesBreakdown();
        if (total == 0) return;
        usdc.mint(PSP, total);
        vm.prank(PSP); usdc.approve(address(p), total);
        vm.prank(PSP); p.payAccruedIdleFees(total);
    }

    // I1 conservation identity: pool USDC == sum of all tracked buckets.
    // Holds at every externally-observable state boundary.
    function _assertI1(PoolContract p, string memory label) internal view {
        uint256 poolBal  = usdc.balanceOf(address(p));
        uint256 expected =
            (p.principal() - p.outstanding() - p.claimedPrincipal())
            + (p.collectedYield()        - p.claimedYield())
            + p.reservedYield()
            + (p.collectedOverrunYield() - p.claimedOverrunYield())
            + (p.collectedBonus()        - p.claimedBonus())
            + p.protocolFees();
        assertEq(poolBal, expected, label);
    }

    // ── A1: Post-maturity repay leaves pool Active; idle fees close it ────────

    function testA1_postMaturityRepay_closesOnlyAfterIdleFeesPaid() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 500_000);
        _lock(p);

        // Draw on day 10
        vm.warp(LOCK_TS + 10 * D);
        _draw(p, keccak256("d1"), 100_000, 1);

        // Repay at maturity + 1D (post-maturity, overrun_days=1)
        vm.warp(MATURITY + 1 * D);
        _repay(p, keccak256("d1"));

        // Pool must still be Active: outstanding=0 and collectedPrincipal=principal,
        // but accIdleFees > 0 so _checkFinality blocked it.
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Active),
            "pool must stay Active while accIdleFees > 0");
        assertEq(p.outstanding(), 0, "outstanding must be zero after repay");
        assertGt(p.accIdleFees(), 0, "accIdleFees must be positive");

        // Paying idle fees triggers _mature → _checkFinality → Closed
        vm.warp(MATURITY + 2 * D);
        _payIdle(p);

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "pool must be Closed after idle fees paid");
        assertEq(p.accIdleFees(), 0, "accIdleFees must be zero after pay");
        assertEq(p.accPenalty(), 0, "accPenalty must be zero after pay");
    }

    // ── A2: overrunYield == collectedOverrunYield at post-maturity close ──────

    function testA2_overrunYield_matchesCollected_atClose() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 200_000);
        _lock(p);

        // Draw on day 6, repay 2 days post-maturity
        vm.warp(LOCK_TS + 6 * D);
        _draw(p, keccak256("d1"), 80_000, 1);

        vm.warp(MATURITY + 2 * D);
        _repay(p, keccak256("d1"));

        vm.warp(MATURITY + 3 * D);
        _payIdle(p);

        // After close, overrunYield must equal collectedOverrunYield
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "pool must be Closed");
        assertEq(p.overrunYield(), p.collectedOverrunYield(),
            "overrunYield must equal collectedOverrunYield at close");
        assertGt(p.overrunYield(), 0, "overrunYield must be positive (draw was post-maturity)");
    }

    // ── A3: Second draw blocked when first is overdue (scOverdueCheck=true) ───

    function testA3_drawBlocked_whileOverdue() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 600_000);
        _lock(p);

        // Draw with settle=1 (minDdDays=1); penaltyStartDay(1)=min(4,7)=4 days.
        vm.warp(LOCK_TS + 1 * D);
        _draw(p, keccak256("d1"), 50_000, 1);

        // Advance 4 days past start → draw is overdue per _hasOverdueUnsettled
        // dayOf(startDay)=lockDay+1, overdue when nowDay - startDay >= 4 → nowDay >= lockDay+5
        uint256 overdueTs = LOCK_TS + 5 * D;
        vm.warp(overdueTs);

        // executeDrawdown must revert while the overdue draw is outstanding
        vm.prank(AGENT2);
        vm.expectRevert("Pool: overdue drawdown");
        p.executeDrawdown(keccak256("d2"), PSP, 50_000 * SCALE, 1);

        // Repay the overdue draw; draw slot clears
        _repay(p, keccak256("d1"));

        // Now executeDrawdown succeeds (no overdue outstanding)
        vm.warp(overdueTs + 1 * D);
        _draw(p, keccak256("d2"), 50_000, 1);
        // Succeeded if no revert
    }

    // ── A4: Duplicate ref rejected until drawdown settled; reusable after repay ─
    //
    // Once a drawdown is recorded for a ref, a second draw to the same ref is
    // rejected with "Pool: ref exists". After the drawdown is repaid, the ref is
    // cleared from drawDowns and can be reused.

    function testA4_duplicateRef_reverts_clearedAfterRepay() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 300_000);
        _lock(p);

        bytes32 ref = keccak256("reuse");
        vm.warp(LOCK_TS + 1 * D);
        _draw(p, ref, 50_000, 1);

        uint256 avBefore  = p.availableToDd();
        uint256 outBefore = p.outstanding();

        // Second draw with same ref must revert "Pool: ref exists"
        vm.prank(AGENT2);
        vm.expectRevert("Pool: ref exists");
        p.executeDrawdown(ref, PSP, 10_000 * SCALE, 1);

        // Economic state unchanged
        assertEq(p.outstanding(),   outBefore, "outstanding must be unchanged");
        assertEq(p.availableToDd(), avBefore,  "availableToDd must be unchanged");

        // After repayment, ref is cleared — same ref can be reused
        _repay(p, ref);
        vm.warp(LOCK_TS + 3 * D);
        _draw(p, ref, 20_000, 1); // must succeed
    }

    // ── A5: Pre-maturity default rebases yieldOwed to actual elapsed time ────

    function testA5_earlyDefault_rebases_yieldOwed() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 1_000_000);
        _lock(p);

        // Declare default halfway through tenure (no draws)
        uint256 halfTenure = LOCK_TS + (TENURE / 2) * D;  // day 20
        vm.warp(halfTenure);
        vm.prank(AGENT2);
        p.declareDefault();

        // yieldOwed must equal the shorter-tenure LP coupon
        // dollarSeconds_half = fundingCredit + principal * halfElapsed
        //   fundingCredit = principal * LOCK_TS (both LPs at t=0... 1 LP at t=0)
        // yieldOwed_half = mulDiv(ds_half, APR, WAD * YEAR)
        // Just check it's strictly less than the full-tenure yield
        uint256 fullYield = MathLib.mulDiv(
            1_000_000 * SCALE * (LOCK_TS + uint256(TENURE) * D),
            APR,
            1e18 * YEAR
        );
        assertLt(p.yieldOwed(), fullYield,
            "yieldOwed after early default must be less than full-tenure yield");
        assertGt(p.yieldOwed(), 0, "yieldOwed must be positive");

        // All principal collected (undrawn funds moved to collectedPrincipal)
        assertEq(p.collectedPrincipal(), p.principal(),
            "all principal must be collected on default with no draws");
        assertEq(p.availableToDd(), 0, "availableToDd must be zeroed on default");
    }

    // ── A6: Draw for more than availableToDd reverts ─────────────────────────

    function testA6_draw_exceedsAvailable_reverts() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);

        vm.warp(LOCK_TS + 1 * D);

        // Attempt to draw more than deposited
        vm.prank(AGENT2);
        vm.expectRevert("Pool: insufficient liquidity");
        p.executeDrawdown(keccak256("big"), PSP, 200_000 * SCALE, 1);
    }

    // ── A7: Unsuccessful pool — LP withdraws after finalization (regression) ────
    //
    // BUG (fixed): withdraw() after pool becomes Unsuccessful panicked with an
    // arithmetic underflow in `fundingCredit -= forfeited`.
    // Root cause: _finalizeFunding() set status=Unsuccessful before
    // _globalCheckpoint() ran; once status changed, _globalCheckpoint() became
    // a no-op, but _lpCheckpoint() still accrued pos.fundingCredit, making
    // global fundingCredit lag and underflow on subtraction.
    // Fix: call _globalCheckpoint() at the top of _finalizeFunding() while
    // status is still Funding; the _lock() path is idempotent (second call
    // computes delta=0 in the same block).
    // Verdict (A/B/C): (C) — pseudocode has the same logic but Python integers
    // go silently negative; nothing downstream reads fundingCredit after
    // Unsuccessful, so the model never exhibited a symptom.

    function testA7_unsuccessfulPool_withdrawAfterFinalization() public {
        // Deploy pool with softCap that won't be met.
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1_000_000 * SCALE,
            hardCap:           9_000_000 * SCALE,
            tenure:            TENURE,
            idleRateDaily:     IDLE_RATE,
            utilizedRateDaily: UTIL_RATE,
            penaltyRateDaily:  PEN_RATE,
            penaltyGraceDays:  PGD,
            minDeposit:        0,
            aprAnnual:         APR,
            agent1:            AGENT1,
            agent2:            AGENT2,
            multisig:          MULTISIG
        }));
        PoolContract p = PoolContract(addr);

        uint256 depA = 100 * SCALE;
        uint256 depB = 200 * SCALE;
        usdc.mint(LP_A, depA);
        usdc.mint(LP_B, depB);
        vm.prank(LP_A); usdc.approve(address(p), depA); vm.prank(LP_A); p.deposit(depA);
        vm.prank(LP_B); usdc.approve(address(p), depB); vm.prank(LP_B); p.deposit(depB);

        // Advance to fMaturityTs (funding expires, softCap not met)
        vm.warp(LOCK_TS);

        // Variant 1: LP_A calls withdraw — which internally triggers finalizeFunding
        // then attempts withdrawal. Before the fix this panicked with underflow.
        uint256 balA_before = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.withdraw(depA);
        assertEq(usdc.balanceOf(LP_A) - balA_before, depA,
            "LP_A must recover full deposit after Unsuccessful finalization");

        // Pool must be Unsuccessful now
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Unsuccessful),
            "pool must be Unsuccessful");

        // Variant 2: partial withdrawal from LP_B
        uint256 half = depB / 2;
        uint256 balB_before = usdc.balanceOf(LP_B);
        vm.prank(LP_B); p.withdraw(half);
        assertEq(usdc.balanceOf(LP_B) - balB_before, half,
            "LP_B partial withdrawal must succeed");
        vm.prank(LP_B); p.withdraw(depB - half);
        assertEq(usdc.balanceOf(LP_B) - balB_before, depB,
            "LP_B second withdrawal must recover remainder");

        // Accounting invariants hold
        assertEq(p.principal(), 0, "principal must be zero after all withdrawals");
        assertEq(p.fundingCredit(), 0, "global fundingCredit must be zero (not underflowed)");
    }

    // ── A8: settleDefaultYield reverts until principal fully settled ──────────

    function testA8_settleDefaultYield_gatedByPrincipal() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 300_000);
        _lock(p);

        // Draw and let default be declared
        vm.warp(LOCK_TS + 5 * D);
        _draw(p, keccak256("d1"), 200_000, 1);

        vm.warp(MATURITY + 1 * D);
        vm.prank(AGENT2);
        p.declareDefault();

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default),
            "pool must be in Default");

        // settleDefaultYield requires collectedPrincipal >= principal.
        // The draw is still outstanding, so that condition is false.
        uint256 yieldShort   = p.yieldOwed() > p.collectedYield()
            ? p.yieldOwed() - p.collectedYield() : 0;
        uint256 overrunShort = p.overrunYield() > p.collectedOverrunYield()
            ? p.overrunYield() - p.collectedOverrunYield() : 0;
        uint256 yieldAmt = yieldShort + overrunShort;
        if (yieldAmt > 0) {
            usdc.mint(MULTISIG, yieldAmt);
            vm.prank(MULTISIG); usdc.approve(address(p), yieldAmt);
            vm.prank(MULTISIG);
            vm.expectRevert("Pool: settle principal first");
            p.settleDefaultYield(yieldAmt);
        }

        // Settle principal shortfall (outstanding draw, no reserve funds)
        uint256 principalShort = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        if (principalShort > 0) {
            usdc.mint(MULTISIG, principalShort);
            vm.prank(MULTISIG); usdc.approve(address(p), principalShort);
            vm.prank(MULTISIG); p.settleDefaultPrincipal(principalShort);
        }

        // Now yield can be settled
        uint256 yShort2   = p.yieldOwed() > p.collectedYield()
            ? p.yieldOwed() - p.collectedYield() : 0;
        uint256 ovShort2  = p.overrunYield() > p.collectedOverrunYield()
            ? p.overrunYield() - p.collectedOverrunYield() : 0;
        uint256 totalYield = yShort2 + ovShort2;
        if (totalYield > 0) {
            usdc.mint(MULTISIG, totalYield);
            vm.prank(MULTISIG); usdc.approve(address(p), totalYield);
            vm.prank(MULTISIG); p.settleDefaultYield(totalYield);
        }

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "pool must be Closed after full settlement");
    }

    // ── Fix1a: declareDefault immediate-close — no terminal split ─────────────
    //
    // Verifies (A-1) fix: the declareDefault immediate-close branch (when the
    // internal waterfall covers all obligations) must NOT call _settleTerminalSplit.
    // Reserve must be untouched, collectedBonus must stay 0, protocolFees holds
    // the residue (and remains sweepable via sweepProtocolFees).
    //
    // Scenario: draw the full pool pre-lock, repay 25 days later with heavy
    // penalty (finance charge >> yieldOwed).  The repay fills collectedYield to
    // yieldOwed and parks the surplus in reservedYield.  At maturity,
    // declareDefault: availableToDd covers all principal, waterfall has no yield
    // gap to fill, no outstanding → all conditions met → immediate Closed.

    function testFix1a_declareDefault_immediateClosed_noSplit() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 200_000);
        _lock(p);

        // Draw full pool at lock, settlement 7 days (large penalty window)
        _draw(p, keccak256("d1"), 200_000, 7);

        // Repay 25 days post-lock (pre-maturity, 19 penalty days)
        // finance charge = 200_000*SCALE * (7*utilRate + 19*penRate) / WAD >> yieldOwed
        vm.warp(LOCK_TS + 25 * D);
        _repay(p, keccak256("d1"));

        // After repay: collectedYield must equal yieldOwed; surplus in reservedYield
        assertEq(p.collectedYield(), p.yieldOwed(),
            "repay must exactly fill yieldOwed");
        assertGt(p.reservedYield(), 0,
            "excess finance charge must park in reservedYield");

        uint256 reserveBefore = treasury.reserveBalance();
        uint256 imBefore      = treasury.imFeesBalance();

        // Declare default at maturity — no outstanding draw, immediate close
        vm.warp(MATURITY);
        vm.prank(AGENT2);
        p.declareDefault();

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "declareDefault with no shortfall must close immediately");

        // No terminal split: reserve untouched, no LP bonus
        assertEq(treasury.reserveBalance(), reserveBefore,
            "reserve must be untouched on default-path close");
        assertEq(p.collectedBonus(), 0,
            "no LP bonus on default-path close");

        // Residue sits in protocolFees (not distributed)
        assertGt(p.protocolFees(), 0,
            "residual protocolFees must be preserved");

        // Cash-conservation identity: every unit is accounted for in tracked buckets.
        // Passing here proves removing _settleTerminalSplit stranded/duplicated no units.
        _assertI1(p, "I1: default-recovery immediate-close conserves all units");

        // Sweep still works on Closed pool
        uint256 pf = p.protocolFees();
        vm.prank(MULTISIG);
        p.sweepProtocolFees();
        assertEq(p.protocolFees(), 0, "sweep must clear protocolFees");
        assertEq(treasury.imFeesBalance(), imBefore + pf,
            "sweep must move residue to imFees");
    }

    // ── Fix1b: _resolveDefaultIfWhole (owed==0 path) — no terminal split ─────
    //
    // Exercises the _resolveDefaultIfWhole code path via settleDefaultPrincipal
    // called a second time when owed is already 0.  At that point yield is still
    // short so the pool stays in Default; the call must be a no-op (no close,
    // no split, no reserve change, no bonus).
    //
    // This confirms the already-correct Solidity code: _resolveDefaultIfWhole
    // has never called _settleTerminalSplit, and this test locks that in.

    function testFix1b_resolveDefaultIfWhole_noSplit() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);

        _draw(p, keccak256("d1"), 80_000, 1);

        // Warp to post-maturity and declare default (80k still outstanding)
        vm.warp(MATURITY + 1 * D);
        vm.prank(AGENT2);
        p.declareDefault();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default),
            "pool must be in Default after declareDefault with outstanding draw");
        _assertI1(p, "I1: conservation holds at Default entry");

        uint256 reserveBefore = treasury.reserveBalance();

        // Settle the principal shortfall exactly
        uint256 pShort = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        if (pShort > 0) {
            usdc.mint(MULTISIG, pShort);
            vm.prank(MULTISIG); usdc.approve(address(p), pShort);
            vm.prank(MULTISIG); p.settleDefaultPrincipal(pShort);
        }
        // Yield still short → pool must remain in Default
        if (p.collectedYield() < p.yieldOwed()) {
            assertEq(uint8(p.status()), uint8(PoolContract.Status.Default),
                "pool must stay Default while yield short");
        }

        // Second call with owed=0 → triggers _resolveDefaultIfWhole.
        // Yield still short → no close; must be a pure no-op.
        vm.prank(MULTISIG); p.settleDefaultPrincipal(0);

        assertEq(treasury.reserveBalance(), reserveBefore,
            "reserve must be unchanged when _resolveDefaultIfWhole cannot close");
        assertEq(p.collectedBonus(), 0,
            "no bonus from non-closing _resolveDefaultIfWhole");

        // Now settle yield (base + overrun) to close; confirm no split on direct-close path
        uint256 yShort  = p.yieldOwed() > p.collectedYield()
            ? p.yieldOwed() - p.collectedYield() : 0;
        uint256 ovShort = p.overrunYield() > p.collectedOverrunYield()
            ? p.overrunYield() - p.collectedOverrunYield() : 0;
        uint256 totalYield = yShort + ovShort;
        if (totalYield > 0) {
            usdc.mint(MULTISIG, totalYield);
            vm.prank(MULTISIG); usdc.approve(address(p), totalYield);
            vm.prank(MULTISIG); p.settleDefaultYield(totalYield);
        }
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "pool must close after yield settled");
        assertEq(p.collectedBonus(), 0,
            "no bonus on settleDefaultYield direct-close path");
        assertEq(treasury.reserveBalance(), reserveBefore,
            "reserve unchanged across entire default-settle sequence");
        _assertI1(p, "I1: settleDefaultYield close conserves all units");
    }

    // ── Fix1c: claimYield on default-recovery-closed pool — no bonus phantom ──
    //
    // Confirms that an LP can call claimYield after a default-recovery immediate-
    // close (collectedBonus == 0 on close).  bonusOwed must compute to exactly 0
    // — no revert, no phantom claim.  The I1 identity must hold after the claim.

    function testFix1c_claimYield_afterDefaultClose_noBonusPhantom() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 200_000);
        _lock(p);

        // Full draw, repay pre-maturity (same setup as Fix1a)
        _draw(p, keccak256("d1"), 200_000, 7);
        vm.warp(LOCK_TS + 25 * D);
        _repay(p, keccak256("d1"));

        // Immediate close via declareDefault
        vm.warp(MATURITY);
        vm.prank(AGENT2);
        p.declareDefault();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "must close immediately");
        assertEq(p.collectedBonus(), 0, "collectedBonus must be 0 on default-close path");

        // LP calls claimYield — must not revert; bonus portion must be exactly 0
        uint256 lpBefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A);
        p.claimYield();
        uint256 lpReceived = usdc.balanceOf(LP_A) - lpBefore;

        // LP_A is the sole depositor (100% share): must receive full collectedYield
        assertGt(lpReceived, 0,         "LP must receive non-zero base yield");
        assertEq(p.claimedBonus(), 0,   "pool claimedBonus must stay 0: no phantom bonus");
        // claimedYield (pool-level) == LP receipt because overrunYield == 0 on this path
        assertEq(p.claimedYield(), lpReceived, "claimedYield must equal LP receipt");

        // Conservation holds after the yield transfer out
        _assertI1(p, "I1: conservation holds after claimYield on default-recovery close");
    }
}
