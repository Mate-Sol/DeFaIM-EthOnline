// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";

/// @dev Phase 3A — Gas profiling.
///
/// Two test groups:
///
/// 1. Lifecycle tests — one call per external function exercising each interesting
///    code path.  `forge test --gas-report` aggregates min/avg/max across these.
///
/// 2. N-curve tests — executeDrawdown measured at N = 1..32 concurrent open
///    drawdowns, with the overdue circuit-breaker both ON and OFF.
///    Gas numbers are emitted as console.log("gas:fn:mode:N=x=gas") for extraction.
///
/// Anchor chain: Ethereum mainnet, block gas limit 30 000 000.
/// Operational guidance: when executeDrawdown gas in breaker-ON mode exceeds ~1 000 000
/// (≈3.3% of block), the operator should toggle scOverdueCheck=false and switch to
/// manual overdue monitoring.
contract GasProfile is Test {

    uint256 constant SCALE = 1e12;
    uint256 constant WAD   = 1e18;
    uint256 constant D     = 86400;
    uint256 constant LOCK  = 5 * D;
    uint256 constant TENOR = 30;
    uint256 constant MAT   = LOCK + TENOR * D;

    address LP_A    = address(0xAAAA);
    address LP_B    = address(0xBBBB);
    address PSP     = address(0x5555);
    address AGENT1  = address(0x3333);
    address AGENT2  = address(0x4444);
    address MULTISIG = address(0x1111);
    address DEPLOYER = address(0x2222);

    MockStablecoin  usdc;
    TreasuryReserve treasury;
    PoolFactory     factory;

    // ── shared setup ─────────────────────────────────────────────────────────────

    function _deploy(uint256 hardCapM) internal returns (PoolContract pool) {
        vm.warp(0);   // ensure pool creates at ts=0 so fMaturityTs == LOCK exactly
        usdc     = new MockStablecoin();
        PoolContract impl = new PoolContract();
        treasury = new TreasuryReserve(
            address(usdc), MULTISIG, 1e17, 1_000_000 * SCALE, WAD, 0
        );
        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * 86400, 25e16, 3, 1, 7
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);

        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           hardCapM * 1_000_000 * SCALE,
            tenure:            TENOR,
            idleRateDaily:     5e14,
            utilizedRateDaily: 5e14,
            penaltyRateDaily:  1e15,
            penaltyGraceDays:  2,
            minDeposit:        0,
            aprAnnual:         1e17,
            agent1:            AGENT1,
            agent2:            AGENT2,
            multisig:          MULTISIG
        }));
        pool = PoolContract(addr);
    }

    function _depositAndLock(PoolContract pool, uint256 amountUSDC) internal {
        usdc.mint(LP_A, amountUSDC * SCALE);
        vm.prank(LP_A); usdc.approve(address(pool), type(uint256).max);
        vm.prank(LP_A); pool.deposit(amountUSDC * SCALE);
        vm.warp(LOCK);
        pool.finalizeFunding();
        require(pool.status() == PoolContract.Status.Active, "setup: not active");
    }

    function _draw(PoolContract pool, bytes32 ref, uint256 amtUSDC, uint256 settle) internal {
        vm.prank(AGENT2); pool.executeDrawdown(ref, PSP, amtUSDC * SCALE, settle);
    }

    function _repay(PoolContract pool, bytes32 ref) internal {
        (, , uint256 total) = pool.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.prank(PSP); usdc.approve(address(pool), total);
        vm.prank(PSP); pool.repay(ref);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    //  Lifecycle gas tests — `forge test --gas-report` accumulates min/avg/max
    // ══════════════════════════════════════════════════════════════════════════════

    function testGas_deposit() public {
        PoolContract pool = _deploy(9);
        usdc.mint(LP_A, 1_000_000 * SCALE);
        vm.prank(LP_A); usdc.approve(address(pool), type(uint256).max);
        vm.prank(LP_A); pool.deposit(1_000_000 * SCALE);          // first deposit (no prior state)
        usdc.mint(LP_B, 500_000 * SCALE);
        vm.prank(LP_B); usdc.approve(address(pool), type(uint256).max);
        vm.prank(LP_B); pool.deposit(500_000 * SCALE);            // second deposit (warm state)
    }

    function testGas_withdraw() public {
        PoolContract pool = _deploy(9);
        usdc.mint(LP_A, 1_000_000 * SCALE);
        vm.prank(LP_A); usdc.approve(address(pool), type(uint256).max);
        vm.prank(LP_A); pool.deposit(1_000_000 * SCALE);
        vm.prank(LP_A); pool.withdraw(500_000 * SCALE);           // partial withdrawal
    }

    function testGas_finalizeFunding_active() public {
        PoolContract pool = _deploy(9);
        usdc.mint(LP_A, 1_000_000 * SCALE);
        vm.prank(LP_A); usdc.approve(address(pool), type(uint256).max);
        vm.prank(LP_A); pool.deposit(1_000_000 * SCALE);
        vm.warp(LOCK);
        pool.finalizeFunding();                                    // success path
    }

    function testGas_finalizeFunding_unsuccessful() public {
        PoolContract pool = _deploy(9);
        // No deposits → unsuccessful finalization
        vm.warp(LOCK);
        pool.finalizeFunding();
    }

    function testGas_executeDrawdown_N0() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        vm.prank(AGENT2); pool.executeDrawdown(bytes32("r1"), PSP, 100_000 * SCALE, 3);  // 0 existing draws
    }

    function testGas_repay_stdDays() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        _draw(pool, bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 2 * D);   // 2 days elapsed → std (< penaltyStart = 6)
        _repay(pool, bytes32("r1"));
    }

    function testGas_repay_penaltyDays() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        _draw(pool, bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 10 * D);  // 10 days → penDays > 0
        _repay(pool, bytes32("r1"));
    }

    function testGas_payAccruedIdleFees_noClose() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        vm.warp(LOCK + 10 * D);
        (, , uint256 owed) = pool.getIdleFeesBreakdown();
        usdc.mint(PSP, owed);
        vm.prank(PSP); usdc.approve(address(pool), owed);
        vm.prank(PSP); pool.payAccruedIdleFees(owed);               // mid-life, pool stays Active
    }

    function testGas_payAccruedIdleFees_triggers_close() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        vm.warp(MAT + D);
        (, , uint256 owed) = pool.getIdleFeesBreakdown();
        usdc.mint(PSP, owed);
        vm.prank(PSP); usdc.approve(address(pool), owed);
        vm.prank(PSP); pool.payAccruedIdleFees(owed);               // triggers _mature + _checkFinality
    }

    function testGas_claimYield_preMaturity() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        _draw(pool, bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 2 * D);
        _repay(pool, bytes32("r1"));       // pushes yield into collectedYield
        vm.prank(LP_A); pool.claimYield();
    }

    function testGas_claimYield_postClose() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        _draw(pool, bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 2 * D); _repay(pool, bytes32("r1"));
        vm.warp(MAT + D);
        (, , uint256 owed) = pool.getIdleFeesBreakdown();
        usdc.mint(PSP, owed);
        vm.prank(PSP); usdc.approve(address(pool), owed);
        vm.prank(PSP); pool.payAccruedIdleFees(owed);
        vm.prank(LP_A); pool.claimYield();
    }

    function testGas_claimPrincipal_postClose() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        _draw(pool, bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 2 * D); _repay(pool, bytes32("r1"));
        vm.warp(MAT + D);
        (, , uint256 owed) = pool.getIdleFeesBreakdown();
        usdc.mint(PSP, owed);
        vm.prank(PSP); usdc.approve(address(pool), owed);
        vm.prank(PSP); pool.payAccruedIdleFees(owed);
        vm.prank(LP_A); pool.claimPrincipal();
    }

    function testGas_declareDefault() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        _draw(pool, bytes32("r1"), 100_000, 3);
        vm.warp(MAT + D);
        vm.prank(AGENT2); pool.declareDefault();
    }

    function testGas_sweepProtocolFees() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        _draw(pool, bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 2 * D); _repay(pool, bytes32("r1"));
        vm.warp(MAT + D);
        (, , uint256 owed) = pool.getIdleFeesBreakdown();
        usdc.mint(PSP, owed);
        vm.prank(PSP); usdc.approve(address(pool), owed);
        vm.prank(PSP); pool.payAccruedIdleFees(owed);
        vm.prank(MULTISIG); pool.sweepProtocolFees();
    }

    function testGas_setScOverdue_off_N5() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 6_000_000);
        for (uint256 n = 1; n <= 5; n++) {
            bytes32 ref = bytes32(n);
            _draw(pool, ref, 500_000, 6);          // settles at day 12, non-overdue at lock
        }
        // setScOverdue(false) loops over all N draws once
        vm.prank(AGENT1); pool.setScOverdue(false);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    //  N-curve tests — gas vs concurrent open drawdowns
    //
    //  Methodology:
    //    1. Deploy pool with capacity for N_MAX + 1 draws.
    //    2. Execute N draws at lock_ts with settleDays=6 (non-overdue for 7 days).
    //    3. Measure gas for the (N+1)th executeDrawdown.
    //    4. Repeat for N = 0..N_MAX in both breaker-ON and breaker-OFF modes.
    //
    //  Emits "gas:fn:mode:N=n=g" for each measurement so the caller can parse
    //  the curve from forge test -vv output.
    // ══════════════════════════════════════════════════════════════════════════════

    uint256 constant N_MAX = 32;

    function testNCurve_executeDrawdown_overdueOn_sweep() public {
        PoolContract pool = _deploy(9);
        // Enough principal for N_MAX+1 draws of 100k each
        _depositAndLock(pool, 4_000_000);

        // scOverdueCheck is ON by default
        for (uint256 n = 0; n <= N_MAX; n++) {
            if (n > 0) {
                bytes32 prevRef = bytes32(n);
                _draw(pool, prevRef, 100_000, 6);     // add one existing draw
            }
            // Measure gas for executeDrawdown with n existing draws
            bytes32 nextRef = bytes32(uint256(100) + n);
            uint256 g0 = gasleft();
            vm.prank(AGENT2);
            pool.executeDrawdown(nextRef, PSP, 10_000 * SCALE, 6);
            uint256 gasUsed = g0 - gasleft();
            console.log(string.concat(
                "gas:executeDrawdown:overdueOn:N=", vm.toString(n), "=", vm.toString(gasUsed)
            ));
        }
    }

    function testNCurve_executeDrawdown_overdueOff_sweep() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 4_000_000);
        // Pre-create N_MAX draws
        for (uint256 n = 1; n <= N_MAX; n++) {
            _draw(pool, bytes32(n), 100_000, 6);
        }
        // Turn off overdue check
        vm.prank(AGENT1); pool.setScOverdue(false);
        // Now measure with all N_MAX draws in drawDownRefs but O(1) check
        uint256 g0 = gasleft();
        vm.prank(AGENT2);
        pool.executeDrawdown(bytes32(uint256(200)), PSP, 10_000 * SCALE, 6);
        uint256 gasUsed = g0 - gasleft();
        console.log(string.concat(
            "gas:executeDrawdown:overdueOff:N=", vm.toString(N_MAX), "=", vm.toString(gasUsed)
        ));
    }

    function testNCurve_executeDrawdown_overdueOn() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 4_000_000);

        for (uint256 n = 0; n <= N_MAX; n++) {
            if (n > 0) {
                _draw(pool, bytes32(n), 100_000, 6);
            }
            // Measure gas for single-step executeDrawdown with n existing draws
            bytes32 nextRef = bytes32(uint256(100) + n);
            uint256 g0 = gasleft();
            vm.prank(AGENT2);
            pool.executeDrawdown(nextRef, PSP, 10_000 * SCALE, 6);
            uint256 gasUsed = g0 - gasleft();
            console.log(string.concat(
                "gas:executeDrawdown:overdueOn:N=", vm.toString(n), "=", vm.toString(gasUsed)
            ));
        }
    }

    function testNCurve_executeDrawdown_overdueOff() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 4_000_000);
        for (uint256 n = 1; n <= N_MAX; n++) {
            _draw(pool, bytes32(n), 100_000, 6);
        }
        vm.prank(AGENT1); pool.setScOverdue(false);
        uint256 g0 = gasleft();
        vm.prank(AGENT2);
        pool.executeDrawdown(bytes32(uint256(200)), PSP, 10_000 * SCALE, 6);
        uint256 gasUsed = g0 - gasleft();
        console.log(string.concat(
            "gas:executeDrawdown:overdueOff:N=", vm.toString(N_MAX), "=", vm.toString(gasUsed)
        ));
    }

    // One-off O(N) cost: setScOverdue(false) loops over all draws during toggle
    function testNCurve_setScOverdue_off() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 4_000_000);
        for (uint256 n = 1; n <= N_MAX; n++) {
            _draw(pool, bytes32(n), 100_000, 6);
        }
        uint256 g0 = gasleft();
        vm.prank(AGENT1); pool.setScOverdue(false);
        uint256 gasUsed = g0 - gasleft();
        console.log(string.concat(
            "gas:setScOverdue:off:N=", vm.toString(N_MAX), "=", vm.toString(gasUsed)
        ));
    }

    // Confirm maturity sweep / _mature is O(1) (no loop)
    function testGas_mature_O1() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        vm.warp(MAT + D);
        (, , uint256 owed) = pool.getIdleFeesBreakdown();
        usdc.mint(PSP, owed);
        vm.prank(PSP); usdc.approve(address(pool), owed);
        uint256 g0 = gasleft();
        vm.prank(PSP); pool.payAccruedIdleFees(owed);   // contains _mature
        console.log(string.concat("gas:mature:O1=", vm.toString(g0 - gasleft())));
    }

    // ══════════════════════════════════════════════════════════════════════════════
    //  Receiver management (new in v5 — replaces order-book)
    // ══════════════════════════════════════════════════════════════════════════════

    function testGas_addReceiver() public {
        PoolContract pool = _deploy(9);
        // PSP is already authorized via initialize(); measure cold-slot write for a new receiver.
        usdc.mint(LP_A, 1_000_000 * SCALE);
        vm.prank(LP_A); usdc.approve(address(pool), type(uint256).max);
        vm.prank(LP_A); pool.deposit(1_000_000 * SCALE);
        vm.warp(LOCK); pool.finalizeFunding();
        vm.prank(AGENT1); pool.addReceiver(address(0xBEEF));   // cold mapping write, first add
        vm.prank(AGENT1); pool.addReceiver(address(0xCAFE));   // cold write, second receiver
    }

    function testGas_removeReceiver() public {
        PoolContract pool = _deploy(9);
        usdc.mint(LP_A, 1_000_000 * SCALE);
        vm.prank(LP_A); usdc.approve(address(pool), type(uint256).max);
        vm.prank(LP_A); pool.deposit(1_000_000 * SCALE);
        vm.warp(LOCK); pool.finalizeFunding();
        // PSP is already authorized from initialize(); remove it directly.
        vm.prank(MULTISIG); pool.removeReceiver(PSP);           // counter read + mapping write
    }

    // ══════════════════════════════════════════════════════════════════════════════
    //  setPaused
    // ══════════════════════════════════════════════════════════════════════════════

    function testGas_setPaused() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        // setPaused requires scOverdueCheck=false (manual-pause mode)
        vm.prank(AGENT1); pool.setScOverdue(false);
        vm.prank(AGENT1); pool.setPaused(true);    // O(1)
        vm.prank(AGENT1); pool.setPaused(false);   // O(1)
    }

    // ══════════════════════════════════════════════════════════════════════════════
    //  Default settlement
    // ══════════════════════════════════════════════════════════════════════════════

    function testGas_settleDefaultPrincipal() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        _draw(pool, bytes32("r1"), 100_000, 3);
        vm.warp(MAT + D);
        vm.prank(AGENT2); pool.declareDefault();
        // amount clamped internally to actual shortfall (~100k + idle fees)
        uint256 amt = 500_000 * SCALE;
        usdc.mint(MULTISIG, amt);
        vm.prank(MULTISIG); usdc.approve(address(pool), amt);
        vm.prank(MULTISIG); pool.settleDefaultPrincipal(amt);
    }

    function testGas_settleDefaultYield() public {
        PoolContract pool = _deploy(9);
        _depositAndLock(pool, 1_000_000);
        _draw(pool, bytes32("r1"), 100_000, 3);
        vm.warp(MAT + D);
        vm.prank(AGENT2); pool.declareDefault();
        // Settle principal first (required by settleDefaultYield)
        uint256 pAmt = 500_000 * SCALE;
        usdc.mint(MULTISIG, pAmt);
        vm.prank(MULTISIG); usdc.approve(address(pool), pAmt);
        vm.prank(MULTISIG); pool.settleDefaultPrincipal(pAmt);
        // Settle yield + overrun (clamped internally to actual owed)
        uint256 yAmt = 500_000 * SCALE;
        usdc.mint(MULTISIG, yAmt);
        vm.prank(MULTISIG); usdc.approve(address(pool), yAmt);
        vm.prank(MULTISIG); pool.settleDefaultYield(yAmt);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    //  Factory functions
    // ══════════════════════════════════════════════════════════════════════════════

    function testGas_factory_createPool() public {
        _deploy(9);   // factory.createPool is called inside _deploy; gas-report captures it
    }

    function testGas_factory_approvePsp() public {
        _deploy(9);
        vm.prank(MULTISIG); factory.approvePsp(address(0xBEEF));   // cold slot, new address
    }

    function testGas_factory_setEnvelope() public {
        _deploy(9);
        // All 13 fields differ from constructor defaults so every SSTORE is a real write:
        // 5 zero→nonzero slots (minApr, minPgd, minIdleRate, minUtilRate, minPenRate) + 8 nonzero→nonzero.
        vm.prank(MULTISIG); factory.setEnvelope(PoolFactory.Envelope({
            minApr:         5e16,              // was 0          → nonzero (cold zero→nz)
            maxApr:         3e17,              // was max        → different nonzero
            minTenure:      7,                 // was 1          → different nonzero
            maxTenure:      180,               // was max        → different nonzero
            minPgd:         1,                 // was 0          → nonzero (cold zero→nz)
            maxPgd:         30,                // was 3          → different nonzero
            minIdleRate:    1e13,              // was 0          → nonzero (cold zero→nz)
            maxIdleRate:    5e15,              // was max        → different nonzero
            minUtilRate:    1e13,              // was 0          → nonzero (cold zero→nz)
            maxUtilRate:    5e15,              // was max        → different nonzero
            minPenRate:     1e13,              // was 0          → nonzero (cold zero→nz)
            maxPenRate:     2e15,              // was max        → different nonzero
            hardCapCeiling: 100_000_000 * SCALE // was max       → different nonzero
        }));
    }

    function testGas_factory_setBounds() public {
        _deploy(9);
        // All 5 fields differ from constructor defaults (was 30d/25e16/3/1/7) so every SSTORE is a real write.
        vm.prank(MULTISIG); factory.setBounds(
            60 * 86400,   // maxFundingDurationSecs (was 30 * 86400)
            50e16,        // fundingExecBufferDays  (was 25e16)
            7,            // maxGracePeriodDays     (was 3)
            2,            // minDdDays              (was 1)
            14            // maxDdDays              (was 7)
        );
    }

    // ══════════════════════════════════════════════════════════════════════════════
    //  Treasury internals (via pool impersonation — onlyPool uses isPoolExist)
    // ══════════════════════════════════════════════════════════════════════════════

    function testGas_treasury_topUp() public {
        PoolContract pool = _deploy(9);
        uint256 amt = 100_000 * SCALE;
        usdc.mint(address(pool), amt);
        vm.prank(address(pool)); usdc.approve(address(treasury), amt);
        vm.prank(address(pool)); treasury.topUp(amt);
    }

    function testGas_treasury_drawReserve() public {
        PoolContract pool = _deploy(9);
        uint256 amt = 100_000 * SCALE;
        // Seed reserve via topUp first, then draw
        usdc.mint(address(pool), amt);
        vm.prank(address(pool)); usdc.approve(address(treasury), amt);
        vm.prank(address(pool)); treasury.topUp(amt);
        vm.prank(address(pool)); treasury.drawReserve(amt);
    }

    function testGas_treasury_depositImFees() public {
        PoolContract pool = _deploy(9);
        uint256 amt = 10_000 * SCALE;
        usdc.mint(address(pool), amt);
        vm.prank(address(pool)); usdc.approve(address(treasury), amt);
        vm.prank(address(pool)); treasury.depositImFees(amt);
    }

    // ══════════════════════════════════════════════════════════════════════════════
    //  Extended N-curve: specific checkpoints N = 0, 5, 10, 25, 50, 100
    //
    //  Each checkpoint uses a fresh pool with exactly N pre-existing open draws so
    //  drawDownRefs.length is unambiguous.  Background draws: 100k SCALE (matching
    //  the existing sweep tests for consistency).  Measurement draw: 10k SCALE.
    //  Pool capacity: 11M deposit — accommodates 100 × 100k = 10M background
    //  + 6 × 10k measurement draws with room to spare.
    //
    //  overdueOn:  measures the O(N) _hasOverdueUnsettled() loop.
    //  overdueOff: measures the O(1) flat baseline with scOverdueCheck=false.
    // ══════════════════════════════════════════════════════════════════════════════

    function _poolForCheckpoint(uint256 N) internal returns (PoolContract) {
        PoolContract pool = _deploy(11);   // _deploy includes vm.warp(0)
        _depositAndLock(pool, 10_500_000);
        for (uint256 n = 1; n <= N; n++) {
            _draw(pool, bytes32(n), 100_000, 6);
        }
        return pool;
    }

    function testNCurve_checkpoints_overdueOn() public {
        uint256[6] memory Ns;
        Ns[0] = 0; Ns[1] = 5; Ns[2] = 10; Ns[3] = 25; Ns[4] = 50; Ns[5] = 100;

        for (uint256 ci = 0; ci < 6; ci++) {
            uint256 N = Ns[ci];
            PoolContract pool = _poolForCheckpoint(N);
            bytes32 nextRef = bytes32(uint256(2000) + ci);
            uint256 g0 = gasleft();
            vm.prank(AGENT2);
            pool.executeDrawdown(nextRef, PSP, 10_000 * SCALE, 6);
            uint256 gasUsed = g0 - gasleft();
            console.log(string.concat(
                "gas:executeDrawdown:checkpointON:N=", vm.toString(N), "=", vm.toString(gasUsed)
            ));
        }
    }

    function testNCurve_checkpoints_overdueOff() public {
        uint256[6] memory Ns;
        Ns[0] = 0; Ns[1] = 5; Ns[2] = 10; Ns[3] = 25; Ns[4] = 50; Ns[5] = 100;

        for (uint256 ci = 0; ci < 6; ci++) {
            uint256 N = Ns[ci];
            PoolContract pool = _poolForCheckpoint(N);
            vm.prank(AGENT1); pool.setScOverdue(false);   // O(N) setup, not measured
            bytes32 nextRef = bytes32(uint256(3000) + ci);
            uint256 g0 = gasleft();
            vm.prank(AGENT2);
            pool.executeDrawdown(nextRef, PSP, 10_000 * SCALE, 6);
            uint256 gasUsed = g0 - gasleft();
            console.log(string.concat(
                "gas:executeDrawdown:checkpointOFF:N=", vm.toString(N), "=", vm.toString(gasUsed)
            ));
        }
    }
}
