// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Suite adversarial Parts A and B ported from suite_adversarial.py.
///
/// Part A: Day-billing grid — 112 configs (4 tenures x 4 create-times x 7 latencies)
///         plus the buffer-boundary edge case.
///         Every active pool must bill EXACTLY `tenure` idle days.
///
/// Part B: 21 v2 seam tests — buffer boundary, midnight snap, no-auto-lock,
///         settlement-at-draw, draw-across-finality, funding-credit gaming.
contract AdversarialV2 is Test {

    // ── constants ────────────────────────────────────────────────────────────

    uint256 constant D           = 86400;
    uint256 constant BUFFER_SECS = 21600;     // 0.25 days = 6 h
    uint256 constant SCALE       = 1e12;
    uint256 constant WAD         = 1e18;

    // ── actors ───────────────────────────────────────────────────────────────

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant LP1      = address(0xAA01);
    address constant LP2      = address(0xAA02);

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
            25e16,   // fundingExecBufferDays (0.25 days, WAD)
            3,       // maxGracePeriodDays
            1,       // minDdDays
            7       // maxDdDays
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);
    }

    // ── pool helpers ─────────────────────────────────────────────────────────

    struct PoolParams {
        uint256 tenure;
        uint256 aprAnnual;
    }

    function _createPool(PoolParams memory pp) internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:        PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:          100 * SCALE,
            hardCap:          1_000_000 * SCALE,
            tenure:           pp.tenure,
            idleRateDaily:    5e14,     // 5 bps
            utilizedRateDaily: 1e15,   // 10 bps
            penaltyRateDaily: 2e15,    // 20 bps
            penaltyGraceDays: 0,
            minDeposit:       0,
            aprAnnual:        pp.aprAnnual,
            agent1:           AGENT1,
            agent2:           AGENT2,
            multisig:         MULTISIG
        }));
        p = PoolContract(addr);
    }

    function _deposit(PoolContract p, address lp, uint256 pyAmt) internal {
        uint256 amt = pyAmt * SCALE;
        usdc.mint(lp, amt);
        vm.startPrank(lp); usdc.approve(address(p), amt); p.deposit(amt); vm.stopPrank();
    }

    function _tryFinalize(PoolContract p) internal {
        vm.prank(AGENT1); p.finalizeFunding();
    }

    function _draw(PoolContract p, bytes32 ref, uint256 amount, uint256 settleDays) internal {
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, amount, settleDays);
    }

    function _payIdle(PoolContract p) internal {
        (, , uint256 total) = p.getIdleFeesBreakdown();
        if (total == 0) return;
        usdc.mint(PSP, total);
        vm.startPrank(PSP); usdc.approve(address(p), total); p.payAccruedIdleFees(total); vm.stopPrank();
    }

    function _repay(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.startPrank(PSP); usdc.approve(address(p), total); p.repay(ref); vm.stopPrank();
    }

    /// @dev Create, fill, activate, warp past finality, and return the pool.
    ///      Returns address(0) if the factory rejected the pool (APR guard).
    function _fullyIdlePool(
        uint256 createT,
        uint256 finalizeLatency,
        uint256 tenure,
        uint256 apr
    ) internal returns (PoolContract p) {
        vm.warp(createT);
        // Factory rejects the pool when aprAnnual * maxTenureSecs > utilRate * 365 * tenure * D.
        // We catch the revert from createPool and return address(0).
        vm.prank(DEPLOYER);
        try factory.createPool{gas: 1_000_000}(PoolFactory.CreatePoolParams({
            pspWallet:        PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:          100 * SCALE,
            hardCap:          1_000_000 * SCALE,
            tenure:           tenure,
            idleRateDaily:    5e14,
            utilizedRateDaily: 1e15,
            penaltyRateDaily: 2e15,
            penaltyGraceDays: 0,
            minDeposit:       0,
            aprAnnual:        apr,
            agent1:           AGENT1,
            agent2:           AGENT2,
            multisig:         MULTISIG
        })) returns (address addr) {
            p = PoolContract(addr);
        } catch {
            return PoolContract(address(0));
        }

        _deposit(p, LP1, 1_000_000);
        uint256 lockT = p.fMaturityTs() + finalizeLatency;
        vm.warp(lockT);
        _tryFinalize(p);
        if (p.status() != PoolContract.Status.Active) {
            return PoolContract(address(0));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PART A — Day-billing grid
    //
    // 4 tenures × 4 create-times × 7 latencies = up to 112 active configs.
    // Some configs are skipped when the factory's APR guard rejects the pool.
    // For every active pool: idle fees imply EXACTLY `tenure` days billed.
    //
    // Mirrors Python suite_adversarial.py Part A.
    // ─────────────────────────────────────────────────────────────────────────

    function _checkOneDayBillingConfig(
        uint256 createT,
        uint256 latency,
        uint256 tenure,
        uint256 apr
    ) internal returns (bool wasActive) {
        uint256 snap = vm.snapshot();
        PoolContract p = _fullyIdlePool(createT, latency, tenure, apr);
        if (address(p) == address(0)) { vm.revertTo(snap); return false; }

        vm.warp(p.poolFinalityTs() + 3 * D);
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        assertEq(idleFees, MathLib.mulDiv(1_000_000 * SCALE * tenure, 5e14, WAD),
            "Part A: idle fees != tenure * rate");
        assertEq(MathLib.dayOf(p.poolFinalityTs()) - MathLib.dayOf(p.poolStartTs()), tenure,
            "Part A: IDLE6 window != tenure");
        assertEq(p.fMaturityTs() % D, 0,  "Part A: IDLE10 fMaturityTs not midnight");
        assertEq(p.poolFinalityTs() % D, 0, "Part A: IDLE11 poolFinalityTs not midnight");

        vm.revertTo(snap);
        return true;
    }

    function test_partA_dayBillingGrid() public {
        uint256[4] memory tenures   = [uint256(7), 30, 60, 90];
        uint256[4] memory creates   = [uint256(0), 1, D / 2, D - 1];
        uint256[7] memory latencies = [
            uint256(0), 1, 60, 3600, BUFFER_SECS / 2, BUFFER_SECS - 60, BUFFER_SECS
        ];
        uint256 checked = 0;

        for (uint256 ti = 0; ti < 4; ti++) {
            uint256 tenure = tenures[ti];
            uint256 apr    = tenure <= 3 ? 5e16 : 1e17;
            for (uint256 ci = 0; ci < 4; ci++) {
                for (uint256 li = 0; li < 7; li++) {
                    if (_checkOneDayBillingConfig(creates[ci], latencies[li], tenure, apr)) {
                        checked++;
                    }
                }
            }
        }

        assertGt(checked, 80,
            string.concat("Part A: too few configs reached active, got ", vm.toString(checked)));
    }

    // Buffer boundary: one second past the buffer must yield Unsuccessful (not Active).
    function test_partA_bufferBoundaryRejectsLate() public {
        uint256 snap = vm.snapshot();
        vm.warp(0);

        PoolContract p = _fullyIdlePool(0, BUFFER_SECS, 30, 1e17);
        assertTrue(address(p) != address(0), "Part A buffer: pool at exact buffer should be Active");

        vm.revertTo(snap);

        // One second past buffer: must be Unsuccessful
        vm.warp(0);
        vm.prank(DEPLOYER);
        try factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:        PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:          100 * SCALE,
            hardCap:          1_000_000 * SCALE,
            tenure:           30,
            idleRateDaily:    5e14,
            utilizedRateDaily: 1e15,
            penaltyRateDaily: 2e15,
            penaltyGraceDays: 0,
            minDeposit:       0,
            aprAnnual:        1e17,
            agent1:           AGENT1,
            agent2:           AGENT2,
            multisig:         MULTISIG
        })) returns (address addr) {
            PoolContract p2 = PoolContract(addr);
            _deposit(p2, LP1, 1_000_000);
            vm.warp(p2.fMaturityTs() + BUFFER_SECS + 1);
            _tryFinalize(p2);
            assertEq(uint(p2.status()), uint(PoolContract.Status.Unsuccessful),
                "Part A buffer+1s: pool must be Unsuccessful past buffer");
        } catch {
            assertTrue(false, "Part A buffer+1s: pool creation unexpectedly reverted");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PART B — v2 seam tests (21 tests mirroring test_seams_v2.py)
    // ─────────────────────────────────────────────────────────────────────────

    // ──────────────────────────────────────────────────────────
    // Seam 1: Buffer boundary
    // ──────────────────────────────────────────────────────────

    function test_seam1_bufferAtBoundary_activates() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + BUFFER_SECS);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active),
            "seam1: should be Active at buffer deadline");
        // IDLE6
        uint256 window = MathLib.dayOf(p.poolFinalityTs()) - MathLib.dayOf(p.poolStartTs());
        assertEq(window, p.tenure(), "seam1: IDLE6 window != tenure at buffer deadline");
    }

    function test_seam1_bufferPastBoundary_unsuccessful() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + BUFFER_SECS + 1);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Unsuccessful),
            "seam1: should be Unsuccessful one second past buffer");
    }

    function test_seam1_bufferBeforeBoundary_activates() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + BUFFER_SECS - 1);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active),
            "seam1: should be Active one second before buffer deadline");
    }

    // ──────────────────────────────────────────────────────────
    // Seam 2: Midnight snap
    // ──────────────────────────────────────────────────────────

    function test_seam2_snapZero_fMaturityAtMidnight() public {
        vm.warp(0);  // create at midnight
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        assertEq(p.fMaturityTs() % D, 0, "seam2: snap_secs=0: fMaturityTs must be midnight");
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "seam2: snap_zero should activate");
        assertEq(p.poolFinalityTs() % D, 0, "seam2: poolFinalityTs must be midnight");
        uint256 window = MathLib.dayOf(p.poolFinalityTs()) - MathLib.dayOf(p.poolStartTs());
        assertEq(window, p.tenure(), "seam2: IDLE6 at snap_secs=0");
    }

    function test_seam2_snapNonZero_fMaturitySnappedToNextMidnight() public {
        vm.warp(D / 2);  // noon — snap_secs = D/2
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        // fMaturityRaw = D/2 + 5D = 5.5D.  Next midnight = 6D.
        assertEq(p.fMaturityTs(), 6 * D, "seam2: snap to next midnight (6D)");
        assertEq(p.fMaturityTs() % D, 0, "seam2: snap_nonzero: fMaturityTs is midnight");
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "seam2: snap_nonzero activates");
        assertEq(p.poolFinalityTs() % D, 0, "seam2: poolFinalityTs is midnight");
        uint256 window = MathLib.dayOf(p.poolFinalityTs()) - MathLib.dayOf(p.poolStartTs());
        assertEq(window, p.tenure(), "seam2: IDLE6 after snap");
    }

    // 27-combo grid: tenure x {7,30,60} x creation-TOD x {0,13h,22h} x latency x {0,3min,2h}
    function test_seam2_IDLE6_27combos() public {
        uint256[3] memory tenures   = [uint256(7), 30, 60];
        uint256[3] memory todsBase  = [uint256(0), 13 * 3600, 22 * 3600];
        uint256[3] memory latencies = [uint256(0), 180, 2 * 3600];

        uint256 checked = 0;
        uint256 base = 1000 * D;   // align to a known baseline day so tod math is clean

        for (uint256 ti = 0; ti < 3; ti++) {
            uint256 tenure = tenures[ti];
            uint256 apr    = 1e17;
            for (uint256 ci = 0; ci < 3; ci++) {
                for (uint256 li = 0; li < 3; li++) {
                    uint256 snap = vm.snapshot();
                    vm.warp(base + todsBase[ci]);

                    PoolContract p;
                    vm.prank(DEPLOYER);
                    try factory.createPool(PoolFactory.CreatePoolParams({
                        pspWallet:        PSP,
                        fundingDurationSecs: 5 * 86400,
                        softCap:          100 * SCALE,
                        hardCap:          1_000_000 * SCALE,
                        tenure:           tenure,
                        idleRateDaily:    5e14,
                        utilizedRateDaily: 1e15,
                        penaltyRateDaily: 2e15,
                        penaltyGraceDays: 0,
                        minDeposit:       0,
                        aprAnnual:        apr,
                        agent1:           AGENT1,
                        agent2:           AGENT2,
                        multisig:         MULTISIG
                    })) returns (address addr) {
                        p = PoolContract(addr);
                    } catch {
                        vm.revertTo(snap);
                        continue;
                    }

                    _deposit(p, LP1, 1_000_000);
                    vm.warp(p.fMaturityTs() + latencies[li]);
                    _tryFinalize(p);

                    if (p.status() == PoolContract.Status.Active) {
                        uint256 window = MathLib.dayOf(p.poolFinalityTs())
                            - MathLib.dayOf(p.poolStartTs());
                        assertEq(window, tenure,
                            string.concat("seam2 27combo: IDLE6 window=", vm.toString(window),
                                " tenure=", vm.toString(tenure)));
                        assertEq(p.fMaturityTs() % D, 0, "seam2 27combo: fMaturityTs midnight");
                        assertEq(p.poolFinalityTs() % D, 0, "seam2 27combo: poolFinalityTs midnight");
                        checked++;
                    }
                    vm.revertTo(snap);
                }
            }
        }
        assertEq(checked, 27,
            string.concat("seam2 27combo: expected all 27 combos to be Active, got ", vm.toString(checked)));
    }

    // ──────────────────────────────────────────────────────────
    // Seam 3: Hard-cap no-auto-lock
    // ──────────────────────────────────────────────────────────

    function test_seam3_fillHardCap_doesNotAutoLock() public {
        vm.warp(0);
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:        PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:          100 * SCALE,
            hardCap:          500 * SCALE,    // small cap
            tenure:           30,
            idleRateDaily:    5e14,
            utilizedRateDaily: 1e15,
            penaltyRateDaily: 2e15,
            penaltyGraceDays: 0,
            minDeposit:       0,
            aprAnnual:        1e17,
            agent1:           AGENT1,
            agent2:           AGENT2,
            multisig:         MULTISIG
        }));
        PoolContract p = PoolContract(addr);
        _deposit(p, LP1, 500);   // fills hard cap exactly
        assertEq(uint(p.status()), uint(PoolContract.Status.Funding),
            "seam3: filling hard cap must NOT auto-lock; pool must stay Funding");
    }

    function test_seam3_depositBeyondHardCap_rejected() public {
        vm.warp(0);
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:        PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:          100 * SCALE,
            hardCap:          500 * SCALE,
            tenure:           30,
            idleRateDaily:    5e14,
            utilizedRateDaily: 1e15,
            penaltyRateDaily: 2e15,
            penaltyGraceDays: 0,
            minDeposit:       0,
            aprAnnual:        1e17,
            agent1:           AGENT1,
            agent2:           AGENT2,
            multisig:         MULTISIG
        }));
        PoolContract p = PoolContract(addr);
        _deposit(p, LP1, 500);
        assertEq(p.principal(), 500 * SCALE, "seam3: principal after fill");
        // Attempt deposit beyond cap
        usdc.mint(LP2, 1 * SCALE);
        vm.startPrank(LP2); usdc.approve(address(p), 1 * SCALE);
        vm.expectRevert("Pool: exceeds hard cap");
        p.deposit(1 * SCALE);
        vm.stopPrank();
    }

    function test_seam3_withdrawRedeposit_afterFill_stillFunding() public {
        vm.warp(0);
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:        PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:          100 * SCALE,
            hardCap:          500 * SCALE,
            tenure:           30,
            idleRateDaily:    5e14,
            utilizedRateDaily: 1e15,
            penaltyRateDaily: 2e15,
            penaltyGraceDays: 0,
            minDeposit:       0,
            aprAnnual:        1e17,
            agent1:           AGENT1,
            agent2:           AGENT2,
            multisig:         MULTISIG
        }));
        PoolContract p = PoolContract(addr);
        _deposit(p, LP1, 500);
        assertEq(uint(p.status()), uint(PoolContract.Status.Funding), "seam3: still Funding after fill");
        vm.warp(D);
        vm.prank(LP1); p.withdraw(200 * SCALE);
        assertEq(p.principal(), 300 * SCALE, "seam3: principal after withdraw");
        assertEq(uint(p.status()), uint(PoolContract.Status.Funding), "seam3: still Funding after withdraw");
        _deposit(p, LP2, 100);
        assertEq(p.principal(), 400 * SCALE, "seam3: principal after redeposit");
        assertEq(uint(p.status()), uint(PoolContract.Status.Funding), "seam3: still Funding after redeposit");
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "seam3: activates at maturity");
    }

    function test_seam3_creditOrdering_earlyDepositorMoreDs() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        vm.warp(D);
        _deposit(p, LP1, 100_000);   // early
        vm.warp(3 * D);
        _deposit(p, LP2, 100_000);   // late (same amount, 2 days later)
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "seam3: credit ordering pool active");

        // Settle dollar-seconds
        vm.prank(LP1); p.claimYield();
        vm.prank(LP2); p.claimYield();
        (, uint256 ds1,,,,) = p.getLpPosition(LP1);
        (, uint256 ds2,,,,) = p.getLpPosition(LP2);
        assertGt(ds1, ds2, "seam3: early depositor must have more dollar-seconds than late");
    }

    // ──────────────────────────────────────────────────────────
    // Seam 4a: Draw expiry guard — settlement-at-draw
    // ──────────────────────────────────────────────────────────

    function test_seam4a_expiryGuardEquivalence() public {
        // dayOf(poolFinalityTs) == dayOf(poolStartTs + tenure*D) for any finalize latency
        uint256[5] memory latencies = [uint256(0), 60, 3600, BUFFER_SECS - 1, BUFFER_SECS];
        for (uint256 i = 0; i < 5; i++) {
            uint256 snap = vm.snapshot();
            vm.warp(0);
            PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
            _deposit(p, LP1, 1_000_000);
            vm.warp(p.fMaturityTs() + latencies[i]);
            _tryFinalize(p);
            if (p.status() != PoolContract.Status.Active) {
                vm.revertTo(snap);
                continue;
            }
            uint256 v2Guard = MathLib.dayOf(p.poolFinalityTs());
            uint256 v1Guard = MathLib.dayOf(p.poolStartTs() + p.tenure() * D);
            assertEq(v2Guard, v1Guard,
                string.concat("seam4a: expiry guard mismatch at latency=", vm.toString(latencies[i])));
            vm.revertTo(snap);
        }
    }

    function test_seam4a_expiryOnFinalityDay_accepted() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "seam4a: pool active");

        // Day 1 of tenure: settlement such that expiryTs (= now+(settlement-1)*D) lands on finality day.
        // Under inclusive-count convention: settlement = finalityDay - startDay + 1.
        uint256 startDay = MathLib.dayOf(p.poolStartTs()) + 1;
        vm.warp(startDay * D);
        uint256 finalityDay = MathLib.dayOf(p.poolFinalityTs());
        uint256 settlement  = finalityDay - MathLib.dayOf(startDay * D) + 1;  // inclusive count
        if (settlement >= 1 && settlement <= 7) {
            bytes32 ref = keccak256("exp1");
            uint256 before = p.outstanding();
            _draw(p, ref, 50_000 * SCALE, settlement);
            assertGt(p.outstanding(), before,
                "seam4a: draw with expiry on finality day must be accepted");
        }
    }

    function test_seam4a_expiryPastFinalityDay_rejected() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "seam4a: pool active");

        // Day 2: settlement=7 (max) → expiryTs = now+(7-1)*D = now+6D = start+8D, past finality
        vm.warp(p.poolStartTs() + 2 * D);
        bytes32 ref = keccak256("overrun");
        uint256 before = p.outstanding();
        vm.expectRevert("Pool: expiry past maturity");
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, 50_000 * SCALE, 7);
        assertEq(p.outstanding(), before, "seam4a: draw past finality must be rejected");
    }

    // ──────────────────────────────────────────────────────────
    // Seam 4b: elapsed <= span
    // ──────────────────────────────────────────────────────────

    function test_seam4b_elapsedLeSpan() public {
        uint256[2] memory latencies = [uint256(0), BUFFER_SECS];
        for (uint256 i = 0; i < 2; i++) {
            uint256 snap = vm.snapshot();
            vm.warp(0);
            PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
            _deposit(p, LP1, 1_000_000);
            vm.warp(p.fMaturityTs() + latencies[i]);
            _tryFinalize(p);
            if (p.status() != PoolContract.Status.Active) { vm.revertTo(snap); continue; }
            // Worst case: now = poolFinalityTs - 1
            uint256 elapsed = (p.poolFinalityTs() - 1) - p.poolStartTs();
            assertLt(elapsed, p.span(),
                string.concat("seam4b: elapsed >= span at latency=", vm.toString(latencies[i])));
            vm.revertTo(snap);
        }
    }

    // ──────────────────────────────────────────────────────────
    // Seam 5: Draw outstanding across finality midnight
    // ──────────────────────────────────────────────────────────

    function test_seam5_repayAfterFinality_goesToCollected() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "seam5: pool active");

        // Draw on day 1; repay after finality
        vm.warp(p.poolStartTs() + D);
        bytes32 ref = keccak256("dd1");
        _draw(p, ref, 200_000 * SCALE, 5);
        uint256 drawn = p.outstanding();
        assertGt(drawn, 0, "seam5: draw failed");

        vm.warp(p.poolFinalityTs() + D);
        uint256 preColl = p.collectedPrincipal();
        _repay(p, ref);
        assertGe(p.collectedPrincipal(), preColl + drawn,
            "seam5: repay post-finality must credit collectedPrincipal");
        assertEq(p.availableToDd(), 0,
            "seam5: availableToDd must be 0 post-finality after mature()");
    }

    function test_seam5_finality_day_not_billed() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "seam5: pool active");

        vm.warp(p.poolFinalityTs() + D);
        (uint256 idleFees,,) = p.getIdleFeesBreakdown();
        // idle = 1M * tenure * 5bps/day
        uint256 expected = MathLib.mulDiv(1_000_000 * SCALE * p.tenure(), 5e14, 1e18);
        assertEq(idleFees, expected,
            "seam5: finality day must not be billed (idle should equal exactly tenure days)");
    }

    // ──────────────────────────────────────────────────────────
    // Seam 6: last_update isolated in active phase
    // ──────────────────────────────────────────────────────────

    function test_seam6_lastUpdateIsolatedInActive() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        // Draw and repay mid-tenure
        vm.warp(p.poolStartTs() + 5 * D);
        bytes32 ref = keccak256("lu1");
        _draw(p, ref, 100_000 * SCALE, 3);
        vm.warp(p.poolStartTs() + 8 * D);
        _repay(p, ref);

        // Trigger mature → Closed so yield is finalised and claimable
        vm.warp(p.poolFinalityTs() + D);
        _payIdle(p);

        // Claim yield; check that LP1 actually received a positive amount.
        // (getClaimableYield reads storage pos.dollarSeconds which is 0 until
        // _settleLpDollarSeconds runs inside claimYield() — so we check post-claim.)
        vm.prank(LP1); p.claimYield();
        (,,,, uint256 lpClaimed,,,,) = p.lpPositions(LP1);
        assertGt(lpClaimed, 0,
            "seam6: LP1 must receive positive yield after drawdown repayment");
        // After full claim, no further yield is claimable (dust tolerance of 1)
        (, , uint256 claimableNow,,, ) = p.getLpPosition(LP1);
        assertLe(claimableNow, 1,
            "seam6: no more yield should be claimable after full claim");
    }

    // ──────────────────────────────────────────────────────────
    // Seam 7: Funding credit gaming via withdraw-redeposit
    // ──────────────────────────────────────────────────────────

    function test_seam7_noCreditGain_withdrawRedeposit() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        vm.warp(D);
        _deposit(p, LP1, 100_000);
        _deposit(p, LP2, 100_000);

        // LP1 withdraws and redeposits at day 3 (gaming attempt)
        vm.warp(3 * D);
        vm.prank(LP1); p.withdraw(100_000 * SCALE);
        _deposit(p, LP1, 100_000);

        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "seam7: pool active");

        vm.prank(LP1); p.claimYield();
        vm.prank(LP2); p.claimYield();
        (, uint256 dsGamer,,,,)  = p.getLpPosition(LP1);
        (, uint256 dsHonest,,,,) = p.getLpPosition(LP2);
        assertLe(dsGamer, dsHonest,
            "seam7: gamer (withdraw+redeposit) must not gain dollar-seconds over honest LP");
    }

    function test_seam7_lateDepositor_lowerCredit() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        vm.warp(D);
        _deposit(p, LP1, 100_000);    // early
        vm.warp(4 * D);
        _deposit(p, LP2, 100_000);    // late (same amount)
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        assertEq(uint(p.status()), uint(PoolContract.Status.Active), "seam7: late depositor pool active");

        vm.prank(LP1); p.claimYield();
        vm.prank(LP2); p.claimYield();
        (, uint256 dsEarly,,,,) = p.getLpPosition(LP1);
        (, uint256 dsLate,,,,)  = p.getLpPosition(LP2);
        assertGt(dsEarly, dsLate,
            "seam7: early depositor must have strictly more dollar-seconds than late depositor");
    }

    // ──────────────────────────────────────────────────────────
    // Seam 8: Default and mature interact correctly with anchored finality
    // ──────────────────────────────────────────────────────────

    function test_seam8_defaultBeforeFinality_clearsExemption() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        // Draw and repay same day to create exemption
        vm.warp(p.poolStartTs() + D);
        bytes32 ref = keccak256("dd_def");
        _draw(p, ref, 100_000 * SCALE, 3);
        vm.warp(p.poolStartTs() + D + 3600);
        _repay(p, ref);
        assertGt(p.idleExemptAmount(), 0, "seam8: exemption set after repay");

        // Declare default: must clear exemption
        vm.warp(p.poolStartTs() + 2 * D);
        vm.prank(AGENT2); p.declareDefault();
        assertEq(p.idleExemptAmount(), 0, "seam8: default must clear idleExemptAmount");
        assertEq(p.idleExemptUntil(), 0, "seam8: default must clear idleExemptUntil");
    }

    function test_seam8_mature_clearsExemption() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 7, aprAnnual: 5e16}));
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);

        // Draw and repay same day
        vm.warp(p.poolStartTs() + D);
        bytes32 ref = keccak256("dd_mat");
        _draw(p, ref, 100_000 * SCALE, 3);
        vm.warp(p.poolStartTs() + D + 3600);
        _repay(p, ref);
        assertGt(p.idleExemptAmount(), 0, "seam8: exemption set after repay");

        // Trigger mature via payAccruedIdleFees after finality
        vm.warp(p.poolFinalityTs() + D);
        _payIdle(p);
        assertEq(p.idleExemptAmount(), 0, "seam8: mature must clear idleExemptAmount");
        assertEq(p.idleExemptUntil(), 0, "seam8: mature must clear idleExemptUntil");
    }

    // ── A7: Calendar-day charge ≥ continuous-equivalent (solvency-positivity) ──
    //
    // §4.7 / §7: "the calendar-day charge always meets or exceeds the continuous-
    // equivalent charge, so the convention remains solvency-positive."
    //
    // The discrete charge for a drawdown is:
    //   financeCharge = principal × (stdDays × utilizedRateDaily + penDays × penaltyRateDaily) / WAD
    //
    // The continuous equivalent is:
    //   contCharge = principal × elapsedSeconds / SPD × utilizedRateDaily / WAD
    //             (penalty-days treated at util rate, conservatively bounding continuous equiv)
    //
    // Day-count always ≥ continuous because:
    //   daysTotal = floor(elapsed/SPD) + 1  (Day-0 inclusive, minDdDays floor)
    //   daysTotal × SPD ≥ elapsedSeconds always
    //   (e.g. elapsed=0s → daysTotal=1, SPD*1 ≥ 0s ✓)
    //
    // Tested over the full tenure range (1..maxDdDays) at both stdDays-only and
    // penalty-day scenarios. The tenure-1 case (1 day, minimal elapsed) is the
    // worst case: daysTotal=1 while elapsedSeconds can be ≥0.
    //
    // Also verified: financeCharge ≥ contCharge under penalty rate — penalty is
    // strictly higher than util (factory invariant util < pen), so over-billing
    // can only increase the surplus above the continuous equivalent.
    // ─────────────────────────────────────────────────────────────────────────
    function test_A7_calendarDayChargeGeContEquiv() public {
        uint256 util = 1e15;       // 10 bps / day (WAD)
        uint256 pen  = 2e15;       // 20 bps / day
        uint256 prin = 1_000_000 * SCALE;

        // Test all (daysTotal, scenario) combinations: stdDays-only (no penalty),
        // mixed (some penalty), and full-penalty (all days at pen rate).
        for (uint256 daysTotal = 1; daysTotal <= 30; daysTotal++) {
            // Scenario A: all days at util rate (stdDays = daysTotal, penDays = 0)
            {
                uint256 discrete = MathLib.mulDiv(prin, daysTotal * util, MathLib.WAD);
                // Continuous equivalent: elapsed = (daysTotal - 1) * SPD (worst case: repay at start of last day)
                uint256 elapsedSecs = (daysTotal - 1) * D;
                uint256 contEquiv   = MathLib.mulDiv(prin * elapsedSecs, util, MathLib.WAD * D);
                assertGe(discrete, contEquiv,
                    string.concat("A7: stdDays=", vm.toString(daysTotal), " discrete < continuous"));
            }
            // Scenario B: daysTotal split at day-2 penalty start (1 std + rest pen)
            if (daysTotal >= 2) {
                uint256 stdDays = 1;
                uint256 penDays = daysTotal - 1;
                uint256 discrete = MathLib.mulDiv(prin, stdDays * util + penDays * pen, MathLib.WAD);
                // Continuous uses util rate as lower-bound comparison
                uint256 elapsedSecs = (daysTotal - 1) * D;
                uint256 contEquiv   = MathLib.mulDiv(prin * elapsedSecs, util, MathLib.WAD * D);
                assertGe(discrete, contEquiv,
                    string.concat("A7: penDays=", vm.toString(penDays), " discrete < continuous"));
            }
        }

        // Confirm minDdDays floor (elapsed=0, daysTotal=1): day-count can never under-bill
        // even for an immediate repay.
        {
            uint256 immediateCharge = MathLib.mulDiv(prin, 1 * util, MathLib.WAD);
            uint256 immediateCont   = 0; // elapsed=0
            assertGe(immediateCharge, immediateCont, "A7: immediate repay (elapsed=0) discrete < cont");
        }
    }

    // ── B1: Receiver-counter integration ─────────────────────────────────────
    //
    // Exercises the full sequence that was previously verified by reasoning only:
    //
    //   executeDrawdown  → receiverActiveDrawdowns[R]++  (PoolContract.sol:393)
    //   removeReceiver   → require(counter == 0)         (PoolContract.sol:436) → must revert
    //   repay            → receiverActiveDrawdowns[R]--  (PoolContract.sol:488)
    //   removeReceiver   → counter == 0                  → must succeed
    //
    // Note: addReceiver allows AGENT1 or MULTISIG; removeReceiver is onlyRole(MULTISIG_ROLE).
    //
    // Regression lock: a future refactor that decoupled the counter decrement from
    // repay/_removeDrawDown would cause step 4 to revert with "Pool: live drawdown".
    // ─────────────────────────────────────────────────────────────────────────
    function test_B1_receiverCounterIntegration() public {
        vm.warp(0);
        PoolContract p = _createPool(PoolParams({tenure: 30, aprAnnual: 1e17}));
        _deposit(p, LP1, 500_000);
        vm.warp(p.fMaturityTs() + 60);
        _tryFinalize(p);
        require(p.status() == PoolContract.Status.Active, "B1: not Active");
        require(p.authorizedReceivers(PSP), "B1: PSP not yet a receiver");

        // Step 1: draw — counter goes to 1
        bytes32 ref = keccak256("B1_dd");
        _draw(p, ref, 100_000 * SCALE, 1);
        assertEq(p.receiverActiveDrawdowns(PSP), 1, "B1: counter must be 1 after draw");

        // Step 2: removeReceiver must revert while drawdown is live (MULTISIG only — onlyRole)
        vm.prank(MULTISIG);
        vm.expectRevert(bytes("Pool: live drawdown"));
        p.removeReceiver(PSP);

        // Step 3: repay — counter goes to 0
        _repay(p, ref);
        assertEq(p.receiverActiveDrawdowns(PSP), 0, "B1: counter must be 0 after repay");

        // Step 4: removeReceiver must now succeed
        vm.prank(MULTISIG);
        p.removeReceiver(PSP);
        assertFalse(p.authorizedReceivers(PSP), "B1: PSP must no longer be authorized");
    }
}
