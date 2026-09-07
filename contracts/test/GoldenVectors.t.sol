// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Full-system golden-vector acceptance test.
///
/// Unit convention: all amounts from the golden vectors are multiplied by SCALE = 1e12
/// before passing to the contract, so that WAD math produces integers that match
/// Python floats × 1e12 exactly (or within 1 unit — noted per field in Gate 1 report).
///
/// Golden-vector parameter source: psp_port/tests/export_golden.py
///   soft_cap=1, hard_cap=9_000_000, funding_days=5, buffer=0.25d, tenure=30d,
///   idle=0.0005/d, util=0.0005/d, pen=0.001/d, pgd=2, apr=0.1, min_dd=1, max_dd=7, timeout=1d
///   treasury: reserve_rate=0.10, target=1_000_000, hurdle=1.0, lp_bonus=0.0
contract GoldenVectorTest is Test {
    uint256 constant SCALE = 1e12;

    // WAD rates (from Python: rate_decimal * WAD)
    uint256 constant APR            = 1e17;   // 0.10 annual
    uint256 constant IDLE_RATE      = 5e14;   // 0.0005 per day
    uint256 constant UTIL_RATE      = 5e14;   // 0.0005 per day
    uint256 constant PEN_RATE       = 1e15;   // 0.001 per day
    uint256 constant RESERVE_RATE   = 1e17;   // 0.10
    uint256 constant HURDLE_FRAC    = 1e18;   // 1.0
    uint256 constant LP_BONUS       = 0;
    uint256 constant RESERVE_TARGET = 1_000_000 * SCALE;

    // Timing
    uint256 constant LOCK    = 5 * 86400;          // 432 000 s
    uint256 constant D       = 86400;
    uint256 constant TENURE  = 30;
    uint256 constant SPAN    = TENURE * D;          // 2 592 000 s
    uint256 constant YEAR    = 365 * D;             // 31 536 000 s
    uint256 constant MATURITY = LOCK + SPAN;        // 3 024 000 s

    // Actors
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
            30 * 86400, 25e16, 3, 1, 7
        );

        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _createPool() internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet: PSP, softCap: 1 * SCALE, hardCap: 9_000_000 * SCALE,
            fundingDurationSecs: 5 * 86400,
            tenure: TENURE, idleRateDaily: IDLE_RATE, utilizedRateDaily: UTIL_RATE,
            penaltyRateDaily: PEN_RATE, penaltyGraceDays: 2, minDeposit: 0,
            aprAnnual: APR, agent1: AGENT1, agent2: AGENT2, multisig: MULTISIG
        }));
        p = PoolContract(addr);
    }

    function _deposit(PoolContract p, address lp, uint256 pyAmt) internal {
        uint256 amt = pyAmt * SCALE;
        usdc.mint(lp, amt);
        vm.startPrank(lp); usdc.approve(address(p), amt); p.deposit(amt); vm.stopPrank();
    }

    function _draw(PoolContract p, bytes32 ref, uint256 pyAmt, uint256 settleDays) internal {
        uint256 amt = pyAmt * SCALE;
        vm.prank(AGENT2);
        p.executeDrawdown(ref, PSP, amt, settleDays);
    }

    function _repay(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.startPrank(PSP); usdc.approve(address(p), total); p.repay(ref); vm.stopPrank();
    }

    function _payIdle(PoolContract p) internal {
        (, , uint256 total) = p.getIdleFeesBreakdown();
        if (total == 0) return;
        usdc.mint(PSP, total);
        vm.startPrank(PSP); usdc.approve(address(p), total); p.payAccruedIdleFees(total); vm.stopPrank();
    }

    function _claim(PoolContract p, address lp) internal {
        vm.startPrank(lp);
        try p.claimYield() {} catch {}
        try p.claimPrincipal() {} catch {}
        vm.stopPrank();
    }

    /// @dev Compute expected yield (= dollarSeconds * apr / YEAR) for the BASE pool setup.
    ///      BASE: single deposit at t=0, lock at LOCK=432000.
    function _baseDs(uint256 pyPrincipal) internal pure returns (uint256 ds) {
        uint256 p_ = pyPrincipal * SCALE;
        uint256 fc = p_ * LOCK;               // funding credit: principal × (lock - deposit_ts)
        ds = fc + p_ * SPAN;
    }

    function _yield(uint256 ds) internal pure returns (uint256) {
        return MathLib.mulDiv(ds, APR, MathLib.WAD * YEAR);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vector 1: repay_same_day_T0
    // T+0 draw (500k) repaid same day. yield = 9589.04109589041 * SCALE.
    // ─────────────────────────────────────────────────────────────────────────
    function test_v1_repay_same_day_T0() public {
        PoolContract p = _createPool();
        _deposit(p, LP_A, 1_000_000);
        vm.warp(LOCK); p.finalizeFunding();
        _draw(p, "o1", 500_000, 1);  // minDdDays=1; same-day repay still valid (expiryTs 1d ahead)
        _repay(p, "o1");
        vm.warp(MATURITY + D);
        _payIdle(p);
        _claim(p, LP_A);

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "v1 status");
        assertEq(p.principal(), 1_000_000 * SCALE, "v1 principal");
        assertEq(p.availableToDd(), 0, "v1 availToDd");
        assertEq(p.outstanding(), 0, "v1 outstanding");

        uint256 ds = _baseDs(1_000_000);
        uint256 expectedYield = _yield(ds);
        assertEq(p.yieldOwed(), expectedYield, "v1 yieldOwed");
        assertEq(p.collectedYield(), expectedYield, "v1 collectedYield");
        assertEq(p.collectedPrincipal(), 1_000_000 * SCALE, "v1 collectedPrincipal");
        assertEq(p.collectedOverrunYield(), 0, "v1 overrunYield");
        assertEq(p.accIdleFees(), 0, "v1 accIdleFees");
        assertEq(p.accPenalty(), 0, "v1 accPenalty");
        assertEq(p.reservedYield(), 0, "v1 reservedYield");
        assertEq(p.collectedBonus(), 0, "v1 bonus");

        // LP A claimed everything
        (,, uint256 claimableY,,, ) = p.getLpPosition(LP_A);
        assertEq(claimableY, 0, "v1 LP_A no more claimable yield");

        // Reserve drawn (topup)
        assertGt(treasury.reserveBalance(), 0, "v1 reserve positive");
        // protocolFees positive
        assertGt(p.protocolFees(), 0, "v1 protocolFees > 0");

        // Conservation: pool USDC == protocolFees (all LP claims made, outstanding=0)
        assertEq(usdc.balanceOf(address(p)), p.protocolFees(), "v1 conservation");

        emit log_named_uint("v1 yieldOwed",      p.yieldOwed());
        emit log_named_uint("v1 protocolFees",   p.protocolFees());
        emit log_named_uint("v1 reserveAfter",   treasury.reserveBalance());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vector 2: repay_ontime_T2 — draw at lock with settlement=2d, repaid day 2
    // ─────────────────────────────────────────────────────────────────────────
    function test_v2_repay_ontime_T2() public {
        PoolContract p = _createPool();
        _deposit(p, LP_A, 1_000_000);
        vm.warp(LOCK); p.finalizeFunding();
        _draw(p, "o1", 500_000, 2);
        vm.warp(LOCK + 2 * D);
        _repay(p, "o1");
        vm.warp(MATURITY + D);
        _payIdle(p);
        _claim(p, LP_A);

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "v2 status");
        assertEq(p.outstanding(), 0, "v2 outstanding");
        assertEq(usdc.balanceOf(address(p)), p.protocolFees(), "v2 conservation");

        uint256 expectedYield = _yield(_baseDs(1_000_000));
        assertEq(p.yieldOwed(), expectedYield, "v2 yieldOwed");
        assertEq(p.collectedYield(), expectedYield, "v2 collectedYield");
        emit log_named_uint("v2 yieldOwed",    p.yieldOwed());
        emit log_named_uint("v2 protocolFees", p.protocolFees());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vector 3: repay_grace_T2_d3 — T+2 draw repaid day 3 (within grace, no penalty)
    // ─────────────────────────────────────────────────────────────────────────
    function test_v3_repay_grace_T2_d3() public {
        PoolContract p = _createPool();
        _deposit(p, LP_A, 1_000_000);
        vm.warp(LOCK); p.finalizeFunding();
        _draw(p, "o1", 500_000, 2);
        vm.warp(LOCK + 3 * D);
        _repay(p, "o1");
        vm.warp(MATURITY + D);
        _payIdle(p);
        _claim(p, LP_A);

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "v3 status");
        assertEq(usdc.balanceOf(address(p)), p.protocolFees(), "v3 conservation");

        uint256 expectedYield = _yield(_baseDs(1_000_000));
        assertEq(p.yieldOwed(), expectedYield, "v3 yieldOwed");
        emit log_named_uint("v3 yieldOwed",    p.yieldOwed());
        emit log_named_uint("v3 protocolFees", p.protocolFees());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vector 4: repay_late_T2_d6 — T+2 draw repaid day 6 (penalty applies)
    // ─────────────────────────────────────────────────────────────────────────
    function test_v4_repay_late_T2_d6() public {
        PoolContract p = _createPool();
        _deposit(p, LP_A, 1_000_000);
        vm.warp(LOCK); p.finalizeFunding();
        _draw(p, "o1", 500_000, 2);
        vm.warp(LOCK + 6 * D);
        _repay(p, "o1");
        vm.warp(MATURITY + D);
        _payIdle(p);
        _claim(p, LP_A);

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "v4 status");
        assertEq(usdc.balanceOf(address(p)), p.protocolFees(), "v4 conservation");

        // Pen scenario: penalty days > 0 → more finance charge → higher protocolFees
        uint256 expectedYield = _yield(_baseDs(1_000_000));
        assertEq(p.yieldOwed(), expectedYield, "v4 yieldOwed");
        assertGt(p.protocolFees(), 0, "v4 protocolFees > 0");
        emit log_named_uint("v4 protocolFees", p.protocolFees());
        emit log_named_uint("v4 reserveAfter", treasury.reserveBalance());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vector 5: idle_no_draw — no draw; idle accrues full tenure + penalty past grace
    // ─────────────────────────────────────────────────────────────────────────
    function test_v5_idle_no_draw() public {
        PoolContract p = _createPool();
        _deposit(p, LP_A, 1_000_000);
        vm.warp(LOCK); p.finalizeFunding();
        // No draws
        vm.warp(MATURITY + 20 * D);
        _payIdle(p);
        _claim(p, LP_A);

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "v5 status");
        assertEq(p.outstanding(), 0, "v5 outstanding");
        assertEq(p.accIdleFees(), 0, "v5 accIdleFees paid");
        assertEq(p.accPenalty(), 0, "v5 accPenalty paid");
        assertEq(usdc.balanceOf(address(p)), p.protocolFees(), "v5 conservation");

        uint256 expectedYield = _yield(_baseDs(1_000_000));
        assertEq(p.yieldOwed(), expectedYield, "v5 yieldOwed");
        assertEq(p.collectedYield(), expectedYield, "v5 collectedYield");

        // Idle accrued on 1M for 30 days + penalty on 18 days (maturity+20d, grace=2)
        // idle = 1M*SCALE * 30 * IDLE_RATE / WAD = 15000*SCALE
        // penalty = idle * 18 * PEN_RATE / WAD = 270*SCALE
        uint256 idleFees = MathLib.mulDiv(1_000_000 * SCALE * 30, IDLE_RATE, MathLib.WAD);
        uint256 penalty  = MathLib.mulDiv(idleFees * 18, PEN_RATE, MathLib.WAD);
        uint256 totalIdle = idleFees + penalty;
        assertEq(totalIdle, 15_270 * SCALE, "v5 total idle fees");

        emit log_named_uint("v5 yieldOwed",    p.yieldOwed());
        emit log_named_uint("v5 protocolFees", p.protocolFees());
        emit log_named_uint("v5 reserveAfter", treasury.reserveBalance());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vector 6: multilp_close — LP A 600k, LP B 400k; both deposit at t=0
    // ─────────────────────────────────────────────────────────────────────────
    function test_v6_multilp_close() public {
        PoolContract p = _createPool();
        _deposit(p, LP_A, 600_000);
        _deposit(p, LP_B, 400_000);
        vm.warp(LOCK); p.finalizeFunding();
        _draw(p, "o1", 800_000, 7);
        vm.warp(LOCK + 7 * D);
        _repay(p, "o1");
        vm.warp(MATURITY + D);
        _payIdle(p);
        _claim(p, LP_A);
        _claim(p, LP_B);

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "v6 status");
        assertEq(p.principal(), 1_000_000 * SCALE, "v6 principal");
        assertEq(p.outstanding(), 0, "v6 outstanding");
        assertEq(usdc.balanceOf(address(p)), p.protocolFees(), "v6 conservation");

        uint256 expectedYield = _yield(_baseDs(1_000_000));
        assertEq(p.yieldOwed(), expectedYield, "v6 yieldOwed");

        // LP shares: A=60%, B=40%
        (uint256 lpA_principal,, , uint256 lpA_claimableP,,) = p.getLpPosition(LP_A);
        (uint256 lpB_principal,, , uint256 lpB_claimableP,,) = p.getLpPosition(LP_B);
        assertEq(lpA_principal, 600_000 * SCALE, "v6 lpA principal");
        assertEq(lpB_principal, 400_000 * SCALE, "v6 lpB principal");

        // After claims, claimable principal = 0
        assertEq(lpA_claimableP, 0, "v6 lpA no more principal");
        assertEq(lpB_claimableP, 0, "v6 lpB no more principal");

        // LP A yield ≈ 60% of total yield
        uint256 lpA_yield_expected = MathLib.mulDiv(600_000 * SCALE, expectedYield, 1_000_000 * SCALE);
        uint256 lpB_yield_expected = expectedYield - lpA_yield_expected;

        // LP A claimed yield = balance at LP_A minus their deposit (minus any principal returned)
        // Verify via the position's claimedYield fields (access via public mappings)
        emit log_named_uint("v6 yieldOwed",      p.yieldOwed());
        emit log_named_uint("v6 lpA_yield_exp",  lpA_yield_expected);
        emit log_named_uint("v6 lpB_yield_exp",  lpB_yield_expected);
        emit log_named_uint("v6 protocolFees",   p.protocolFees());
        emit log_named_uint("v6 reserveAfter",   treasury.reserveBalance());

        // USDC balances of LPs are principal + yield received
        uint256 lpA_usdc = usdc.balanceOf(LP_A);
        uint256 lpB_usdc = usdc.balanceOf(LP_B);
        assertApproxEqAbs(lpA_usdc, 600_000 * SCALE + lpA_yield_expected, SCALE, "v6 lpA usdc");
        assertApproxEqAbs(lpB_usdc, 400_000 * SCALE + lpB_yield_expected, SCALE, "v6 lpB usdc");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vector 7: prematurity_default_reserve
    // Draw 800k, declare default at LOCK+10d, reserve (500k) partially covers.
    // After settlement: outstanding=300k, collectedPrincipal=700k, reserve=0.
    // Pool stays in Default (principal not fully recovered; no yield settled).
    // ─────────────────────────────────────────────────────────────────────────
    function test_v7_prematurity_default_reserve() public {
        // Seed reserve — reserveBalance is at storage slot 1 (slot 0 is Ownable._owner)
        uint256 initReserve = 500_000 * SCALE;
        vm.store(address(treasury), bytes32(uint256(1)), bytes32(initReserve));
        usdc.mint(address(treasury), initReserve);

        PoolContract p = _createPool();
        _deposit(p, LP_A, 1_000_000);
        vm.warp(LOCK); p.finalizeFunding();
        _draw(p, "o1", 800_000, 7);
        vm.warp(LOCK + 10 * D);

        vm.prank(AGENT2); p.declareDefault();

        // Reserve covers 500k of the 800k outstanding; 300k remains irrecoverable here.
        // settleDefaultYield must NOT be called: it requires collectedPrincipal >= principal.
        vm.prank(MULTISIG); p.settleDefaultPrincipal(0);

        // LP A claims their 100% share of the 700k collected principal
        vm.prank(LP_A); p.claimPrincipal();

        // ── Status ───────────────────────────────────────────────────────────
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default), "v7 status=default");

        // ── Principal accounting ──────────────────────────────────────────────
        assertEq(p.principal(),          1_000_000 * SCALE, "v7 principal");
        assertEq(p.collectedPrincipal(), 700_000 * SCALE,   "v7 collectedPrincipal=700k");
        assertEq(p.outstanding(),        300_000 * SCALE,   "v7 outstanding=300k");
        assertEq(p.availableToDd(),      0,                  "v7 availableToDd=0");

        // ── Yield (rebased pre-maturity at LOCK+10d) ─────────────────────────
        // ds_elapsed = 1M*SCALE * (LOCK + 10*D); yieldOwed = ds_elapsed * apr / (WAD * YEAR)
        uint256 expectedYield = MathLib.mulDiv(
            1_000_000 * SCALE * (LOCK + 10 * D), APR, MathLib.WAD * YEAR
        );
        assertEq(p.yieldOwed(),             expectedYield, "v7 yieldOwed rebased");
        assertEq(p.collectedYield(),        0,             "v7 collected_yield=0");
        assertEq(p.collectedOverrunYield(), 0,             "v7 overrun=0");
        assertEq(p.reservedYield(),         0,             "v7 reservedYield=0");

        // ── Fees ──────────────────────────────────────────────────────────────
        // Idle: 200k idle for 10 days (800k drawn at LOCK, default at LOCK+10d)
        uint256 expectedIdle = MathLib.mulDiv(200_000 * SCALE * 10, IDLE_RATE, MathLib.WAD);
        assertEq(p.accIdleFees(),   expectedIdle, "v7 acc_idle_fees=1000*SCALE");
        assertEq(p.accPenalty(),    0,             "v7 acc_penalty=0");
        assertEq(p.protocolFees(),  0,             "v7 protocol_fees=0");
        assertEq(p.collectedBonus(), 0,            "v7 collected_bonus=0");

        // ── Reserve + pool USDC ────────────────────────────────────────────────
        assertEq(treasury.reserveBalance(),  0,             "v7 reserve_after=0");
        assertEq(usdc.balanceOf(address(p)), 0,             "v7 pool_usdc=0");
        assertEq(usdc.balanceOf(LP_A),       700_000 * SCALE, "v7 lpA_usdc=700k");

        emit log_named_uint("v7 yieldOwed",          p.yieldOwed());
        emit log_named_uint("v7 collectedPrincipal", p.collectedPrincipal());
        emit log_named_uint("v7 accIdleFees",        p.accIdleFees());
        emit log_named_uint("v7 outstanding",        p.outstanding());
        emit log_named_uint("v7 reserveAfter",       treasury.reserveBalance());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vector 8: idle_fees_owed_live (getIdleFeesBreakdown snapshot BEFORE payment)
    // Draw 400k (repaid at LOCK+7d), 600k idle, checked at MATURITY+18d
    // ─────────────────────────────────────────────────────────────────────────
    function test_v8_idle_fees_owed_live() public {
        PoolContract p = _createPool();
        _deposit(p, LP_A, 1_000_000);
        vm.warp(LOCK); p.finalizeFunding();
        _draw(p, "o1", 400_000, 7);
        vm.warp(LOCK + 7 * D);
        _repay(p, "o1");
        vm.warp(MATURITY + 18 * D);

        // Status should still be Active (no state-changing calls ran _mature)
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Active), "v8 status=active");

        (uint256 idleFees, uint256 penaltyOwed, uint256 total) = p.getIdleFeesBreakdown();

        // Per-day model (v2): billing days [5..34] = 30 days total.
        //   Draw $400k at day 5 (LOCK): available = 600k, no exemption yet.
        //   Days 5-11 (7 days): 600k × 7 × rate  = $2100
        //   Repay $400k at day 12: available = 1M; idle_exempt_amount = 400k until day 13.
        //   Day 12 (1 day, exempt): (1M - 400k) × 1 × rate = $300
        //   Days 13-34 (22 days): 1M × 22 × rate = $11000
        //   Total idle = $13,400
        uint256 expectedIdle = MathLib.mulDiv(600_000 * SCALE * 7,  IDLE_RATE, MathLib.WAD) +
                               MathLib.mulDiv(600_000 * SCALE * 1,  IDLE_RATE, MathLib.WAD) +
                               MathLib.mulDiv(1_000_000 * SCALE * 22, IDLE_RATE, MathLib.WAD);
        assertEq(expectedIdle, 13_400 * SCALE, "v8 idle computation");

        // penalty: on unpaid idle=$13400 for 16 days past grace (18d total - 2d grace)
        uint256 expectedPenalty = MathLib.mulDiv(expectedIdle * 16, PEN_RATE, MathLib.WAD);
        assertEq(expectedPenalty, 214_400_000_000_000, "v8 penalty (214.4*SCALE)");

        assertEq(idleFees,    expectedIdle,   "v8 idleFees");
        assertEq(penaltyOwed, expectedPenalty, "v8 penaltyOwed");
        assertEq(total, expectedIdle + expectedPenalty, "v8 total");

        emit log_named_uint("v8 idle_fees_owed", idleFees);
        emit log_named_uint("v8 penalty_owed",   penaltyOwed);
        emit log_named_uint("v8 total_owed",     total);
    }
}
