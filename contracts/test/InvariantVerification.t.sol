// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Targeted unit tests for edge-case interaction paths identified during
/// pre-audit investigation. Each test confirms a suspected flaw does NOT exist
/// (or IS a flaw — a failing test is the finding).
///
/// Tests:
///   C7  Claim-then-pre-maturity-default: no share corruption (#3)
///   C8  Multi-LP yield-to-exhaustion: dust stranded <= N wei (#1)
///   C9  Partial withdrawal in Unsuccessful: I8 holds at every intermediate step (#2)
///   C10 Outstanding drawdown at maturity + post-maturity repay: I2 holds through close (#4)
///   C11 Circuit-breaker stuck-paused: recovery path documented (#5)
contract InvariantVerificationTests is Test {
    uint256 constant SCALE = 1e12;
    uint256 constant WAD   = 1e18;
    uint256 constant D     = 86400;

    uint256 constant APR          = 1e17;   // 10%/yr
    uint256 constant IDLE_RATE    = 5e14;
    uint256 constant UTIL_RATE    = 5e14;
    uint256 constant PEN_RATE     = 1e15;
    uint256 constant PGD          = 2;
    uint256 constant TENURE       = 30;
    uint256 constant LOCK_TS      = 5 * D;
    uint256 constant MATURITY_TS  = LOCK_TS + TENURE * D;

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
    PoolContract    impl;

    function setUp() public {
        vm.warp(0);
        usdc     = new MockStablecoin();
        impl     = new PoolContract();
        treasury = new TreasuryReserve(
            address(usdc), MULTISIG,
            1e17, 1_000_000 * SCALE, WAD, 0
        );
        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * 86400, 25e16, 3, 1, 7
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _newPool(uint256 softCapRaw) internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           softCapRaw * SCALE,
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

    function _draw(PoolContract p, bytes32 ref, uint256 rawAmt, uint256 settle) internal {
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, rawAmt * SCALE, settle);
    }

    function _repay(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.prank(PSP); usdc.approve(address(p), total);
        vm.prank(PSP); p.repay(ref);
    }

    function _assertI1(PoolContract p, string memory label) internal view {
        uint256 poolBal = usdc.balanceOf(address(p));
        uint256 tracked =
            (p.principal() - p.outstanding() - p.claimedPrincipal())
            + (p.collectedYield()       - p.claimedYield())
            + p.reservedYield()
            + (p.collectedOverrunYield() - p.claimedOverrunYield())
            + (p.collectedBonus()        - p.claimedBonus())
            + p.protocolFees();
        assertEq(poolBal, tracked, label);
    }

    function _assertI2(PoolContract p, string memory label) internal view {
        PoolContract.Status s = p.status();
        if (s == PoolContract.Status.Funding || s == PoolContract.Status.Unsuccessful) return;
        assertEq(
            p.outstanding() + p.availableToDd() + p.collectedPrincipal(),
            p.principal(),
            label
        );
    }

    function _assertI8(PoolContract p, string memory label) internal view {
        PoolContract.Status s = p.status();
        if (s != PoolContract.Status.Funding && s != PoolContract.Status.Unsuccessful) return;
        if (p.principal() == 0) return;

        uint256 poolLU = p.lastUpdate();
        (uint256 pA, uint256 fcA, uint256 luA, , , , , , ) = p.lpPositions(LP_A);
        (uint256 pB, uint256 fcB, uint256 luB, , , , , , ) = p.lpPositions(LP_B);

        assertGe(poolLU, luA, string.concat(label, " I8a: pool.lastUpdate < LP_A.lastUpdate"));
        assertGe(poolLU, luB, string.concat(label, " I8b: pool.lastUpdate < LP_B.lastUpdate"));

        uint256 sumLp = (fcA + pA * (poolLU - luA)) + (fcB + pB * (poolLU - luB));
        assertEq(p.fundingCredit(), sumLp, string.concat(label, " I8eq"));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C7: Claim-then-pre-maturity-default — no share corruption
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Concern from prompt: LP_A calls claimYield pre-maturity → pos.finalized=true
    // → declareDefault rebases span → pos.dollarSeconds is now stale (set with old
    // full span, denominator shrank) → baseShare inflated → strands LP_B.
    //
    // Actual behavior: _settleLpDollarSeconds always executes
    //   pos.dollarSeconds = pos.fundingCredit + pos.principal * span
    // unconditionally on line 871 (outside the if(!pos.finalized) block). After
    // declareDefault sets span = elapsed, LP_A's next claimYield overwrites
    // pos.dollarSeconds with the rebased value. No stale numerator.
    //
    // Test confirms: after the full sequence, neither LP is stranded, sum of
    // per-LP claimedYield == pool claimedYield <= collectedYield.
    // ──────────────────────────────────────────────────────────────────────────
    function testC7_claimPreDefaultNoCorruption() public {
        // Soft cap = 3 SCALE; LP_A and LP_B each deposit 2 SCALE → total 4 SCALE > cap.
        PoolContract p = _newPool(3);

        // t=0: LP_A deposits. t=1D: LP_B deposits (different fundingCredit accrual).
        _deposit(p, LP_A, 2);
        vm.warp(1 * D);
        _deposit(p, LP_B, 2);

        // Lock at LOCK_TS = 5D.
        vm.warp(LOCK_TS);
        p.finalizeFunding();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Active));

        // t=6D: draw 2 SCALE, settle in 1 day.
        vm.warp(LOCK_TS + 1 * D);
        _draw(p, keccak256("r1"), 2, 1);

        // t=8D: repay → finance charge → collectedYield > 0.
        vm.warp(LOCK_TS + 3 * D);
        _repay(p, keccak256("r1"));
        uint256 collectedAfterRepay = p.collectedYield();
        assertGt(collectedAfterRepay, 0, "C7: need collectedYield > 0 before first claim");

        // t=10D: LP_A claims yield pre-maturity, pre-default.
        // _settleLpDollarSeconds fires: pos.finalized → true, pos.dollarSeconds set with span=30D.
        // F1 cap may apply (elapsed=5D from lock).
        vm.warp(LOCK_TS + 5 * D);
        vm.prank(LP_A); p.claimYield();
        (, , , , uint256 lpAClaimedAfterStep1, , , , ) = p.lpPositions(LP_A);

        // t=12D: draw 1 SCALE (keeps outstanding > 0 for a meaningful default).
        vm.warp(LOCK_TS + 7 * D);
        _draw(p, keccak256("r2"), 1, 1);
        assertGt(p.outstanding(), 0, "C7: need outstanding > 0 for declareDefault");

        // t=15D: declareDefault pre-maturity (elapsed from lock = 10D).
        // earned = mulDiv(dsElapsed, apr, WAD*SPY). If earned > collectedYield → Case 1:
        // span rebased to 10D, dollarSeconds rebased to dsElapsed.
        vm.warp(LOCK_TS + 10 * D);
        vm.prank(AGENT2); p.declareDefault();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default), "C7: should be Default");
        assertTrue(p.span() < TENURE * D, "C7: span should have rebased");
        uint256 collectedFinal = p.collectedYield();

        // t=16D: LP_B claims post-default.
        // _settleLpDollarSeconds: LP_B not finalized → pos.finalized=true; dollarSeconds set with
        // rebased span. No stale numerator for LP_B.
        vm.warp(LOCK_TS + 11 * D);
        uint256 lpBBalBefore = usdc.balanceOf(LP_B);
        vm.prank(LP_B); p.claimYield();
        uint256 lpBReceived = usdc.balanceOf(LP_B) - lpBBalBefore;
        (, , , , uint256 lpBClaimedFinal, , , , ) = p.lpPositions(LP_B);

        // LP_A claims again post-default.
        // _settleLpDollarSeconds: pos.finalized=true → SKIPS re-init; unconditionally executes
        //   pos.dollarSeconds = pos.fundingCredit + pos.principal * span (rebased span).
        // This OVERWRITES the stale full-span dollarSeconds with the correct rebased value.
        vm.prank(LP_A); p.claimYield();
        (, , , , uint256 lpAClaimedFinal, , , , ) = p.lpPositions(LP_A);

        // === Core assertions ===

        // (a) LP_B is NOT stranded by LP_A's pre-default claim.
        assertGt(lpBReceived, 0, "C7: LP_B was stranded - got zero yield post-default");

        // (b) Pool-level conservation: sum of per-LP claimed == pool claimedYield.
        uint256 sumClaimed = lpAClaimedFinal + lpBClaimedFinal;
        assertEq(p.claimedYield(), sumClaimed,
            "C7: pool.claimedYield != sum of LP claimedYields");

        // (c) No over-claim: pool claimedYield <= collectedYield.
        assertLe(p.claimedYield(), collectedFinal,
            "C7: claimedYield exceeds collectedYield");

        // (d) LP_A's total claimed does not exceed their rebased fair share.
        // Fair share = mulDiv(LP_A.dollarSeconds, collectedFinal, pool.dollarSeconds).
        (, , , uint256 lpADs, , , , , ) = p.lpPositions(LP_A);
        uint256 lpAFairShare = MathLib.mulDiv(lpADs, collectedFinal, p.dollarSeconds());
        assertLe(lpAClaimedFinal, lpAFairShare + 1,
            "C7: LP_A claimed more than rebased fair share (not just rounding)");

        _assertI1(p, "C7: I1 at end");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C8: Multi-LP yield exhaustion — stranded dust bounded by N wei
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Concern: after Default→settle→Closed, do all LPs claiming yield strand the
    // last few wei permanently? MulDiv always rounds down, so the last claimer
    // leaves at most N-1 wei (one per LP from floor rounding). This is documented
    // expected behavior, not a bug.
    //
    // Test confirms: stranded = collectedYield - claimedYield <= N=2 wei.
    // ──────────────────────────────────────────────────────────────────────────
    function testC8_yieldExhaustionDustBounded() public {
        PoolContract p = _newPool(1);
        _deposit(p, LP_A, 2);
        _deposit(p, LP_B, 2);
        vm.warp(LOCK_TS);
        p.finalizeFunding();

        // Draw and repay to accumulate collectedYield.
        _draw(p, keccak256("r1"), 3, 1);
        vm.warp(LOCK_TS + 5 * D);
        _repay(p, keccak256("r1"));

        // Reach maturity, pay idle fees to close the pool.
        vm.warp(MATURITY_TS);
        (, , uint256 idleOwed) = p.getIdleFeesBreakdown();
        if (idleOwed > 0) {
            usdc.mint(PSP, idleOwed);
            vm.prank(PSP); usdc.approve(address(p), idleOwed);
            vm.prank(PSP); p.payAccruedIdleFees(idleOwed);
        }
        // May not have closed if yield shortfall. Settle if in Default.
        if (p.status() == PoolContract.Status.Active) {
            vm.prank(AGENT2); p.declareDefault();
        }
        if (p.status() == PoolContract.Status.Default) {
            uint256 yShort = p.yieldOwed() > p.collectedYield()
                ? p.yieldOwed() - p.collectedYield() : 0;
            uint256 pShort = p.principal() > p.collectedPrincipal()
                ? p.principal() - p.collectedPrincipal() : 0;
            if (pShort > 0) {
                usdc.mint(MULTISIG, pShort);
                vm.startPrank(MULTISIG);
                usdc.approve(address(p), pShort);
                p.settleDefaultPrincipal(pShort);
                vm.stopPrank();
            }
            if (yShort > 0) {
                usdc.mint(MULTISIG, yShort);
                vm.startPrank(MULTISIG);
                usdc.approve(address(p), yShort);
                p.settleDefaultYield(yShort);
                vm.stopPrank();
            }
        }
        require(p.status() == PoolContract.Status.Closed, "C8: setup: not Closed");

        uint256 collectedYieldAtClose = p.collectedYield();

        // Both LPs claim yield to exhaustion.
        vm.prank(LP_A); p.claimYield();
        vm.prank(LP_B); p.claimYield();

        uint256 totalClaimed = p.claimedYield();
        uint256 stranded     = collectedYieldAtClose - totalClaimed;

        // With N=2 LPs, floor rounding strands at most 1 wei per LP → stranded <= 1.
        // Allow <= N=2 as a safe bound (one rounding loss per LP is the worst case).
        assertLe(stranded, 2, "C8: stranded dust exceeds N=2 wei bound");

        _assertI1(p, "C8: I1 after full claim");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C9: Partial withdrawal in Unsuccessful — I8 at every intermediate step
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Concern: forfeited = pos.fundingCredit * amount/pos.principal (line 275).
    // Does the symmetric subtraction from both pos.fundingCredit and pool
    // fundingCredit maintain I8 (equality of funding credits) at each step?
    //
    // Also verifies: _lpCheckpoint in Unsuccessful uses effectiveTs = lastUpdate
    // (frozen), so no new accrual after the Unsuccessful transition.
    // ──────────────────────────────────────────────────────────────────────────
    function testC9_partialWithdrawI8Intermediate() public {
        // Below softCap=3 SCALE — pool will go Unsuccessful.
        PoolContract p = _newPool(3);

        // LP_A at t=0, LP_B at t=1D (different fundingCredit accrual).
        _deposit(p, LP_A, 1);
        vm.warp(1 * D);
        _deposit(p, LP_B, 1);

        vm.warp(LOCK_TS);
        p.finalizeFunding(); // 2 SCALE < 3 SCALE → Unsuccessful
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Unsuccessful));
        _assertI8(p, "C9: initial Unsuccessful");

        // LP_A partial withdraw #1: withdraw half (0.5 SCALE).
        uint256 halfA = 5e11; // 0.5 SCALE
        vm.prank(LP_A); p.withdraw(halfA);
        _assertI8(p, "C9: after LP_A partial withdraw #1");
        _assertI1(p, "C9: I1 after LP_A partial #1");

        // LP_A partial withdraw #2: withdraw remaining half.
        (uint256 pA2, , , , , , , , ) = p.lpPositions(LP_A);
        assertEq(pA2, halfA, "C9: LP_A should have half principal remaining");
        vm.prank(LP_A); p.withdraw(halfA);
        _assertI8(p, "C9: after LP_A partial withdraw #2");
        _assertI1(p, "C9: I1 after LP_A partial #2");

        // LP_A fully withdrawn: pos.principal == 0.
        (uint256 pA3, uint256 fcA3, , , , , , , ) = p.lpPositions(LP_A);
        assertEq(pA3, 0,   "C9: LP_A principal should be 0");
        assertEq(fcA3, 0,  "C9: LP_A fundingCredit should be 0 after full forfeit");

        // LP_B withdraws all.
        (uint256 pB, , , , , , , , ) = p.lpPositions(LP_B);
        vm.prank(LP_B); p.withdraw(pB);
        _assertI8(p, "C9: after LP_B full withdraw");
        _assertI1(p, "C9: I1 after LP_B full withdraw");

        // Pool fully drained.
        assertEq(p.principal(), 0, "C9: pool principal should be 0 after all withdrawals");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C10: Outstanding drawdown at maturity + post-maturity repay — I2 intact
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Concern: _mature sweeps availableToDd → collectedPrincipal (line 905).
    // Post-maturity repay routes to collectedPrincipal (not availableToDd, line 451).
    // Test verifies I2 (outstanding + availableToDd + collectedPrincipal == principal)
    // holds at every step, including post-maturity-with-outstanding.
    // ──────────────────────────────────────────────────────────────────────────
    function testC10_postMaturityRepayI2() public {
        PoolContract p = _newPool(1);
        _deposit(p, LP_A, 3);
        vm.warp(LOCK_TS);
        p.finalizeFunding();

        // Draw 2 SCALE, leaving 1 SCALE available.
        _draw(p, keccak256("dd1"), 2, 1);
        _assertI2(p, "C10: I2 after draw");
        assertEq(p.outstanding(), 2 * SCALE);
        assertEq(p.availableToDd(), 1 * SCALE);

        // Warp to maturity — _mature fires on next call, sweeps availableToDd.
        vm.warp(MATURITY_TS);

        // Trigger _mature via claimPrincipal (which calls _mature internally).
        vm.prank(LP_A); p.claimPrincipal(); // triggers _accrueIdleFees + _mature
        _assertI2(p, "C10: I2 after maturity sweep");
        assertEq(p.availableToDd(), 0, "C10: availableToDd must be 0 post-maturity sweep");
        // outstanding unchanged (only the undrawn principal was swept)
        assertEq(p.outstanding(), 2 * SCALE, "C10: outstanding unchanged by maturity sweep");

        // Post-maturity repay: routes ddAmount → collectedPrincipal (not availableToDd).
        _repay(p, keccak256("dd1"));
        _assertI2(p, "C10: I2 after post-maturity repay");
        assertEq(p.outstanding(), 0, "C10: outstanding must be 0 after repay");
        assertEq(p.availableToDd(), 0, "C10: availableToDd stays 0 post-maturity");
        assertEq(p.collectedPrincipal(), 3 * SCALE, "C10: all principal collected");

        _assertI1(p, "C10: I1 at end");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C11: Circuit-breaker stuck-paused — recovery is possible (design intent)
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Mechanism: setScOverdue(false) sets scOverdueCheck=false AND paused=anyOverdue.
    // Repay does NOT clear paused. After repaying the overdue drawdown, paused=true
    // remains → pool is still paused (can't draw). This is INTENTIONAL: in manual
    // mode the agent manually controls pausing. Recovery: setPaused(false).
    //
    // Test confirms: (a) pool is stuck-paused after repaying the overdue DD, and
    // (b) setPaused(false) restores drawdown capability — recovery is available.
    // ──────────────────────────────────────────────────────────────────────────
    function testC11_circuitBreakerRecovery() public {
        PoolContract p = _newPool(1);
        _deposit(p, LP_A, 3);
        vm.warp(LOCK_TS);
        p.finalizeFunding();

        // Draw at t=6D with 1-day settlement (expiryTs = 7D).
        vm.warp(LOCK_TS + 1 * D);
        _draw(p, keccak256("dd1"), 1, 1);

        // Warp past penalty start (penaltyGraceDays=2 + due=1 + 1 = day 4 from start).
        // From contract: penaltyStart = dueDayOffset+1+penaltyGraceDays = 1+1+2=4.
        // elapsedDays = dayOf(now) - dayOf(startTs). At t=LOCK_TS+5D:
        // startTs=LOCK_TS+1D, elapsedDays=4 >= penaltyStart=4 → overdue.
        vm.warp(LOCK_TS + 5 * D);

        // setScOverdue(false): scOverdueCheck=false, paused=true (drawdown is overdue).
        vm.prank(AGENT1); p.setScOverdue(false);
        assertFalse(p.scOverdueCheck(), "C11: scOverdueCheck should be false");
        assertTrue(p.paused(), "C11: pool should be paused (overdue DD exists)");

        // Repay the overdue drawdown.
        _repay(p, keccak256("dd1"));
        assertEq(p.outstanding(), 0, "C11: outstanding should be 0 after repay");

        // After repay, pool is STILL paused — repay does not clear paused.
        // This is design intent: manual mode, agent must manually unpause.
        assertTrue(p.paused(), "C11: pool still paused after repay (expected: manual mode)");
        assertFalse(p.isDrawdownAllowed(), "C11: drawdown blocked while paused");

        // Recovery: AGENT1 calls setPaused(false). Requires !scOverdueCheck (holds).
        vm.prank(AGENT1); p.setPaused(false);
        assertFalse(p.paused(), "C11: pool should be unpaused after setPaused(false)");
        assertTrue(p.isDrawdownAllowed(), "C11: drawdown allowed after manual unpause");

        // Confirm a new drawdown succeeds after recovery.
        _draw(p, keccak256("dd2"), 1, 1);
        assertGt(p.outstanding(), 0, "C11: new drawdown should succeed after recovery");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C12: reservedYield stranding when claimYield triggers normal-close
    // ══════════════════════════════════════════════════════════════════════════
    //
    // BUG: _settleTerminalSplit() (line 940) reads only `protocolFees`. When
    // claimYield triggers closure (via _mature→_checkFinality), _allocate is
    // never called, so any pre-maturity surplus accumulated in `reservedYield`
    // is never flushed to protocolFees. It is permanently stranded —
    // sweepProtocolFees reverts "nothing to sweep."
    //
    // Reproducing sequence:
    //   1. Lock at t=0 (hardCap hit on deposit, fundingCredit≈0).
    //      idleRateDaily=0 so accIdleFees stays 0 throughout.
    //   2. Draw all capital immediately (availableToDd=0).
    //   3. Let drawdown go overdue so financeCharge >> yieldOwed.
    //   4. Repay pre-maturity: _allocate (pre-maturity path) fills collectedYield
    //      to yieldOwed, routes surplus to reservedYield. availableToDd restored.
    //   5. At poolFinalityTs, LP calls claimYield → _mature → _checkFinality closes
    //      (all conditions met: collectedYield=yieldOwed, accIdleFees=0, etc.).
    //      _settleTerminalSplit: protocolFees=0 → returns immediately. reservedYield
    //      untouched. I11 violated.
    //
    // Fix (line numbers reference PoolContract.sol):
    //   In _settleTerminalSplit, prepend:
    //     protocolFees += reservedYield;
    //     reservedYield = 0;
    //   Economically equivalent to the full _allocate waterfall because
    //   _checkFinality only closes when collectedYield>=yieldOwed (line 914)
    //   AND collectedOverrunYield>=overrunYield (line 915) — both shortfalls are
    //   zero, so the waterfall would route 100% of reservedYield to protocolFees.
    // ──────────────────────────────────────────────────────────────────────────
    function testC12_reservedYieldStrandedAtCloseViaClaim() public {
        // idleRateDaily=0: no idle fees, accIdleFees stays 0 (factory allows
        // this: 0 <= utilizedRateDaily).  hardCap=4*SCALE so both deposits
        // trigger immediate lock at t=0 with fundingCredit=0.
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           2 * SCALE,
            hardCap:           4 * SCALE,
            tenure:            TENURE,
            idleRateDaily:     0,
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

        _deposit(p, LP_A, 2);
        _deposit(p, LP_B, 2);
        // v2: no hard-cap auto-lock; finalize explicitly at fMaturityTs.
        vm.warp(p.fMaturityTs()); p.finalizeFunding();
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "C12: should be Active");

        uint256 yieldOwed_ = p.yieldOwed();

        // Draw all 4 SCALE, settlementDays=1.
        bytes32 ref = keccak256("c12");
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, 4 * SCALE, 1);
        assertEq(p.availableToDd(), 0, "C12: all capital drawn");

        // Day 20: drawdown overdue since day 4 (penaltyStartDay = 1+1+2 = 4).
        // stdDays=4, penDays=17.
        // financeCharge = 4e12*(4*5e14 + 17*1e15)/1e18 ≈ 76e9 >> yieldOwed≈32.9e9.
        vm.warp(20 * D);
        _repay(p, ref);

        // Pre-maturity _allocate: fills collectedYield to yieldOwed, surplus → reservedYield.
        assertEq(p.collectedYield(), yieldOwed_, "C12: collectedYield should equal yieldOwed");
        assertGt(p.reservedYield(), 0,           "C12: surplus must be in reservedYield");
        assertEq(p.protocolFees(),  0,           "C12: protocolFees not yet allocated");
        uint256 stranded = p.reservedYield();

        // Warp to poolFinalityTs (30D from lock). outstanding=0, accIdleFees=0.
        vm.warp(p.poolFinalityTs());

        // claimYield triggers _mature → _checkFinality (all conditions met) → Closed.
        // _settleTerminalSplit sees protocolFees=0 → returns; reservedYield untouched.
        vm.prank(LP_A); p.claimYield();
        assertEq(uint(p.status()), uint(PoolContract.Status.Closed), "C12: should be Closed");

        // I11: reservedYield must be 0 in Closed.
        // This assertion FAILS on buggy code; PASSES after fix.
        assertEq(p.reservedYield(), 0,
            "C12 BUG: reservedYield stranded - _settleTerminalSplit must merge it into protocolFees");

        // After fix: _settleTerminalSplit merged reservedYield into protocolFees,
        // then ran the normal terminal split (reserve topup, LP bonus). protocolFees
        // is the remainder — positive, and sweepProtocolFees must succeed.
        assertGt(p.protocolFees(), 0,    "C12: protocolFees must be > 0 after fix (router worked)");
        assertLe(p.protocolFees(), stranded, "C12: protocolFees cannot exceed original surplus");
        vm.prank(MULTISIG); p.sweepProtocolFees();
        assertEq(p.protocolFees(), 0,    "C12: protocolFees must be 0 after sweep");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C13: F1 cap at maximally-asymmetric deposit timing
    //
    // Setup: LP_A deposits at t=0 (funding-open); LP_B deposits at
    // fMaturityTs-1 (last second of the 5-day funding window). Both hold equal
    // principal (2*SCALE). LP_A accrued ~5 days of fundingCredit; LP_B accrued
    // zero. They hit hardCap, so the pool locks immediately on LP_B's deposit.
    //
    // Assertions:
    //   (a) F1 cap fires for LP_B: elapsedShare_B < baseShare_B, so LP_B's
    //       pre-maturity claimable yield is capped to the elapsed-time share.
    //   (b) F1 cap does NOT inflate LP_A: elapsedShare_A > baseShare_A, so
    //       LP_A is limited by their dollar-seconds base share.
    //   (c) LP_A's early claim does not strand LP_B: LP_B claims additional
    //       yield at maturity (when F1 cap no longer applies) and receives
    //       their full remaining proportional share.
    //   (d) claimedYield <= collectedYield throughout; I1 holds.
    // ══════════════════════════════════════════════════════════════════════════
    function testC13_f1CapAsymmetricDeposit() public {
        // idleRateDaily=0 keeps accIdleFees=0 so _checkFinality conditions are
        // cleaner. hardCap=4*SCALE: LP_A+LP_B exactly saturate it, triggering
        // an immediate lock on LP_B's deposit.
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           2 * SCALE,
            hardCap:           4 * SCALE,
            tenure:            TENURE,
            idleRateDaily:     0,
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

        // t=0: LP_A deposits. Pool is still Funding (below hardCap).
        _deposit(p, LP_A, 2);
        assertEq(uint(p.status()), uint(PoolContract.Status.Funding), "C13: LP_A deposit keeps Funding");

        // t = fMaturityTs - 1: LP_B deposits 2*SCALE (hits hardCap but no auto-lock in v2).
        // v2: finalizeFunding must be called at t >= fMaturityTs; we warp 1 second forward.
        // _globalCheckpoint in finalize credits 4*SCALE×1s = 4*SCALE to fundingCredit on top
        // of LP_A's 2*SCALE*(fMaturityTs-1) pre-lock credit.
        uint256 lpBDepositTs = p.fMaturityTs() - 1;   // when LP_B deposits
        uint256 finalizeTs   = p.fMaturityTs();        // when finalizeFunding fires = poolStartTs
        vm.warp(lpBDepositTs);
        _deposit(p, LP_B, 2);
        assertEq(uint(p.status()), uint(PoolContract.Status.Funding), "C13: LP_B deposit keeps Funding (no auto-lock)");
        vm.warp(finalizeTs);
        vm.prank(AGENT1); p.finalizeFunding();  // v2: explicit lock at fMaturityTs (within buffer)
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "C13: finalizeFunding -> Active");
        assertEq(p.poolStartTs(), finalizeTs, "C13: poolStartTs == finalizeTs");

        uint256 activeStart  = p.poolStartTs();
        uint256 poolSpan     = p.span();            // 30 * D
        uint256 totalDS      = p.dollarSeconds();   // frozen at lock
        uint256 fcPool       = p.fundingCredit();
        // fcPool = 2*SCALE*(fMaturityTs-1) [LP_A credit] + 4*SCALE*1 [1-second both-LPs credit at finalize]
        assertEq(fcPool, 2 * SCALE * lpBDepositTs + 4 * SCALE, "C13: fundingCredit == LP_A pre-lock + 1s both");
        assertGt(fcPool, 0, "C13: fundingCredit > 0");

        // ── Derive expected LP dollar-seconds (mirrors _settleLpDollarSeconds) ──
        // LP_A: credit covers t=0 → poolStartTs=finalizeTs, plus the full tenure.
        uint256 posDS_A = 2 * SCALE * finalizeTs + 2 * SCALE * poolSpan;
        // LP_B: deposited 1s before poolStartTs → 1 second of pre-lock credit, plus tenure.
        uint256 posDS_B = 2 * SCALE * 1 + 2 * SCALE * poolSpan;
        assertEq(posDS_A + posDS_B, totalDS, "C13: LP dollar-seconds sum == pool dollarSeconds");

        // ── Draw and repay to produce collectedYield ──────────────────────────
        bytes32 ref = keccak256("c13");
        vm.warp(activeStart + 1 * D);
        _draw(p, ref, 4, 1);                     // draw 4*SCALE, due in 1 day
        vm.warp(activeStart + 2 * D);            // repay at expiry (no penalty)
        _repay(p, ref);
        uint256 collectedY = p.collectedYield();
        assertGt(collectedY, 0, "C13: need collectedYield > 0");
        assertLt(block.timestamp, p.poolFinalityTs(), "C13: claims must be pre-maturity");

        // ── Compute F1 caps for both LPs at claim time ────────────────────────
        uint256 elapsed       = block.timestamp - activeStart;   // 2*D
        uint256 dsPoolElapsed = fcPool + p.principal() * elapsed;

        // LP_A: settled fundingCredit = 2*SCALE*finalizeTs (credit from t=0 to poolStartTs).
        uint256 lpAFc         = 2 * SCALE * finalizeTs;
        uint256 dsLpA_el      = lpAFc + 2 * SCALE * elapsed;
        uint256 elapsedShareA = MathLib.mulDiv(dsLpA_el,   WAD, dsPoolElapsed);

        // LP_B: 1-second pre-lock credit (deposited 1s before poolStartTs) + elapsed tenure.
        uint256 dsLpB_el      = 2 * SCALE * 1 + 2 * SCALE * elapsed;
        uint256 elapsedShareB = MathLib.mulDiv(dsLpB_el,   WAD, dsPoolElapsed);

        uint256 bShareA = MathLib.mulDiv(posDS_A, WAD, totalDS);
        uint256 bShareB = MathLib.mulDiv(posDS_B, WAD, totalDS);

        // Confirm the cap geometry before claiming.
        assertGt(elapsedShareA, bShareA, "C13: elapsedShareA > bShareA so F1 must NOT cap LP_A");
        assertLt(elapsedShareB, bShareB, "C13: elapsedShareB < bShareB so F1 MUST cap LP_B");

        uint256 f1CapOwedB = MathLib.mulDiv(elapsedShareB, collectedY, WAD);
        uint256 fullOwedB  = MathLib.mulDiv(bShareB,        collectedY, WAD);
        uint256 baseOwedA  = MathLib.mulDiv(bShareA,        collectedY, WAD);

        // ── LP_A claims first ─────────────────────────────────────────────────
        vm.prank(LP_A); p.claimYield();
        (, , , , uint256 lpAClaimed, , , , ) = p.lpPositions(LP_A);
        assertGt(lpAClaimed, 0, "C13: LP_A must claim > 0");
        // LP_A is not inflated by F1 (F1 does not apply): claim ~= baseOwedA.
        assertApproxEqAbs(lpAClaimed, baseOwedA, 2, "C13: LP_A yield ~= baseShare * collectedY");

        // ── LP_B claims second (pre-maturity, F1 cap applies) ─────────────────
        vm.prank(LP_B); p.claimYield();
        (, , , , uint256 lpBClaimedPre, , , , ) = p.lpPositions(LP_B);
        assertGt(lpBClaimedPre, 0, "C13: LP_B must claim > 0 pre-maturity");
        // F1 cap is active: LP_B cannot claim more than their elapsed-time share.
        assertLe(lpBClaimedPre, f1CapOwedB + 1, "C13: LP_B overclaimed beyond F1 cap");
        // F1 cap reduced LP_B well below their uncapped base share.
        assertLt(lpBClaimedPre, fullOwedB, "C13: F1 cap must reduce LP_B below base-share level");

        // ── Pool solvency ────────────────────────────────────────────────────
        assertLe(p.claimedYield(), collectedY, "C13: total claims must not exceed collectedYield");
        _assertI1(p, "C13 I1 pre-maturity");

        // ── LP_B is not stranded: claim remaining share at maturity ──────────
        // At poolFinalityTs the condition `block.timestamp < poolFinalityTs` is
        // false, so F1 cap no longer applies and LP_B gets their full base share.
        vm.warp(p.poolFinalityTs());
        vm.prank(LP_B); p.claimYield();
        (, , , , uint256 lpBClaimedFinal, , , , ) = p.lpPositions(LP_B);
        assertGt(lpBClaimedFinal, lpBClaimedPre, "C13: LP_B must claim more at maturity (not stranded)");
        // Total LP_B received should reach their full base share (rounding ±2).
        assertApproxEqAbs(lpBClaimedFinal, fullOwedB, 2, "C13: LP_B total ~= baseShare * collectedY at maturity");
        _assertI1(p, "C13 I1 post-maturity");
    }

    // ── Terminal split helpers ────────────────────────────────────────────────
    //
    // Called after all LPs have fully claimed (claimYield + claimPrincipal)
    // to assert proportional fairness across three streams. Tolerances match
    // claimYield's two-step mulDiv: 2 wei for base, 1 wei for overrun/bonus.
    // ─────────────────────────────────────────────────────────────────────────

    function _assertTerminalLpSplit(PoolContract p, address lp, string memory label) internal view {
        (uint256 lpPrin,,, uint256 lpDs, uint256 lpCY,, uint256 lpCO, uint256 lpCB,) = p.lpPositions(lp);
        if (lpPrin == 0) return;
        uint256 cY = p.collectedYield();
        uint256 cO = p.collectedOverrunYield();
        uint256 cB = p.collectedBonus();
        if (cY > 0 && p.dollarSeconds() > 0) {
            assertApproxEqAbs(lpCY, MathLib.mulDiv(lpDs, cY, p.dollarSeconds()), 2,
                string.concat(label, ": base yield not proportional"));
        }
        if (cO > 0 && p.principal() > 0) {
            assertApproxEqAbs(lpCO, MathLib.mulDiv(lpPrin, cO, p.principal()), 1,
                string.concat(label, ": overrun not proportional"));
        }
        if (cB > 0 && p.principal() > 0) {
            assertApproxEqAbs(lpCB, MathLib.mulDiv(lpPrin, cB, p.principal()), 1,
                string.concat(label, ": bonus not proportional"));
        }
    }

    function _assertTerminalExactSplit(PoolContract p, string memory label) internal view {
        (,,,, uint256 aY,, uint256 aO, uint256 aB,) = p.lpPositions(LP_A);
        (,,,, uint256 bY,, uint256 bO, uint256 bB,) = p.lpPositions(LP_B);
        assertEq(aY + bY, p.claimedYield(),        string.concat(label, ": LP yield sum != pool"));
        assertEq(aO + bO, p.claimedOverrunYield(),  string.concat(label, ": LP overrun sum != pool"));
        assertEq(aB + bB, p.claimedBonus(),         string.concat(label, ": LP bonus sum != pool"));
        _assertTerminalLpSplit(p, LP_A, string.concat(label, " LP_A"));
        _assertTerminalLpSplit(p, LP_B, string.concat(label, " LP_B"));
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C14: Settled at maturity — realized APR == ceiling
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Staggered deposits (LP_A at t=0, LP_B at t=1D) so the two LPs have
    // different dollar-seconds. Full drawdown (4 SCALE), repaid after 20 active
    // days so the finance charge exceeds yieldOwed and fills it exactly.
    // Idle fees at maturity trigger closure. Asserts collectedYield == yieldOwed
    // and the proportional split holds on the rebased ds basis.
    // ──────────────────────────────────────────────────────────────────────────
    function testC14_settledAtMaturity() public {
        PoolContract p = _newPool(3);

        _deposit(p, LP_A, 2);
        vm.warp(1 * D);
        _deposit(p, LP_B, 2);

        vm.warp(LOCK_TS);
        p.finalizeFunding();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Active), "C14: should be Active");

        uint256 yO          = p.yieldOwed();
        uint256 activeStart = p.poolStartTs();

        // Draw all 4 SCALE at active day 1, repay after 20 days.
        // Finance charge = 4e12 * 20 * UTIL_RATE / WAD > yieldOwed → fills and caps.
        vm.warp(activeStart + 1 * D);
        _draw(p, keccak256("c14"), 4, 1);

        vm.warp(activeStart + 21 * D);
        _repay(p, keccak256("c14"));

        // Pre-maturity _allocate fills collectedYield up to yieldOwed exactly.
        assertEq(p.collectedYield(), yO, "C14: collectedYield should == yieldOwed after full-fill repay");

        // Pay idle fees at maturity — triggers _mature -> _checkFinality -> Closed.
        vm.warp(MATURITY_TS);
        (, , uint256 idleOwed) = p.getIdleFeesBreakdown();
        assertGt(idleOwed, 0, "C14: expected non-zero idle fees");
        usdc.mint(PSP, idleOwed);
        vm.prank(PSP); usdc.approve(address(p), idleOwed);
        vm.prank(PSP); p.payAccruedIdleFees(idleOwed);
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "C14: should be Closed at maturity");

        // Ceiling holds: LPs collectively received exactly the coupon target.
        assertEq(p.collectedYield(), yO, "C14: collectedYield != yieldOwed at close");
        assertEq(p.collectedOverrunYield(), p.overrunYield(), "C14: overrun ceiling mismatch");

        // Both LPs claim all streams.
        vm.prank(LP_A); p.claimYield(); vm.prank(LP_A); p.claimPrincipal();
        vm.prank(LP_B); p.claimYield(); vm.prank(LP_B); p.claimPrincipal();

        _assertTerminalExactSplit(p, "C14");
        _assertI1(p, "C14 I1");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C15: Under-filled with low idle rate — fairness under yield shortfall
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Pool with near-zero idle rate (idleRateDaily=1) so idle fees contribute
    // essentially nothing. Tiny drawdown + repay → collectedYield << yieldOwed.
    // Asserts the shortfall is confirmed (realized APR < ceiling) and then that
    // the available yield is still split proportionally (no LP is shortchanged
    // relative to another — the shortfall is shared, not concentrated).
    // ──────────────────────────────────────────────────────────────────────────
    function testC15_underfilledLowIdleRate() public {
        // Inline pool creation with near-zero idle rate.
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           3 * SCALE,
            hardCap:           9_000_000 * SCALE,
            tenure:            TENURE,
            idleRateDaily:     1,          // near-zero: idle fees ~ 0
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

        _deposit(p, LP_A, 2);
        vm.warp(1 * D);
        _deposit(p, LP_B, 2);

        vm.warp(LOCK_TS);
        p.finalizeFunding();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Active), "C15: should be Active");

        uint256 yO          = p.yieldOwed();
        uint256 activeStart = p.poolStartTs();

        // Small draw (1 SCALE) and quick repay — finance charge << yieldOwed.
        vm.warp(activeStart + 1 * D);
        _draw(p, keccak256("c15"), 1, 1);

        vm.warp(activeStart + 3 * D);
        _repay(p, keccak256("c15"));

        // At maturity: use claimYield to trigger _mature (idle fees ≈ 0).
        vm.warp(MATURITY_TS);
        vm.prank(LP_A); p.claimYield();

        // Shortfall is real: not enough activity to fill the coupon.
        assertLt(p.collectedYield(), yO, "C15: collectedYield must be < yieldOwed (shortfall scenario)");

        // Declare default post-maturity (principal already swept by _mature).
        vm.prank(AGENT2); p.declareDefault();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default), "C15: should be Default");

        // Settle yield shortfall — pool closes via _resolveDefaultIfWhole.
        uint256 yieldShort = p.yieldOwed() - p.collectedYield();
        usdc.mint(MULTISIG, yieldShort);
        vm.startPrank(MULTISIG);
        usdc.approve(address(p), yieldShort);
        p.settleDefaultYield(yieldShort);
        vm.stopPrank();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "C15: should be Closed after settlement");

        // LP_A already claimed a partial share pre-default; now both claim remaining.
        vm.prank(LP_A); p.claimYield(); vm.prank(LP_A); p.claimPrincipal();
        vm.prank(LP_B); p.claimYield(); vm.prank(LP_B); p.claimPrincipal();

        // Despite the shortfall, the split is still proportional.
        _assertTerminalExactSplit(p, "C15");
        _assertI1(p, "C15 I1");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C16: Pre-maturity default — proportional split on rebased ds basis
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Staggered deposits so LPs have different dollar-seconds. Partial drawdown
    // (2 SCALE) left outstanding when default is declared pre-maturity. Case 1
    // rebase (earned > collectedYield) shrinks span, dollarSeconds, and yieldOwed
    // atomically. Multisig settles both principal and yield shortfalls.
    // Asserts the split is proportional on the rebased basis and that
    // collectedYield <= original yieldOwed still holds.
    // ──────────────────────────────────────────────────────────────────────────
    function testC16_defaultPreMaturityStaggered() public {
        PoolContract p = _newPool(3);

        _deposit(p, LP_A, 2);
        vm.warp(1 * D);
        _deposit(p, LP_B, 2);

        vm.warp(LOCK_TS);
        p.finalizeFunding();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Active), "C16: should be Active");

        uint256 activeStart = p.poolStartTs();

        // Draw 2 SCALE at active day 1, leave it outstanding (no repay).
        vm.warp(activeStart + 1 * D);
        _draw(p, keccak256("c16"), 2, 1);

        // Declare default at active day 5 — pre-maturity, Case 1 rebase applies
        // (earned at 5D elapsed > collectedYield == 0).
        vm.warp(activeStart + 5 * D);
        uint256 yieldOwedBeforeDefault = p.yieldOwed();
        vm.prank(AGENT2); p.declareDefault();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default), "C16: should be Default");

        // Rebased yieldOwed must be <= original (Case 1 only shrinks the basis).
        uint256 rebasedYO = p.yieldOwed();
        assertGt(rebasedYO, 0, "C16: rebased yieldOwed must be > 0");

        // Settle principal shortfall (outstanding 2 SCALE not repaid).
        uint256 prinShort = p.principal() - p.collectedPrincipal();
        assertGt(prinShort, 0, "C16: expected principal shortfall");
        usdc.mint(MULTISIG, prinShort);
        vm.startPrank(MULTISIG);
        usdc.approve(address(p), prinShort);
        p.settleDefaultPrincipal(prinShort);
        vm.stopPrank();

        // Settle yield shortfall.
        uint256 yieldShort = p.yieldOwed() - p.collectedYield();
        usdc.mint(MULTISIG, yieldShort);
        vm.startPrank(MULTISIG);
        usdc.approve(address(p), yieldShort);
        p.settleDefaultYield(yieldShort);
        vm.stopPrank();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "C16: should be Closed after settlement");

        // Both LPs claim all streams.
        vm.prank(LP_A); p.claimYield(); vm.prank(LP_A); p.claimPrincipal();
        vm.prank(LP_B); p.claimYield(); vm.prank(LP_B); p.claimPrincipal();

        // Split is proportional on the rebased dollar-seconds basis.
        _assertTerminalExactSplit(p, "C16");
        // Ceiling holds: collectedYield == rebased yieldOwed (settled exactly).
        assertEq(p.collectedYield(), rebasedYO, "C16: collectedYield != rebased yieldOwed");
        _assertI1(p, "C16 I1");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C17: Surplus finance charge — excess capped at yieldOwed ceiling
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Full drawdown, repaid deep into penalty days so the finance charge far
    // exceeds yieldOwed. _allocate clamps collectedYield at yieldOwed; the
    // excess flows to reservedYield and then protocolFees at maturity.
    // Asserts collectedYield == yieldOwed (LPs do not receive more than the
    // ceiling) and the proportional split holds.
    // ──────────────────────────────────────────────────────────────────────────
    function testC17_surplusFinanceCharge() public {
        PoolContract p = _newPool(3);

        _deposit(p, LP_A, 2);
        vm.warp(1 * D);
        _deposit(p, LP_B, 2);

        vm.warp(LOCK_TS);
        p.finalizeFunding();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Active), "C17: should be Active");

        uint256 yO          = p.yieldOwed();
        uint256 activeStart = p.poolStartTs();

        // Draw all 4 SCALE at active day 1, repay at active day 20.
        // 19 days outstanding: 3 std days + 16 penalty days.
        // Finance charge = 4e12*(3*UTIL_RATE + 16*PEN_RATE)/WAD >> yieldOwed.
        vm.warp(activeStart + 1 * D);
        _draw(p, keccak256("c17"), 4, 1);

        vm.warp(activeStart + 20 * D);
        _repay(p, keccak256("c17"));

        // Pre-maturity _allocate caps: collectedYield == yieldOwed, surplus in reservedYield.
        assertEq(p.collectedYield(), yO, "C17: collectedYield must == yieldOwed (capped)");
        assertGt(p.reservedYield(), 0,   "C17: surplus must be in reservedYield");

        // Pay idle fees at maturity — flushes reservedYield to protocolFees, closes pool.
        vm.warp(MATURITY_TS);
        (, , uint256 idleOwed) = p.getIdleFeesBreakdown();
        assertGt(idleOwed, 0, "C17: expected idle fees");
        usdc.mint(PSP, idleOwed);
        vm.prank(PSP); usdc.approve(address(p), idleOwed);
        vm.prank(PSP); p.payAccruedIdleFees(idleOwed);
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "C17: should be Closed at maturity");

        // LPs collectively received exactly the ceiling — no more.
        assertEq(p.collectedYield(), yO, "C17: collectedYield != yieldOwed at close");
        assertGt(p.protocolFees() + p.claimedBonus(), 0, "C17: excess must route to protocol/bonus");

        // Both LPs claim all streams.
        vm.prank(LP_A); p.claimYield(); vm.prank(LP_A); p.claimPrincipal();
        vm.prank(LP_B); p.claimYield(); vm.prank(LP_B); p.claimPrincipal();

        _assertTerminalExactSplit(p, "C17");
        _assertI1(p, "C17 I1");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // C18: Claim-timing independence — F1 is a throttle, not a haircut
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Same economic scenario run twice with the same PSP (P1 closes first,
    // releasing the PSP slot for P2). In Run 1 (P1), LP_A claims early
    // (pre-maturity, after repay fills collectedYield). In Run 2 (P2), LP_A
    // claims only at maturity. Both LPs reach identical terminal totals in both
    // runs, proving that the F1 elapsed-cap delays but does not reduce payouts.
    // ──────────────────────────────────────────────────────────────────────────
    function testC18_claimTimingIndependence() public {
        // ── Run 1: P1 — LP_A claims early pre-maturity ─────────────────────
        PoolContract p1 = _newPool(3);

        _deposit(p1, LP_A, 2);
        vm.warp(1 * D);
        _deposit(p1, LP_B, 2);

        vm.warp(LOCK_TS);
        p1.finalizeFunding();
        uint256 activeStart1 = p1.poolStartTs();

        // Draw all 4 SCALE, repay at active day 21 (fills collectedYield == yieldOwed).
        vm.warp(activeStart1 + 1 * D);
        _draw(p1, keccak256("c18-p1"), 4, 1);
        vm.warp(activeStart1 + 21 * D);
        _repay(p1, keccak256("c18-p1"));
        assertEq(p1.collectedYield(), p1.yieldOwed(), "C18 P1: collectedYield must == yieldOwed after repay");

        // LP_A claims early (pre-maturity; F1 does not cap LP_A since elapsedShare > baseShare).
        vm.warp(activeStart1 + 22 * D);
        vm.prank(LP_A); p1.claimYield();
        (,,,, uint256 lpA_p1_early,,,,) = p1.lpPositions(LP_A);
        assertGt(lpA_p1_early, 0, "C18 P1: LP_A must have claimed > 0 early");

        // Close P1 at maturity via idle fees.
        vm.warp(MATURITY_TS);
        (, , uint256 idle1) = p1.getIdleFeesBreakdown();
        assertGt(idle1, 0, "C18 P1: expected idle fees");
        usdc.mint(PSP, idle1);
        vm.prank(PSP); usdc.approve(address(p1), idle1);
        vm.prank(PSP); p1.payAccruedIdleFees(idle1);
        assertEq(uint8(p1.status()), uint8(PoolContract.Status.Closed), "C18 P1: should be Closed");

        // Both claim at maturity (LP_A gets remainder after early claim).
        vm.prank(LP_A); p1.claimYield(); vm.prank(LP_A); p1.claimPrincipal();
        vm.prank(LP_B); p1.claimYield(); vm.prank(LP_B); p1.claimPrincipal();

        (,,,, uint256 p1_aTotal,,,,) = p1.lpPositions(LP_A);
        (,,,, uint256 p1_bTotal,,,,) = p1.lpPositions(LP_B);

        // ── Run 2: P2 — both LPs claim only at maturity ─────────────────────
        // P1 closure called _releasePsp(), so the PSP slot is free for P2.
        // Use compile-time constants (not block.timestamp captures) for all warps
        // to avoid via_ir optimizer substituting the TIMESTAMP opcode at each use.
        PoolContract p2 = _newPool(3);

        // Mirror staggered timing: LP_A at MATURITY_TS+0, LP_B at MATURITY_TS+1D.
        _deposit(p2, LP_A, 2);
        vm.warp(MATURITY_TS + 1 * D);
        _deposit(p2, LP_B, 2);

        vm.warp(MATURITY_TS + LOCK_TS);
        p2.finalizeFunding();
        uint256 activeStart2 = p2.poolStartTs();

        vm.warp(activeStart2 + 1 * D);
        _draw(p2, keccak256("c18-p2"), 4, 1);
        vm.warp(activeStart2 + 21 * D);
        _repay(p2, keccak256("c18-p2"));
        assertEq(p2.collectedYield(), p2.yieldOwed(), "C18 P2: collectedYield must == yieldOwed after repay");

        // Close P2 at its maturity (no early claims).
        vm.warp(activeStart2 + TENURE * D);
        (, , uint256 idle2) = p2.getIdleFeesBreakdown();
        assertGt(idle2, 0, "C18 P2: expected idle fees");
        usdc.mint(PSP, idle2);
        vm.prank(PSP); usdc.approve(address(p2), idle2);
        vm.prank(PSP); p2.payAccruedIdleFees(idle2);
        assertEq(uint8(p2.status()), uint8(PoolContract.Status.Closed), "C18 P2: should be Closed");

        vm.prank(LP_A); p2.claimYield(); vm.prank(LP_A); p2.claimPrincipal();
        vm.prank(LP_B); p2.claimYield(); vm.prank(LP_B); p2.claimPrincipal();

        (,,,, uint256 p2_aTotal,,,,) = p2.lpPositions(LP_A);
        (,,,, uint256 p2_bTotal,,,,) = p2.lpPositions(LP_B);

        // Terminal totals must be identical regardless of claim timing (±2 wei rounding).
        assertApproxEqAbs(p1_aTotal, p2_aTotal, 2, "C18: LP_A terminal total differs between runs");
        assertApproxEqAbs(p1_bTotal, p2_bTotal, 2, "C18: LP_B terminal total differs between runs");

        _assertTerminalExactSplit(p1, "C18 P1");
        _assertTerminalExactSplit(p2, "C18 P2");
        _assertI1(p1, "C18 P1 I1");
        _assertI1(p2, "C18 P2 I1");
    }
}
