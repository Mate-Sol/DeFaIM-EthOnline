// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Phase-1 acceptance test suite:
///      - Part A: 6 unit idle scenarios against payfi_v2.py oracle
///      - Part D: 4 named v2-specific scenarios
///      - Snap test: poolFinalityTs % SPD == 0 and IDLE6 invariance to finalize latency
///      - View==state gate: getIdleFeesBreakdown / getIdleFeesBreakdown equal _accrueIdleFees output
///
/// Scale convention: SCALE = 1e12 (1 USDC = 1e12 base units, matching GoldenVectors.t.sol)
/// Reference oracle: pseudocode new/payfi_v2.py
/// Scenario source:  pseudocode new/suite_scenarios.py
contract V2ScenarioTests is Test {

    // ── constants ────────────────────────────────────────────────────────────

    uint256 constant SCALE      = 1e12;
    uint256 constant D          = 86400;       // seconds per day (SPD in Python)
    uint256 constant WAD        = 1e18;
    uint256 constant YEAR       = 365 * D;     // 31 536 000 s

    // Part-A pool: 30-day tenure, idle=util=5bps, pen=10bps, pgd=0, apr=10%
    uint256 constant IDLE_A     = 5e14;        // 0.05% / day  (= 5 bps)
    uint256 constant UTIL_A     = 5e14;        // same — idle == util is allowed
    uint256 constant PEN_A      = 1e15;        // 0.10% / day  (= 10 bps)
    uint256 constant APR_A      = 1e17;        // 10% annual
    uint256 constant TENURE_A   = 30;

    // Part-D pool: 7-day tenure, idle=5bps, util=10bps, pen=20bps, pgd=0, apr=5%
    uint256 constant IDLE_D     = 5e14;        // 5 bps
    uint256 constant UTIL_D     = 1e15;        // 10 bps
    uint256 constant PEN_D      = 2e15;        // 20 bps
    uint256 constant APR_D      = 5e16;        // 5% annual
    uint256 constant TENURE_D   = 7;

    uint256 constant BUFFER_SECS = 21600;      // 0.25 days  (6 h)

    // ── actors ───────────────────────────────────────────────────────────────

    address constant MULTISIG   = address(0x1111);
    address constant DEPLOYER   = address(0x2222);
    address constant AGENT1     = address(0x3333);
    address constant AGENT2     = address(0x4444);
    // One PSP per Part-D scenario avoids the "PSP has live pool" guard.
    address constant PSP_A      = address(0x5555);   // Part A
    address constant PSP_D1     = address(0x5556);   // Part D scenario A
    address constant PSP_D2     = address(0x5557);   // Part D scenario B
    address constant PSP_D3     = address(0x5558);   // Part D scenario C
    address constant PSP_D4     = address(0x5559);   // Part D scenario D
    address constant PSP_SNAP   = address(0x555A);   // snap tests
    address constant PSP_VS     = address(0x555B);   // view==state test
    address constant LP1        = address(0xAA01);
    address constant LP2        = address(0xAA02);

    // ── infrastructure ───────────────────────────────────────────────────────

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
            1e17, 1_000_000 * SCALE, 1e18, 0
        );

        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * 86400, // maxFundingDurationSecs (30 days)
            25e16,   // fundingExecBufferDays (0.25 d, WAD-scaled)
            3,       // maxGracePeriodDays
            1,       // minDdDays
            7       // maxDdDays
        );

        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP_A);
        vm.prank(MULTISIG); factory.approvePsp(PSP_D1);
        vm.prank(MULTISIG); factory.approvePsp(PSP_D2);
        vm.prank(MULTISIG); factory.approvePsp(PSP_D3);
        vm.prank(MULTISIG); factory.approvePsp(PSP_D4);
        vm.prank(MULTISIG); factory.approvePsp(PSP_SNAP);
        vm.prank(MULTISIG); factory.approvePsp(PSP_VS);
    }

    // ── pool-creation helpers ────────────────────────────────────────────────

    function _createPoolA(address psp) internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:        psp,
            fundingDurationSecs: 5 * 86400,
            softCap:          100 * SCALE,
            hardCap:          1_000_000 * SCALE,
            tenure:           TENURE_A,
            idleRateDaily:    IDLE_A,
            utilizedRateDaily: UTIL_A,
            penaltyRateDaily: PEN_A,
            penaltyGraceDays: 0,
            minDeposit:       0,
            aprAnnual:        APR_A,
            agent1:           AGENT1,
            agent2:           AGENT2,
            multisig:         MULTISIG
        }));
        p = PoolContract(addr);
    }

    function _createPoolD(address psp) internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:        psp,
            fundingDurationSecs: 5 * 86400,
            softCap:          100_000 * SCALE,
            hardCap:          1_000_000 * SCALE,
            tenure:           TENURE_D,
            idleRateDaily:    IDLE_D,
            utilizedRateDaily: UTIL_D,
            penaltyRateDaily: PEN_D,
            penaltyGraceDays: 0,
            minDeposit:       0,
            aprAnnual:        APR_D,
            agent1:           AGENT1,
            agent2:           AGENT2,
            multisig:         MULTISIG
        }));
        p = PoolContract(addr);
    }

    // ── deposit / finalize helpers ────────────────────────────────────────────

    function _deposit(PoolContract p, address lp, uint256 pyAmt) internal {
        uint256 amt = pyAmt * SCALE;
        usdc.mint(lp, amt);
        vm.startPrank(lp); usdc.approve(address(p), amt); p.deposit(amt); vm.stopPrank();
    }

    function _finalize(PoolContract p, address agent1) internal {
        vm.prank(agent1); p.finalizeFunding();
    }

    // ── draw / repay helpers ──────────────────────────────────────────────────

    function _draw(PoolContract p, address psp, bytes32 ref, uint256 pyAmt, uint256 settleDays) internal {
        uint256 amt = pyAmt * SCALE;
        vm.prank(AGENT2); p.executeDrawdown(ref, psp, amt, settleDays);
    }

    function _repay(PoolContract p, address psp, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(psp, total);
        vm.startPrank(psp); usdc.approve(address(p), total); p.repay(ref); vm.stopPrank();
    }

    function _payIdle(PoolContract p, address psp) internal {
        (, , uint256 total) = p.getIdleFeesBreakdown();
        if (total == 0) return;
        usdc.mint(psp, total);
        vm.startPrank(psp); usdc.approve(address(p), total); p.payAccruedIdleFees(total); vm.stopPrank();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PART A — 6 per-day idle unit scenarios
    // Expected values hand-derived and verified against payfi_v2.py oracle.
    // Pool: 1M facility, 30-day tenure, fundingDays=5, lock at t=5D (midnight).
    // R = 5 bps/day = 0.0005.  All draws use settlementDays=7 (per Python oracle).
    // ─────────────────────────────────────────────────────────────────────────

    function _freshA() internal returns (PoolContract p) {
        vm.warp(0);
        p = _createPoolA(PSP_A);
        _deposit(p, LP1, 1_000_000);
        vm.warp(5 * D);
        _finalize(p, AGENT1);
        // poolStartTs = 5D, poolFinalityTs = 35D, lastIdleDay = 5
    }

    // 1. Fully idle 30 days: expected = 30 * 1M * 0.0005 = 15 000 USDC
    function test_partA_1_fully_idle() public {
        PoolContract p = _freshA();
        vm.warp(36 * D);    // 35D + D, past finality
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        assertEq(idleFees, 15_000 * SCALE, "A1: fully idle 30d");
    }

    // 2. Fully drawn at lock: idle base = 0 throughout
    function test_partA_2_fully_drawn() public {
        PoolContract p = _freshA();
        // Draw the full 1M at lock time (L = poolStartTs = 5D)
        _draw(p, PSP_A, keccak256("a"), 1_000_000, 7);
        vm.warp(36 * D);
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        assertEq(idleFees, 0, "A2: fully drawn = 0 idle");
    }

    // 3. Draw 500k at d0, repay at d2:
    //    days 0-2 (3d) on 500k base + day 2 exempt + days 3-29 on 1M base (27d)
    //    = (500k×3 + 1M×27) × R = (1.5M + 27M) × 0.0005 = 14 250 USDC
    function test_partA_3_draw500_repay_d2() public {
        PoolContract p = _freshA();
        uint256 L = p.poolStartTs();    // = 5D
        _draw(p, PSP_A, keccak256("a"), 500_000, 7);
        vm.warp(L + 2 * D);
        _repay(p, PSP_A, keccak256("a"));
        vm.warp(L + 30 * D + D);       // past finality
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        assertEq(idleFees, 14_250 * SCALE, "A3: draw500 repay d2");
    }

    // 4. Team D: draw 300k at d0, repay-300k + draw-500k on d5.
    //    Exemption (300k) is consumed by the 500k redraw (500k >= 300k -> cleared).
    //    Days 0-4 on 700k (5d) + days 5-29 on 500k (25d)
    //    = (700k×5 + 500k×25) × R = (3.5M + 12.5M) × 0.0005 = 8 000 USDC
    function test_partA_4_team_D() public {
        PoolContract p = _freshA();
        uint256 L = p.poolStartTs();
        _draw(p, PSP_A, keccak256("i"), 300_000, 7);
        vm.warp(L + 5 * D + 10 * 3600);    // 10 h into day 5
        _repay(p, PSP_A, keccak256("i"));
        vm.warp(L + 5 * D + 14 * 3600);    // 14 h into day 5 (same day)
        _draw(p, PSP_A, keccak256("n"), 500_000, 7);
        vm.warp(L + 30 * D + D);
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        assertEq(idleFees, 8_000 * SCALE, "A4: team D 2D turnaround");
    }

    // 5. Team E: draw 800k at d0, repay-800k + draw-900k on d5.
    //    Exemption (800k) consumed by 900k redraw (900k >= 800k -> cleared).
    //    Days 0-4 on 200k (5d) + days 5-29 on 100k (25d)
    //    = (200k×5 + 100k×25) × R = (1M + 2.5M) × 0.0005 = 1 750 USDC
    function test_partA_5_team_E() public {
        PoolContract p = _freshA();
        uint256 L = p.poolStartTs();
        _draw(p, PSP_A, keccak256("i"), 800_000, 7);
        vm.warp(L + 5 * D + 10 * 3600);
        _repay(p, PSP_A, keccak256("i"));
        vm.warp(L + 5 * D + 14 * 3600);
        _draw(p, PSP_A, keccak256("n"), 900_000, 7);
        vm.warp(L + 30 * D + D);
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        assertEq(idleFees, 1_750 * SCALE, "A5: team E 2D turnaround");
    }

    // 6. Team F: draw 600k at d0, repay-600k + draw-200k on d5.
    //    Exemption 600k partially consumed by 200k redraw: exempt -= 200k -> 400k remaining.
    //    Days 0-4 on 400k (5d) + day 5 exempt: base=800k-400k=400k (1d) + days 6-29 on 800k (24d)
    //    = (400k×5 + 400k×1 + 800k×24) × R = (2M + 400k + 19.2M) × 0.0005 = 10 800 USDC
    function test_partA_6_team_F() public {
        PoolContract p = _freshA();
        uint256 L = p.poolStartTs();
        _draw(p, PSP_A, keccak256("i"), 600_000, 7);
        vm.warp(L + 5 * D + 10 * 3600);
        _repay(p, PSP_A, keccak256("i"));
        vm.warp(L + 5 * D + 14 * 3600);
        _draw(p, PSP_A, keccak256("n"), 200_000, 7);
        vm.warp(L + 30 * D + D);
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        assertEq(idleFees, 10_800 * SCALE, "A6: team F partial exemption");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PART D — 4 named v2 scenarios (hand-derived dollar-seconds + economics)
    // Pool: 1M facility, 7-day tenure, idle=5bps, util=10bps, pen=20bps, pgd=0, apr=5%
    // ─────────────────────────────────────────────────────────────────────────

    // Scenario A: fill-early-wait.
    // LP1 deposits 300k at day 1, LP2 deposits 700k at day 3, finalize at day 5 (zero latency).
    // IDLE6: dayOf(12D) - dayOf(5D) = 7 = tenure.
    // LP1.ds = 285_120_000_000 * SCALE  (300k × 11d = 300k × 950_400s)
    // LP2.ds = 544_320_000_000 * SCALE  (700k × 11d ... wait: 700k × 777_600s)
    // Ratio LP1:LP2 = 11:21.
    // Idle = 1M × 7 × 0.0005 = 3 500 USDC.
    function test_partD_A_fill_early_wait() public {
        vm.warp(0);
        PoolContract p = _createPoolD(PSP_D1);
        assertEq(p.fMaturityTs(), 5 * D, "D-A: fMaturityTs = 5D at t=0");

        vm.warp(1 * D); _deposit(p, LP1, 300_000);
        vm.warp(3 * D); _deposit(p, LP2, 700_000);
        vm.warp(5 * D); _finalize(p, AGENT1);

        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "D-A: Active");
        assertEq(p.poolStartTs(),    5 * D,  "D-A: poolStartTs = 5D");
        assertEq(p.poolFinalityTs(), 12 * D, "D-A: poolFinalityTs = 12D");

        // IDLE6: exact tenure window
        uint256 idle6 = MathLib.dayOf(p.poolFinalityTs()) - MathLib.dayOf(p.poolStartTs());
        assertEq(idle6, 7, "D-A: IDLE6 = tenure");

        // Settle LP dollar-seconds by calling claimYield (triggers _settleLpDollarSeconds)
        vm.warp(13 * D);    // past finality
        vm.prank(LP1); p.claimYield();
        vm.prank(LP2); p.claimYield();

        (, uint256 ds1,,,,) = p.getLpPosition(LP1);
        (, uint256 ds2,,,,) = p.getLpPosition(LP2);
        uint256 dsPool = p.dollarSeconds();

        assertEq(ds1,   285_120_000_000 * SCALE, "D-A: LP1 dollar-seconds");
        assertEq(ds2,   544_320_000_000 * SCALE, "D-A: LP2 dollar-seconds");
        assertEq(dsPool, 829_440_000_000 * SCALE, "D-A: pool dollar-seconds");

        // Ratio 11:21 — check cross-multiplication to avoid rounding
        assertEq(ds1 * 21, ds2 * 11, "D-A: LP1:LP2 ratio = 11:21");

        // Idle = 3 500 USDC
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        assertEq(idleFees, 3_500 * SCALE, "D-A: idle fees = 3500");
    }

    // Scenario B: finalize exactly at the buffer deadline (fMaturityTs + 21600s).
    // poolFinalityTs must equal fMaturityTs + tenure*D = 12D (midnight, NOT shifted by latency).
    // IDLE6 = 7 despite 6-hour finalize latency.
    // LP1.ds = 1_058_400_000_000 * SCALE  (fc = 1M×453600 + tenure contribution)
    // Idle = 3 500 USDC (same as zero-latency).
    function test_partD_B_buffer_edge() public {
        vm.warp(0);
        PoolContract p = _createPoolD(PSP_D2);
        uint256 fMat = p.fMaturityTs();
        assertEq(fMat, 5 * D, "D-B: fMaturityTs = 5D");

        _deposit(p, LP1, 1_000_000);

        // Finalize exactly at the buffer deadline
        vm.warp(fMat + BUFFER_SECS);
        _finalize(p, AGENT1);

        uint256 expectedStart    = 5 * D + BUFFER_SECS;   // 453 600
        uint256 expectedFinality = 12 * D;                 // midnight-anchored to fMaturityTs

        assertEq(uint(p.status()),    uint(PoolContract.Status.Active), "D-B: Active");
        assertEq(p.poolStartTs(),    expectedStart,    "D-B: poolStartTs");
        assertEq(p.poolFinalityTs(), expectedFinality, "D-B: poolFinalityTs = 12D");

        // IDLE6: must equal tenure despite latency
        uint256 idle6 = MathLib.dayOf(p.poolFinalityTs()) - MathLib.dayOf(p.poolStartTs());
        assertEq(idle6, 7, "D-B: IDLE6 invariant to latency");

        // LP1 dollar-seconds
        vm.warp(13 * D);
        vm.prank(LP1); p.claimYield();
        (, uint256 ds1,,,,) = p.getLpPosition(LP1);
        assertEq(ds1, 1_058_400_000_000 * SCALE, "D-B: LP1 dollar-seconds");

        // Idle fees = 3 500 USDC (same as zero-latency — IDLE6 guarantees this)
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        assertEq(idleFees, 3_500 * SCALE, "D-B: idle same as zero-latency");
    }

    // Scenario C: draw outstanding across finality midnight.
    // Finalize at 5D+60 (1-min latency). poolFinalityTs = 12D.
    // Draw $400k on day 10 (t=10D+3600) with settlementDays=2.
    // idle after draw  = 1M × 5d × 0.0005  = 2 500 USDC (days 5-9)
    // idle after repay = 2500 + 600k × 2d × 0.0005 = 3 100 USDC (days 10-11)
    // utilized yield at repay = 400k × 3d × 0.001 = 1 200 USDC
    // idle days billed = 12 - 5 = 7 = tenure
    function test_partD_C_draw_across_finality() public {
        vm.warp(0);
        PoolContract p = _createPoolD(PSP_D3);

        _deposit(p, LP1, 1_000_000);
        vm.warp(5 * D + 60);    // 1-minute latency
        _finalize(p, AGENT1);

        assertEq(p.poolStartTs(),    5 * D + 60, "D-C: poolStartTs");
        assertEq(p.poolFinalityTs(), 12 * D,     "D-C: poolFinalityTs = 12D");

        // Draw 400k on tenure-day 5 (calendar day 10)
        uint256 drawTs = 10 * D + 3600;
        vm.warp(drawTs);
        _draw(p, PSP_D3, keccak256("sc_draw"), 400_000, 3);

        // executeDrawdown calls _accrueIdleFees: bills days 5-9 (5 days on 1M)
        (uint256 idleAfterDraw,,) = p.getIdleFeesBreakdown();
        assertEq(idleAfterDraw, 2_500 * SCALE, "D-C: idle after draw = 2500");

        // Repay 12h past finality midnight
        uint256 repayTs = 12 * D + 43200;
        vm.warp(repayTs);
        _repay(p, PSP_D3, keccak256("sc_draw"));

        // After repay: idle += 600k × 2d (days 10-11) = 600 USDC → total 3 100
        (uint256 idleAfterRepay,,) = p.getIdleFeesBreakdown();
        assertEq(idleAfterRepay, 3_100 * SCALE, "D-C: idle after repay = 3100");

        // Finance charge = 400k × 3d × 10bps = 1 200 USDC
        assertEq(p.collectedYield(), 1_200 * SCALE, "D-C: collected yield = 1200");

        // Idle days billed = lastIdleDay - dayOf(poolStartTs) = 12 - 5 = 7 = tenure
        uint256 idleDaysBilled = p.lastIdleDay() - MathLib.dayOf(p.poolStartTs());
        assertEq(idleDaysBilled, 7, "D-C: idle days billed = tenure");
    }

    // Scenario D: gaming resistance.
    // LP1 withdraws+re-deposits at day 2 (forfeits 2 days of funding credit on 500k).
    // LP2 holds continuously.
    // LP1.ds = 432_030_000_000 * SCALE (gamer)
    // LP2.ds = 518_430_000_000 * SCALE (honest)
    // Difference = 86_400_000_000 * SCALE = 500k × 2 × SPD (two forfeited days)
    // Idle = 3 500 USDC (no draws).
    function test_partD_D_gaming_resistance() public {
        vm.warp(0);
        PoolContract p = _createPoolD(PSP_D4);

        // Both LPs deposit 500k at t=0
        _deposit(p, LP1, 500_000);
        _deposit(p, LP2, 500_000);

        // LP1 withdraw+redeposit at day 2 (forfeits funding credit earned so far)
        vm.warp(2 * D);
        vm.prank(LP1); p.withdraw(500_000 * SCALE);
        _deposit(p, LP1, 500_000);

        // Finalize 1 minute past fMaturityTs
        vm.warp(5 * D + 60);
        _finalize(p, AGENT1);

        assertEq(p.poolStartTs(), 5 * D + 60, "D-D: poolStartTs");

        // Settle LP dollar-seconds
        vm.warp(13 * D);
        vm.prank(LP1); p.claimYield();
        vm.prank(LP2); p.claimYield();

        (, uint256 ds1,,,,) = p.getLpPosition(LP1);
        (, uint256 ds2,,,,) = p.getLpPosition(LP2);

        assertEq(ds1, 432_030_000_000 * SCALE, "D-D: LP1 (gamer) dollar-seconds");
        assertEq(ds2, 518_430_000_000 * SCALE, "D-D: LP2 (honest) dollar-seconds");
        assertEq(ds2 - ds1, 86_400_000_000 * SCALE, "D-D: difference = 500k x 2 days");
        assertGt(ds2, ds1, "D-D: honest LP earns more than gamer");

        // Idle = 3 500 USDC (no draws)
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        assertEq(idleFees, 3_500 * SCALE, "D-D: idle fees = 3500");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SNAP TEST — poolFinalityTs midnight alignment and IDLE6 invariance
    // ─────────────────────────────────────────────────────────────────────────

    // Pool created at t=3600 (1 h into day 0).
    // fMaturityRaw = 3600 + 5D = 435600.  fRemainder = 3600.  snapSecs = 82800.
    // fMaturityTs = 518400 = 6D (next midnight).
    // poolFinalityTs = 6D + 7D = 13D.
    function test_snap_poolFinalityTs_midnight_aligned() public {
        vm.warp(3600);
        PoolContract p = _createPoolD(PSP_SNAP);

        assertEq(p.fMaturityTs() % D, 0, "snap: fMaturityTs is midnight-aligned");
        assertEq(p.fMaturityTs(), 6 * D, "snap: fMaturityTs = 6D");

        _deposit(p, LP1, 1_000_000);
        vm.warp(6 * D);
        _finalize(p, AGENT1);

        assertEq(p.poolFinalityTs() % D, 0, "snap: poolFinalityTs midnight-aligned");
        assertEq(p.poolFinalityTs(), 13 * D, "snap: poolFinalityTs = 13D");

        // IDLE6: dayOf(poolFinalityTs) - dayOf(poolStartTs) == tenure
        uint256 idle6 = MathLib.dayOf(p.poolFinalityTs()) - MathLib.dayOf(p.poolStartTs());
        assertEq(idle6, TENURE_D, "snap: IDLE6 = tenure at zero latency");
    }

    // Same pool but finalize at fMaturityTs + BUFFER_SECS (max allowed latency).
    // poolFinalityTs must STILL be 5D + 7D = 12D (not shifted by latency).
    // IDLE6 must STILL equal tenure.
    function test_snap_IDLE6_invariant_to_buffer_latency() public {
        vm.warp(0);
        PoolContract p = _createPoolD(PSP_SNAP);
        uint256 fMat = p.fMaturityTs();     // = 5D

        _deposit(p, LP1, 1_000_000);
        vm.warp(fMat + BUFFER_SECS);        // exactly at buffer deadline
        _finalize(p, AGENT1);

        assertEq(p.poolFinalityTs() % D, 0, "latency: poolFinalityTs midnight-aligned");
        assertEq(p.poolFinalityTs(), 12 * D, "latency: poolFinalityTs = 12D (not shifted)");

        uint256 idle6 = MathLib.dayOf(p.poolFinalityTs()) - MathLib.dayOf(p.poolStartTs());
        assertEq(idle6, TENURE_D, "latency: IDLE6 invariant to finalize latency");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VIEW == STATE GATE
    // getIdleFeesBreakdown / getIdleFeesBreakdown must return exactly what
    // _accrueIdleFees would bank at the same instant.
    // Four checkpoints:
    //   T1 — just after lock (day 0 of tenure)
    //   T2 — mid-tenure (day 15), no draws
    //   T3 — post-repay with active exemption (same-day repay window)
    //   T4 — post-finality
    // ─────────────────────────────────────────────────────────────────────────

    function test_viewEqualState_idle_fees() public {
        vm.warp(0);
        PoolContract p = _createPoolA(PSP_VS);
        _deposit(p, LP1, 1_000_000);
        vm.warp(5 * D);
        _finalize(p, AGENT1);

        // T1: just locked — view must show 0, state must show 0
        {
            (uint256 v,,) = p.getIdleFeesBreakdown();
            vm.prank(LP1); p.claimYield();   // triggers _accrueIdleFees
            assertEq(p.accIdleFees(), v, "view==state T1: day 0");
        }

        // T2: mid-tenure day 15 (t = 20D) — no draws, plain idle accumulation
        vm.warp(20 * D);
        {
            (uint256 v,,) = p.getIdleFeesBreakdown();
            vm.prank(LP1); p.claimYield();
            assertEq(p.accIdleFees(), v, "view==state T2: day 15");
        }

        // T3: post-repay with active exemption (draw 600k at d20, repay 14h later same day)
        uint256 L = 5 * D;  // poolStartTs
        vm.warp(L + 20 * D);       // day 20 of tenure
        _draw(p, PSP_VS, keccak256("vs1"), 600_000, 7);
        vm.warp(L + 20 * D + 14 * 3600);  // 14h into day 20 (within day, exemption still active)
        _repay(p, PSP_VS, keccak256("vs1"));
        // Exemption: 600k exempt until next midnight (day 21)
        // Check view==state immediately after repay (within exemption window)
        {
            (uint256 v,,) = p.getIdleFeesBreakdown();
            // Trigger state accrual via another claimYield (no-op if elapsed = 0)
            vm.prank(LP1); p.claimYield();
            assertEq(p.accIdleFees(), v, "view==state T3: active exemption");
        }

        // T4: post-finality
        vm.warp(36 * D);
        {
            (uint256 v,,) = p.getIdleFeesBreakdown();
            vm.prank(LP1); p.claimYield();
            assertEq(p.accIdleFees(), v, "view==state T4: post-finality");
        }
    }
}
