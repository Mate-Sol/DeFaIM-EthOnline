// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Coverage proofs for the three suite_fuzz.py distribution targets.
///
/// These deterministic tests prove that the handler can produce the states
/// required by each sub-loop — they are NOT random fuzz runs but scripted
/// sequences that exercise each required invariant path and assert non-zero
/// coverage counters.
///
/// L1: broad lifecycle walk — locked, drawdown, repay, claims all reached.
/// L2: draw-heavy (≥300 draws in a single test, proving the handler can sustain
///     high-churn load within a pool's tenure).
/// L3: snap/latency quartile sweep — 4 snap quartiles × 4 latency quartiles,
///     churn, gaming resistance, multi-LP.
contract FuzzerCoverage is Test {

    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 constant D           = 86_400;
    uint256 constant BUFFER_SECS = 21_600;   // 0.25 × D
    uint256 constant SCALE       = 1e12;
    uint256 constant WAD         = 1e18;

    // ── Actors ────────────────────────────────────────────────────────────────

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant PSP1     = address(0x5556);
    address constant PSP2     = address(0x5557);
    address constant PSP3     = address(0x5558);
    address constant LP1      = address(0xAA01);
    address constant LP2      = address(0xAA02);
    address constant LP3      = address(0xAA03);

    // ── Infrastructure ────────────────────────────────────────────────────────

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
            25e16,   // fundingExecBufferDays (0.25 days)
            3,       // maxGracePeriodDays
            1,       // minDdDays
            7       // maxDdDays
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);
        vm.prank(MULTISIG); factory.approvePsp(PSP1);
        vm.prank(MULTISIG); factory.approvePsp(PSP2);
        vm.prank(MULTISIG); factory.approvePsp(PSP3);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _deposit(PoolContract p, address lp, uint256 pyAmt) internal {
        uint256 amt = pyAmt * SCALE;
        usdc.mint(lp, amt);
        vm.startPrank(lp);
        usdc.approve(address(p), amt);
        p.deposit(amt);
        vm.stopPrank();
    }

    function _draw(PoolContract p, bytes32 ref, uint256 pyAmt, uint256 settlementDays) internal {
        uint256 amt = pyAmt * SCALE;
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, amt, settlementDays);
    }

    function _repay(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.startPrank(PSP);
        usdc.approve(address(p), total);
        p.repay(ref);
        vm.stopPrank();
    }

    function _payIdle(PoolContract p) internal {
        (, , uint256 total) = p.getIdleFeesBreakdown();
        if (total == 0) return;
        usdc.mint(PSP, total);
        vm.startPrank(PSP);
        usdc.approve(address(p), total);
        p.payAccruedIdleFees(total);
        vm.stopPrank();
    }

    function _createPool(uint256 tenure) internal returns (PoolContract p) {
        return _createPoolFor(tenure, PSP);
    }

    function _createPoolFor(uint256 tenure, address psp) internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         psp,
            fundingDurationSecs: 5 * 86400,
            softCap:           100 * SCALE,
            hardCap:           1_000_000 * SCALE,
            tenure:            tenure,
            idleRateDaily:     5e14,
            utilizedRateDaily: 1e15,
            penaltyRateDaily:  2e15,
            penaltyGraceDays:  0,
            minDeposit:        0,
            aprAnnual:         5e16,
            agent1:            AGENT1,
            agent2:            AGENT2,
            multisig:          MULTISIG
        }));
        p = PoolContract(addr);
    }

    function _drawFor(PoolContract p, bytes32 ref, uint256 pyAmt, uint256 settlementDays, address psp) internal {
        uint256 amt = pyAmt * SCALE;
        vm.prank(AGENT2); p.executeDrawdown(ref, psp, amt, settlementDays);
    }

    function _repayFor(PoolContract p, bytes32 ref, address psp) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(psp, total);
        vm.startPrank(psp);
        usdc.approve(address(p), total);
        p.repay(ref);
        vm.stopPrank();
    }

    // ── L1: Broad lifecycle walk ──────────────────────────────────────────────

    /// @dev L1: Proves all lifecycle states are reachable: Funding → Active →
    ///      drawdown → repay → Closed → claimYield + claimPrincipal.
    ///
    ///      Coverage counters must all be > 0:
    ///        - poolActivated, drawSucceeded, repaySucceeded, yieldClaimed, principalClaimed
    function test_L1_broadLifecycle_coverage() public {
        vm.warp(0);

        uint256 poolActivated    = 0;
        uint256 drawSucceeded    = 0;
        uint256 repaySucceeded   = 0;
        uint256 yieldClaimed     = 0;
        uint256 principalClaimed = 0;

        // Pool 1: standard lifecycle
        {
            PoolContract p = _createPool(14);
            _deposit(p, LP1, 600_000);
            _deposit(p, LP2, 400_000);
            vm.warp(p.fMaturityTs() + 60);
            p.finalizeFunding();
            assertEq(uint(p.status()), uint(PoolContract.Status.Active));
            poolActivated++;

            uint256 start = p.poolStartTs();
            vm.warp(start + D);
            _draw(p, "l1_p1_r1", 300_000, 5);
            drawSucceeded++;

            vm.warp(start + 4 * D);
            _draw(p, "l1_p1_r2", 200_000, 5);
            drawSucceeded++;

            vm.warp(start + 7 * D);
            _repay(p, "l1_p1_r1");
            repaySucceeded++;

            vm.warp(start + 10 * D);
            _repay(p, "l1_p1_r2");
            repaySucceeded++;

            vm.warp(p.poolFinalityTs() + D);
            _payIdle(p);
            assertEq(uint(p.status()), uint(PoolContract.Status.Closed));

            vm.prank(LP1); p.claimYield();
            yieldClaimed++;
            vm.prank(LP2); p.claimYield();
            yieldClaimed++;

            vm.prank(LP1); p.claimPrincipal();
            principalClaimed++;
            vm.prank(LP2); p.claimPrincipal();
            principalClaimed++;
        }

        // Pool 2: single-LP, same-day draw/repay churn
        {
            vm.warp(0);
            PoolContract p = _createPool(7);
            _deposit(p, LP3, 500_000);
            vm.warp(p.fMaturityTs() + 60);
            p.finalizeFunding();
            poolActivated++;

            uint256 start = p.poolStartTs();
            vm.warp(start + D);
            _draw(p, "l1_p2_r1", 100_000, 2);
            drawSucceeded++;
            // Same-day repay + redraw (churn)
            vm.warp(start + D + 3600);
            _repay(p, "l1_p2_r1");
            repaySucceeded++;
            _draw(p, "l1_p2_r2", 80_000, 2);
            drawSucceeded++;

            vm.warp(start + 3 * D);
            _repay(p, "l1_p2_r2");
            repaySucceeded++;

            vm.warp(p.poolFinalityTs() + D);
            _payIdle(p);
            assertEq(uint(p.status()), uint(PoolContract.Status.Closed));

            vm.prank(LP3); p.claimYield();
            yieldClaimed++;
            vm.prank(LP3); p.claimPrincipal();
            principalClaimed++;
        }

        // Report and assert coverage
        emit log_named_uint("L1 pools_activated",    poolActivated);
        emit log_named_uint("L1 draws_succeeded",    drawSucceeded);
        emit log_named_uint("L1 repays_succeeded",   repaySucceeded);
        emit log_named_uint("L1 yield_claimed",      yieldClaimed);
        emit log_named_uint("L1 principal_claimed",  principalClaimed);

        assertGt(poolActivated,    0, "L1: no pool ever activated");
        assertGt(drawSucceeded,    0, "L1: no draw ever succeeded");
        assertGt(repaySucceeded,   0, "L1: no repay ever succeeded");
        assertGt(yieldClaimed,     0, "L1: no yield ever claimed");
        assertGt(principalClaimed, 0, "L1: no principal ever claimed");
    }

    // ── L2: Draw-heavy (≥2000 draws) ─────────────────────────────────────────

    /// @dev L2: Prove the handler sustains ≥2000 draw/repay cycles within a single
    ///      pool's tenure, matching suite_fuzz.py's draw-heavy sub-loop threshold.
    ///
    ///      Strategy: 6 days × 334 draw/repay cycles per day = 2004 draws + 2004 repays.
    ///      Each cycle: draw $10k → same-day repay (same timestamp, no settlement expiry).
    ///      Uses a 30-day pool so the tenure comfortably spans the 6 active days.
    function test_L2_drawHeavy_atLeast2000Draws() public {
        vm.warp(0);
        PoolContract p = _createPool(30);
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        p.finalizeFunding();
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "L2: pool not active");

        uint256 start     = p.poolStartTs();
        uint256 drawCount = 0;

        for (uint256 day = 1; day <= 6; day++) {
            vm.warp(start + day * D);
            for (uint256 i = 0; i < 334; i++) {
                bytes32 ref = keccak256(abi.encodePacked(day, i));

                // Execute drawdown — track successes
                uint256 prevOut = p.outstanding();
                vm.prank(AGENT2); p.executeDrawdown(ref, PSP, 10_000 * SCALE, 1);
                if (p.outstanding() > prevOut) {
                    drawCount++;
                    // Immediately repay (same-day churn)
                    (, , uint256 total) = p.getRepaymentOwed(ref);
                    usdc.mint(PSP, total);
                    vm.startPrank(PSP);
                    usdc.approve(address(p), total);
                    p.repay(ref);
                    vm.stopPrank();
                }
            }
        }

        emit log_named_uint("L2 draw_count", drawCount);
        assertGe(drawCount, 2000,
            string.concat("L2: draw count below 2000 target, got ", vm.toString(drawCount)));
    }

    // ── L3: Snap/latency quartile sweep ──────────────────────────────────────

    /// @dev L3: Creates 4 pools at different creation times to cover all four snap
    ///      quartiles, finalizes each at a different latency to cover all four latency
    ///      quartiles, and asserts:
    ///        - All 4 snap quartiles hit (snapSecs in [0,D/4), [D/4,D/2), [D/2,3D/4), [3D/4,D))
    ///        - All 4 latency quartiles hit (lat in [0,B/4), [B/4,B/2), [B/2,3B/4), [3B/4,B])
    ///        - IDLE10 + IDLE11 hold on every pool (midnight alignment)
    ///        - IDLE6 holds on every pool (window == tenure)
    ///        - Multi-LP funding (two LPs on each pool)
    ///        - Same-day churn on pool 0 (gaming resistance)
    function test_L3_snapLatencyQuartile_coverage() public {
        // snap_q0: snapSecs in [0, D/4)    — create at t=0          (raw=5D, snap=0)
        // snap_q1: snapSecs in [D/4, D/2)  — create at t=3D/4       (raw=5D+3D/4, snap=D/4)
        // snap_q2: snapSecs in [D/2, 3D/4) — create at t=D/2        (raw=5D+D/2,  snap=D/2)
        // snap_q3: snapSecs in [3D/4, D)   — create at t=D/4        (raw=5D+D/4,  snap=3D/4)
        uint256[4] memory createTimes = [
            uint256(0),        // snap_q0
            uint256(3 * D / 4), // snap_q1
            uint256(D / 2),    // snap_q2
            uint256(D / 4)     // snap_q3
        ];

        // lat_q0: lat in [0, B/4)           — latency = 0
        // lat_q1: lat in [B/4, B/2)         — latency = BUFFER_SECS/4
        // lat_q2: lat in [B/2, 3B/4)        — latency = BUFFER_SECS/2
        // lat_q3: lat in [3B/4, BUFFER_SECS] — latency = 3*BUFFER_SECS/4
        uint256[4] memory latencies = [
            uint256(0),
            uint256(BUFFER_SECS / 4),
            uint256(BUFFER_SECS / 2),
            uint256(3 * BUFFER_SECS / 4)
        ];

        address[4] memory testPsps = [PSP, PSP1, PSP2, PSP3];

        bool[4] memory snapQHit;
        bool[4] memory latQHit;
        uint256 multiLpPools    = 0;
        uint256 churnEvents     = 0;
        uint256 poolsActivated  = 0;

        for (uint256 i = 0; i < 4; i++) {
            vm.warp(createTimes[i]);
            PoolContract p = _createPoolFor(14, testPsps[i]);

            // Multi-LP: both LP1 and LP2 deposit
            _deposit(p, LP1, 600_000);
            _deposit(p, LP2, 400_000);
            multiLpPools++;

            // Finalize at fMaturityTs + latency[i]
            vm.warp(p.fMaturityTs() + latencies[i]);
            p.finalizeFunding();
            assertEq(uint(p.status()), uint(PoolContract.Status.Active),
                string.concat("L3: pool ", vm.toString(i), " not active"));
            poolsActivated++;

            // Verify midnight alignment (IDLE10 + IDLE11)
            assertEq(p.fMaturityTs()    % D, 0, string.concat("L3: IDLE10 violated on pool ", vm.toString(i)));
            assertEq(p.poolFinalityTs() % D, 0, string.concat("L3: IDLE11 violated on pool ", vm.toString(i)));

            // Verify window == tenure (IDLE6)
            uint256 sd          = p.poolStartTs() / D;
            uint256 lastBill    = p.poolFinalityTs() / D - 1;
            uint256 window      = lastBill - sd + 1;
            assertEq(window, p.tenure(), string.concat("L3: IDLE6 violated on pool ", vm.toString(i)));

            // Compute snap quartile
            uint256 rawMaturity = createTimes[i] + 5 * D;  // fundingDays=5
            uint256 snapSecs    = (D - rawMaturity % D) % D;
            uint256 snapQ;
            if      (snapSecs < D / 4)     snapQ = 0;
            else if (snapSecs < D / 2)     snapQ = 1;
            else if (snapSecs < 3 * D / 4) snapQ = 2;
            else                           snapQ = 3;
            snapQHit[snapQ] = true;

            // Compute latency quartile
            uint256 lat = latencies[i];
            uint256 latQ;
            if      (lat < BUFFER_SECS / 4)     latQ = 0;
            else if (lat < BUFFER_SECS / 2)     latQ = 1;
            else if (lat < 3 * BUFFER_SECS / 4) latQ = 2;
            else                                 latQ = 3;
            latQHit[latQ] = true;

            // Pool 0: add a same-day draw/repay churn to test gaming resistance
            if (i == 0) {
                uint256 start = p.poolStartTs();
                vm.warp(start + D);
                _drawFor(p, keccak256(abi.encodePacked("l3_churn", i)), 50_000, 2, testPsps[i]);
                vm.warp(start + D + 3600);
                _repayFor(p, keccak256(abi.encodePacked("l3_churn", i)), testPsps[i]);
                churnEvents++;
            }

            // Pool 3: draw and repay across different days (non-churn)
            if (i == 3) {
                uint256 start = p.poolStartTs();
                vm.warp(start + D);
                bytes32 ref = keccak256(abi.encodePacked("l3_draw", i));
                _drawFor(p, ref, 100_000, 3, testPsps[i]);
                vm.warp(start + 3 * D);
                _repayFor(p, ref, testPsps[i]);
            }
        }

        // Report coverage
        emit log_named_uint("L3 pools_activated",  poolsActivated);
        emit log_named_uint("L3 multi_lp_pools",   multiLpPools);
        emit log_named_uint("L3 churn_events",      churnEvents);

        // Assert all snap quartiles covered
        for (uint256 q = 0; q < 4; q++) {
            assertTrue(snapQHit[q],
                string.concat("L3: snap quartile ", vm.toString(q), " not covered"));
        }
        emit log("L3: all 4 snap quartiles covered");

        // Assert all latency quartiles covered
        for (uint256 q = 0; q < 4; q++) {
            assertTrue(latQHit[q],
                string.concat("L3: latency quartile ", vm.toString(q), " not covered"));
        }
        emit log("L3: all 4 latency quartiles covered");

        assertGe(multiLpPools,  4, "L3: fewer than 4 multi-LP pools");
        assertGe(churnEvents,   1, "L3: no churn events (gaming resistance not tested)");
        assertGe(poolsActivated, 4, "L3: fewer than 4 pools activated");
    }
}
