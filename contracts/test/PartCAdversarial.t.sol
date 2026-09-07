// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Part C adversarial tests ported from suite_adversarial.py Areas 1–5.
///
/// Area 1: Accrual ordering dependency (1A–1B)
/// Area 2: Exemption boundary and same-day churn stacking (2A–2D)
/// Area 3: v2 seams under adversarial timing (3A–3E)
/// Area 4: Cross-finality draws (4A, 4B, 4C_before, 4C_after, 4D)
/// Area 5: Stuck-state and double-claim hunting (5A–5H)
///
/// 2D turnaround (midnight repay + redraw, same calendar day) is classified
/// correct-by-design (model_design break in Python). The test asserts that
/// invariants still hold — no "fix" is applied.
contract PartCAdversarial is Test {

    // ── Constants ────────────────────────────────────────────────────────────

    uint256 constant D           = 86_400;
    uint256 constant BUFFER_SECS = 21_600;   // 0.25 × D (WAD 25e16 × D / WAD)
    uint256 constant SCALE       = 1e12;
    uint256 constant WAD         = 1e18;

    // ── Actors ───────────────────────────────────────────────────────────────

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant LP1      = address(0xAA01);
    address constant LP2      = address(0xAA02);

    // ── Infrastructure ───────────────────────────────────────────────────────

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
            1e17, 1_000_000 * SCALE, 1e18, 0
        );
        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * 86400, // maxFundingDurationSecs (30 days)
            25e16,   // fundingExecBufferDays (0.25 days, WAD)
            3,       // maxGracePeriodDays
            1,       // minDdDays
            7       // maxDdDays
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);
    }

    // ── Pool helpers ─────────────────────────────────────────────────────────

    struct PoolParams {
        uint256 tenure;
        uint256 aprAnnual;
    }

    function _createPool(PoolParams memory pp) internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           100 * SCALE,
            hardCap:           1_000_000 * SCALE,
            tenure:            pp.tenure,
            idleRateDaily:     5e14,     // 5 bps
            utilizedRateDaily: 1e15,     // 10 bps
            penaltyRateDaily:  2e15,     // 20 bps
            penaltyGraceDays:  0,
            minDeposit:        0,
            aprAnnual:         pp.aprAnnual,
            agent1:            AGENT1,
            agent2:            AGENT2,
            multisig:          MULTISIG
        }));
        p = PoolContract(addr);
    }

    function _createPoolCustomSoftCap(PoolParams memory pp, uint256 sc) internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           sc,
            hardCap:           1_000_000 * SCALE,
            tenure:            pp.tenure,
            idleRateDaily:     5e14,
            utilizedRateDaily: 1e15,
            penaltyRateDaily:  2e15,
            penaltyGraceDays:  0,
            minDeposit:        0,
            aprAnnual:         pp.aprAnnual,
            agent1:            AGENT1,
            agent2:            AGENT2,
            multisig:          MULTISIG
        }));
        p = PoolContract(addr);
    }

    /// @dev Deposit `pyAmt` (in Python dollar units; multiplied by SCALE internally).
    function _deposit(PoolContract p, address lp, uint256 pyAmt) internal {
        uint256 amt = pyAmt * SCALE;
        usdc.mint(lp, amt);
        vm.startPrank(lp);
        usdc.approve(address(p), amt);
        p.deposit(amt);
        vm.stopPrank();
    }

    function _tryFinalize(PoolContract p) internal {
        p.finalizeFunding();
    }

    /// @dev Execute a drawdown in one agent call.
    function _draw(PoolContract p, bytes32 ref, uint256 pyAmt, uint256 settlementDays) internal {
        uint256 amt = pyAmt * SCALE;
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, amt, settlementDays);
    }

    /// @dev Repay a drawdown (mints and approves exact amount from PSP).
    function _repay(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.startPrank(PSP);
        usdc.approve(address(p), total);
        p.repay(ref);
        vm.stopPrank();
    }

    /// @dev Pay all outstanding idle fees from PSP.
    function _payIdle(PoolContract p) internal {
        (, , uint256 total) = p.getIdleFeesBreakdown();
        if (total == 0) return;
        usdc.mint(PSP, total);
        vm.startPrank(PSP);
        usdc.approve(address(p), total);
        p.payAccruedIdleFees(total);
        vm.stopPrank();
    }

    /// @dev Settle default — supply principal and/or yield from MULTISIG wallet.
    function _settleDefault(PoolContract p, uint256 principalAmt, uint256 yieldAmt) internal {
        if (principalAmt > 0) {
            usdc.mint(MULTISIG, principalAmt);
            vm.startPrank(MULTISIG);
            usdc.approve(address(p), principalAmt);
            p.settleDefaultPrincipal(principalAmt);
            vm.stopPrank();
        }
        if (yieldAmt > 0) {
            usdc.mint(MULTISIG, yieldAmt);
            vm.startPrank(MULTISIG);
            usdc.approve(address(p), yieldAmt);
            p.settleDefaultYield(yieldAmt);
            vm.stopPrank();
        }
    }

    /// @dev Assert I2: outstanding + availableToDd + collectedPrincipal == principal.
    function _assertI2(PoolContract p, string memory label) internal view {
        uint256 lhs = p.outstanding() + p.availableToDd() + p.collectedPrincipal();
        assertEq(lhs, p.principal(), string.concat(label, ": I2 violated"));
    }

    // ── Area 1: Accrual ordering dependency ──────────────────────────────────

    /// @dev 1A: Two draws spanning a UTC-day boundary must accumulate exactly the
    ///      per-day idle fees for each distinct avail level.
    ///
    ///      day0 at 1 000 000 → 500 SCALE idle
    ///      day1 at   700 000 → 350 SCALE idle
    ///      total expected = 850 SCALE
    function test_1A_twoDrawsSpanningDayBoundary() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "1A: pool not active");

        uint256 start = p.poolStartTs();

        // Draw $300k at tenure day 1, 08:00 UTC
        vm.warp(start + D + 8 * 3600);
        _draw(p, "1a_r1", 300_000, 3);

        // Draw $200k at tenure day 2, 14:00 UTC
        vm.warp(start + 2 * D + 14 * 3600);
        _draw(p, "1a_r2", 200_000, 3);

        // idle after draw2:
        //   day 0 (1M avail): 500 SCALE
        //   day 1 (700k avail after draw1): 350 SCALE  → total 850 SCALE
        (uint256 idleFees, , ) = p.getIdleFeesBreakdown();
        assertEq(idleFees, 850 * SCALE, "1A: idle fees mismatch after two draws spanning day boundary");
    }

    /// @dev 1B: Repay then immediate redraw at the same timestamp.
    ///      I2 must hold and state must be internally consistent.
    function test_1B_repayThenReDrawSameTimestamp() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 14, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D + 6 * 3600);
        _draw(p, "1b_r1", 600_000, 5);

        // Repay at day 3
        vm.warp(start + 3 * D + 6 * 3600);
        _repay(p, "1b_r1");

        // Immediately redraw $600k at same timestamp
        _draw(p, "1b_r2", 600_000, 5);

        // I2 must hold: outstanding + avail + collected == principal
        _assertI2(p, "1B");
        assertEq(p.outstanding(), 600_000 * SCALE, "1B: outstanding wrong after redraw");
        // exempt was set by repay then consumed by draw (600k-600k=0)
        assertEq(p.idleExemptAmount(), 0, "1B: exemptAmount should be zero after full-consume draw");
    }

    // ── Area 2: Exemption boundary and same-day churn stacking ───────────────

    /// @dev 2A: Repay at exactly UTC midnight; exemption covers the repay calendar day.
    function test_2A_repayAtMidnight_exemptionCoversRepayDay() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start    = p.poolStartTs();
        uint256 startDay = start / D;   // dayOf(poolStartTs)

        // Draw $300k at day 1 at 06:00
        vm.warp(start + D + 6 * 3600);
        _draw(p, "2a_r1", 300_000, 3);

        // Repay at exactly midnight of day 2
        uint256 midnight_d2 = (startDay + 2) * D;
        vm.warp(midnight_d2);
        _repay(p, "2a_r1");

        // Exemption must cover "day 2" (dayOf(midnight_d2) = startDay+2)
        assertEq(p.idleExemptAmount(), 300_000 * SCALE, "2A: exempt amount wrong after midnight repay");
        // exemptUntil = (startDay+2+1)*D = midnight of day 3
        assertEq(p.idleExemptUntil(), (startDay + 3) * D, "2A: exemptUntil wrong after midnight repay");

        _assertI2(p, "2A");
    }

    /// @dev 2B: Three same-day churn cycles stack exemption additively.
    ///      After draw1 repay draw2 repay draw3:
    ///        outstanding = 100k, exempt = 200k, sum = 300k = peak
    function test_2B_threeSameDayChurnsStackExemption() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);  // start of tenure day 1

        // Cycle 1: draw $300k
        _draw(p, "2b_r1", 300_000, 3);
        // Repay $300k at 03:00
        vm.warp(start + D + 3 * 3600);
        _repay(p, "2b_r1");

        // Cycle 2: draw $200k (exempt 300k - 200k = 100k)
        vm.warp(start + D + 3 * 3600);
        _draw(p, "2b_r2", 200_000, 3);
        // Repay $200k at 05:00 (exempt 100k + 200k = 300k)
        vm.warp(start + D + 5 * 3600);
        _repay(p, "2b_r2");

        // Cycle 3: draw $100k (exempt 300k - 100k = 200k, outstanding = 100k)
        vm.warp(start + D + 5 * 3600);
        _draw(p, "2b_r3", 100_000, 3);

        assertEq(p.outstanding(),      100_000 * SCALE, "2B: outstanding wrong");
        assertEq(p.idleExemptAmount(), 200_000 * SCALE, "2B: exempt wrong");
        assertEq(
            p.outstanding() + p.idleExemptAmount(),
            300_000 * SCALE,
            "2B: outstanding + exempt should equal peak draw"
        );
        _assertI2(p, "2B");
    }

    /// @dev 2C: Draw exactly at the exempt-until day (eu_day).
    ///      Expected total idle: 500 (day0 at 1M) + 500 (days1-2 at 500k) + 250 (day3 with exempt) = 1250 SCALE
    function test_2C_drawAtEuDay_correctBilling() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 14, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start    = p.poolStartTs();
        uint256 startDay = start / D;

        // Draw $500k at day 1, 06:00 → bills day 0 at 1M → 500 SCALE
        vm.warp(start + D + 6 * 3600);
        _draw(p, "2c_r1", 500_000, 5);

        // Repay $500k at day 3, 18:00 → bills days 1-2 at 500k → 500 SCALE
        //   exemptUntil = (startDay+3+1)*D = (startDay+4)*D
        vm.warp(start + 3 * D + 18 * 3600);
        _repay(p, "2c_r1");

        // Draw $500k at exactly eu_day = (startDay+4)*D
        //   bills day 3 (with exempt: avail=1M, exempt=500k, base=500k) → 250 SCALE
        uint256 euDayTs = (startDay + 4) * D;
        vm.warp(euDayTs);
        _draw(p, "2c_r2", 500_000, 5);

        (uint256 idleFees, , ) = p.getIdleFeesBreakdown();
        // 500 + 500 + 250 = 1250 SCALE
        assertEq(idleFees, 1250 * SCALE, "2C: idle fees mismatch at eu_day draw");
        _assertI2(p, "2C");
    }

    /// @dev 2D: Midnight repay + immediate redraw on the same calendar day.
    ///
    ///      CORRECT-BY-DESIGN (model_design break in Python suite_adversarial.py).
    ///      When PSP repays advance A and draws advance B on the same UTC day,
    ///      both advances bill that day at the utilized rate independently.
    ///      The repay-day exemption shields A from idle on the shared day;
    ///      B is a new utilized advance, so it owes no idle on its own start day either.
    ///      Billing less would leave outstanding capital with no usage fee.
    ///      Do NOT treat this as a double-billing bug — see DrawDown struct comment in PoolContract.sol.
    function test_2D_midnightRepayRedraw_correctByDesign() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start    = p.poolStartTs();
        uint256 startDay = start / D;

        // Draw $500k at day 1, 06:00
        vm.warp(start + D + 6 * 3600);
        _draw(p, "2d_r1", 500_000, 5);

        // Repay at midnight of day 2 (first second of calendar day 2)
        uint256 midnight_d2 = (startDay + 2) * D;
        vm.warp(midnight_d2);
        _repay(p, "2d_r1");

        // Immediately redraw $500k at the same midnight timestamp
        _draw(p, "2d_r2", 500_000, 5);

        // Both operations land on the same calendar day → correct-by-design.
        // Verify invariants still hold (no broken accounting).
        _assertI2(p, "2D (correct-by-design)");
        assertEq(p.outstanding(), 500_000 * SCALE, "2D: outstanding wrong after midnight redraw");
    }

    // ── Area 3: v2 seams under adversarial timing ─────────────────────────────

    /// @dev 3A: LP deposit below softCap; lazy-finalize at maturity flips Unsuccessful.
    function test_3A_belowSoftCap_lazyFinalize_unsuccessful() public {
        vm.warp(0);
        // softCap = 500k, LP deposits only 100k
        PoolContract p = _createPoolCustomSoftCap(PoolParams({tenure: 7, aprAnnual: 5e16}), 500_000 * SCALE);
        _deposit(p, LP1, 100_000);

        // Warp to exactly fMaturityTs and trigger finalization
        vm.warp(p.fMaturityTs());
        _tryFinalize(p);

        assertEq(
            uint(p.status()),
            uint(PoolContract.Status.Unsuccessful),
            "3A: pool should be Unsuccessful when deposit < softCap"
        );
    }

    /// @dev 3B: LP withdraws at t < fMaturityTs leaving principal < softCap;
    ///      finalization at maturity yields Unsuccessful.
    function test_3B_withdrawBelowSoftCap_finalize_unsuccessful() public {
        vm.warp(0);
        // softCap = 500k; initial deposit 1M (above softCap)
        PoolContract p = _createPoolCustomSoftCap(PoolParams({tenure: 7, aprAnnual: 5e16}), 500_000 * SCALE);
        _deposit(p, LP1, 1_000_000);

        // Withdraw 600k — leaving 400k < softCap 500k — before maturity
        vm.warp(p.fMaturityTs() - 1);
        vm.startPrank(LP1);
        p.withdraw(600_000 * SCALE);
        vm.stopPrank();

        assertEq(p.principal(), 400_000 * SCALE, "3B: principal should be 400k after withdrawal");

        // Finalize at maturity: 400k < softCap → Unsuccessful
        vm.warp(p.fMaturityTs());
        _tryFinalize(p);
        assertEq(
            uint(p.status()),
            uint(PoolContract.Status.Unsuccessful),
            "3B: pool should be Unsuccessful after withdraw drops below softCap"
        );
    }

    /// @dev 3C: Pool fills to hardCap; LP withdraws; re-deposit attempt at exactly
    ///      fMaturityTs triggers lazy-finalize (pool goes Active), then deposit reverts.
    function test_3C_reDepositAtMaturity_poolLocksFirst() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);  // fill to hardCap

        // Withdraw 500k before maturity
        vm.warp(p.fMaturityTs() - 100);
        vm.startPrank(LP1);
        p.withdraw(500_000 * SCALE);
        vm.stopPrank();

        // Re-deposit 500k at exactly fMaturityTs: lazy-finalize fires first (500k >= softCap=100k)
        // → pool goes Active; then deposit() hits "Pool: not funding status" → reverts.
        // Because the whole call reverts, pool is still Funding after the failed call.
        // So we call finalizeFunding() explicitly to observe the lock.
        vm.warp(p.fMaturityTs());
        _tryFinalize(p);
        assertEq(
            uint(p.status()),
            uint(PoolContract.Status.Active),
            "3C: pool should be Active after finalizeFunding at maturity with 500k"
        );

        // Now a deposit should be blocked (pool no longer Funding)
        usdc.mint(LP2, 1 * SCALE);
        vm.startPrank(LP2);
        usdc.approve(address(p), 1 * SCALE);
        vm.expectRevert();
        p.deposit(1 * SCALE);
        vm.stopPrank();
    }

    /// @dev 3D: Finalizing at fMaturityTs + bufferSecs - 1 (within buffer) → Active.
    function test_3D_finalizeAtBufferMinus1_active() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);

        vm.warp(p.fMaturityTs() + BUFFER_SECS - 1);
        _tryFinalize(p);
        assertEq(
            uint(p.status()),
            uint(PoolContract.Status.Active),
            "3D: pool should be Active when finalized within buffer"
        );
    }

    /// @dev 3E: Finalizing at fMaturityTs + bufferSecs + 1 (past buffer) → Unsuccessful.
    function test_3E_finalizeAtBufferPlus1_unsuccessful() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);

        vm.warp(p.fMaturityTs() + BUFFER_SECS + 1);
        _tryFinalize(p);
        assertEq(
            uint(p.status()),
            uint(PoolContract.Status.Unsuccessful),
            "3E: pool should be Unsuccessful when finalized past buffer"
        );
    }

    // ── Area 4: Cross-finality draws ─────────────────────────────────────────

    /// @dev 4A: A drawdown whose expiry falls on the finality calendar day (but not past it) is accepted.
    function test_4A_drawExpiryOnFinalityDay_accepted() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start      = p.poolStartTs();
        uint256 finalityTs = p.poolFinalityTs();

        // Draw at start+D with settlement=5; expiry = start+D+5D = start+6D
        // finalityTs = fMaturityTs + 7D. start+6D < fMaturityTs+7D = finalityTs ✓
        vm.warp(start + D);
        vm.prank(AGENT2); p.executeDrawdown("4a_r1", PSP, 300_000 * SCALE, 5);

        assertGt(p.outstanding(), 0, "4A: draw should have succeeded");
        // expiry must be < finalityTs
        (uint256 prin, , uint256 expiry) = _getDrawDown(p, "4a_r1");
        assertGt(prin, 0,           "4A: drawdown principal zero");
        assertLt(expiry, finalityTs, "4A: expiry should be before finalityTs");
    }

    /// @dev 4B: An unrepaid draw outstanding at finality forces the pool into Default
    ///      (principal < total after _mature moves availableToDd but NOT outstanding).
    function test_4B_drawUnrepaidAtFinality_default() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        _draw(p, "4b_r1", 600_000, 5);

        // Warp past finality; leave draw unrepaid
        vm.warp(p.poolFinalityTs() + D);

        // Trigger mature via claimYield; pool should not auto-close (outstanding > 0)
        vm.prank(LP1); p.claimYield();
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "4B: pool should still be Active before default");

        // AGENT2 declares default
        vm.prank(AGENT2); p.declareDefault();
        assertTrue(
            p.status() == PoolContract.Status.Default || p.status() == PoolContract.Status.Closed,
            "4B: pool should be Default or Closed after declareDefault"
        );
    }

    /// @dev 4C_before: Repay at poolFinalityTs - 1 → pre-finality path (exemption set, availableToDd grows).
    function test_4C_before_preFinality_setsExemption() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        _draw(p, "4c_r1", 500_000, 5);

        uint256 availBefore = p.availableToDd();
        uint256 finalityTs  = p.poolFinalityTs();

        // Repay exactly 1 second before finality
        vm.warp(finalityTs - 1);
        _repay(p, "4c_r1");

        // Pre-finality path: availableToDd += amount, exemption set
        assertGt(p.availableToDd(), availBefore,      "4C_before: availableToDd should increase on pre-finality repay");
        assertGt(p.idleExemptAmount(), 0,              "4C_before: exemptAmount should be set on pre-finality repay");
        assertGt(p.idleExemptUntil(),  0,              "4C_before: exemptUntil should be set on pre-finality repay");
        _assertI2(p, "4C_before");
    }

    /// @dev 4C_after: Repay at poolFinalityTs → post-finality path (collectedPrincipal grows).
    function test_4C_after_postFinality_collectedPrincipal() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        _draw(p, "4c2_r1", 500_000, 5);

        uint256 collBefore  = p.collectedPrincipal();
        uint256 finalityTs  = p.poolFinalityTs();

        // Repay at exactly poolFinalityTs → block.timestamp < poolFinalityTs is FALSE
        vm.warp(finalityTs);
        _repay(p, "4c2_r1");

        // Post-finality path: collectedPrincipal += amount
        assertGt(p.collectedPrincipal(), collBefore, "4C_after: collectedPrincipal should grow on post-finality repay");
        assertEq(p.idleExemptAmount(),   0,          "4C_after: no exemption on post-finality repay");
        _assertI2(p, "4C_after");
    }

    /// @dev 4D-accept: Max-tenor draw (settlement=7) on day 1 lands exactly on finality day → accepted.
    function test_4D_drawExpiryOnFinalityDay_accepted() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        // settlement=7 (max): expiryTs = start+D+(7-1)*D = start+7D.
        // dayOf(start+7D) == dayOf(poolFinalityTs) → accepted (≤ guard).
        uint256 beforeOut = p.outstanding();
        _draw(p, "4d_accept", 100_000, 7);
        assertGt(p.outstanding(), beforeOut, "4D-accept: draw on finality day must be accepted");
    }

    /// @dev 4D: Draw whose expiry falls past poolFinalityTs is rejected.
    function test_4D_drawExpiryPastFinalityDay_rejected() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + 2 * D);
        // settlement=7 (max) drawn on day 2: expiryTs = start+2D+(7-1)*D = start+8D.
        // dayOf(start+8D) > dayOf(poolFinalityTs≈start+7D) → rejected.
        vm.prank(AGENT2);
        vm.expectRevert("Pool: expiry past maturity");
        p.executeDrawdown("4d_r1", PSP, 300_000 * SCALE, 7);
    }

    // ── Area 5: Stuck-state and double-claim hunting ──────────────────────────

    /// @dev 5A: Second claimYield on the same pool is a no-op (claimable==0, early return).
    function test_5A_doubleClaimYield_noOp() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        _draw(p, "5a_r1", 500_000, 5);

        // Let pool mature naturally
        vm.warp(p.poolFinalityTs() + D);
        _repay(p, "5a_r1");   // triggers mature + _checkFinality via _mature
        _payIdle(p);

        // First claimYield
        vm.prank(LP1); p.claimYield();
        uint256 poolClaimed1 = p.claimedYield();

        // Second claimYield — must succeed without reverting and not increment pool-level claimedYield
        vm.prank(LP1); p.claimYield();
        uint256 poolClaimed2 = p.claimedYield();

        assertEq(poolClaimed1, poolClaimed2, "5A: second claimYield should not increase claimedYield");
    }

    /// @dev 5B: Second claimPrincipal is a no-op.
    function test_5B_doubleClaimPrincipal_noOp() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        _draw(p, "5b_r1", 500_000, 5);

        vm.warp(p.poolFinalityTs() + D);
        _repay(p, "5b_r1");
        _payIdle(p);

        // First claimPrincipal
        vm.prank(LP1); p.claimPrincipal();
        uint256 poolPrinClaimed1 = p.claimedPrincipal();

        // Second claimPrincipal — must not revert and not change pool-level claimedPrincipal further
        vm.prank(LP1); p.claimPrincipal();
        uint256 poolPrinClaimed2 = p.claimedPrincipal();

        assertEq(poolPrinClaimed1, poolPrinClaimed2, "5B: second claimPrincipal should not change claimedPrincipal");
    }

    /// @dev 5C: Pool stuck Active (unpaid idle fees prevent _checkFinality closure);
    ///      declareDefault() escapes the stuck state.
    function test_5C_stuckActive_declareDefaultEscapes() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        // Warp past finality without paying idle fees or repaying draws
        vm.warp(p.poolFinalityTs() + D);

        // Trigger _mature (via claimYield); pool stays Active because accIdleFees > 0
        vm.prank(LP1); p.claimYield();

        // Idle fees were accrued during the tenure → accIdleFees > 0 → stuck
        (uint256 idleFees, , ) = p.getIdleFeesBreakdown();
        // pool should still be Active (finality check fails due to idle fees)
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "5C: pool should still be Active before declareDefault");
        assertGt(idleFees, 0, "5C: idle fees should be nonzero (causing stuck)");

        // AGENT2 calls declareDefault to escape
        vm.prank(AGENT2); p.declareDefault();
        assertNotEq(
            uint(p.status()),
            uint(PoolContract.Status.Active),
            "5C: pool should have escaped Active after declareDefault"
        );
    }

    /// @dev 5D: claimYield mid-tenure does not violate I5 (dollar-seconds conservation).
    function test_5D_earlyClaimYield_I5Holds() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 14, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        _draw(p, "5d_r1", 400_000, 5);

        // claimYield at mid-tenure (day 3 of 14)
        vm.warp(start + 3 * D);
        vm.prank(LP1); p.claimYield();

        // I5: pool.dollarSeconds == pool.fundingCredit + pool.principal * pool.span
        // (This holds from lock-time and is never mutated by claimYield.)
        assertEq(
            p.dollarSeconds(),
            p.fundingCredit() + p.principal() * p.span(),
            "5D: I5 violated after mid-tenure claimYield"
        );
    }

    /// @dev 5E: I2 partition identity holds through every step of a draw/repay cycle.
    function test_5E_I2PartitionThroughDrawRepay() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 14, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        // After lock: outstanding=0, avail=principal, collected=0
        _assertI2(p, "5E post-lock");

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        _draw(p, "5e_r1", 600_000, 5);
        _assertI2(p, "5E post-draw1");

        vm.warp(start + 2 * D);
        _draw(p, "5e_r2", 200_000, 5);
        _assertI2(p, "5E post-draw2");

        vm.warp(start + 5 * D);
        _repay(p, "5e_r1");
        _assertI2(p, "5E post-repay1");

        vm.warp(start + 7 * D);
        _repay(p, "5e_r2");
        _assertI2(p, "5E post-repay2");
    }

    /// @dev 5F: A draw that exactly consumes idleExemptAmount clears IDLE2 (amount==0 → until==0).
    function test_5F_drawExactlyConsumingExemption_IDLE2cleared() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 14, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        _draw(p, "5f_r1", 100_000, 3);

        // Repay sets exempt=100k
        vm.warp(start + D + 6 * 3600);
        _repay(p, "5f_r1");
        assertEq(p.idleExemptAmount(), 100_000 * SCALE, "5F: exempt should be 100k after repay");

        // Draw exactly 100k — exempt_amount - 100k = 0 → exemptUntil must also clear
        _draw(p, "5f_r2", 100_000, 3);

        assertEq(p.idleExemptAmount(), 0, "5F: exemptAmount should be 0 after exact-consume draw");
        assertEq(p.idleExemptUntil(),  0, "5F: exemptUntil should be 0 after exact-consume draw (IDLE2)");
    }

    /// @dev 5G: Post-finality repay routes to collectedPrincipal and accrues overrun yield.
    function test_5G_overrunYieldViaPostFinalityRepay() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        _draw(p, "5g_r1", 500_000, 5);

        // Warp 2 days past finality → overrun accrues
        vm.warp(p.poolFinalityTs() + 2 * D);
        _repay(p, "5g_r1");

        // Post-finality repay: collectedPrincipal should include the repaid amount
        // (drawdown principal routed through post-finality path)
        assertGe(p.collectedPrincipal(), 500_000 * SCALE, "5G: collectedPrincipal should include post-finality repay");
        // overrunYield should be nonzero (utilized extension billing)
        assertGt(p.overrunYield(), 0, "5G: overrun yield should be nonzero after post-finality repay");
    }

    /// @dev 5H: Repay at exactly poolFinalityTs takes the post-finality branch.
    ///      block.timestamp < poolFinalityTs is FALSE at equality → collectedPrincipal grows.
    function test_5H_repayAtExactlyFinality_postFinalityPath() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        uint256 start = p.poolStartTs();
        vm.warp(start + D);
        _draw(p, "5h_r1", 500_000, 5);

        uint256 finalityTs   = p.poolFinalityTs();
        uint256 collBefore   = p.collectedPrincipal();

        // Repay at exactly finalityTs
        vm.warp(finalityTs);
        _repay(p, "5h_r1");

        // Must take the post-finality path (block.timestamp == poolFinalityTs → NOT < finalityTs)
        assertGt(p.collectedPrincipal(), collBefore, "5H: collectedPrincipal should increase at exact finality repay");
        assertEq(p.idleExemptAmount(),   0,          "5H: no exemption set on post-finality repay");
    }

    // ── Internal: read a drawdown by ref ─────────────────────────────────────

    function _getDrawDown(PoolContract p, bytes32 ref)
        internal view
        returns (uint256 principal, uint256 startTs, uint256 expiryTs)
    {
        (principal, startTs, expiryTs,) = p.drawDowns(ref);
    }
}
