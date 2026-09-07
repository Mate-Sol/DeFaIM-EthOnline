// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Forge-side confirmation for verify_seed9000.py.
///
/// Runs the exact seed=9000 overrun scenario and reads pool.accIdleFees()
/// after repay and pool.getIdleFeesBreakdown() at end_ts.
/// Expected values are the exact-Fraction floors proved in verify_seed9000.py:
///   accIdleFees  = 29_805_372_000_000_000
///   accPenalty   = 29_805_372_000_000     (= accIdleFees / 1000, exact)
///   Δ_pf         = 26_824_834_800_000     (= accPenalty × 0.9)
contract VerifyAccrualTest is Test {
    uint256 constant SCALE = 1e12;
    uint256 constant D     = 86400;

    // Pool parameters (identical to diff_harness defaults)
    uint256 constant APR       = 1e17;   // 10 % annual
    uint256 constant IDLE_RATE = 5e14;   // 0.05 % per day
    uint256 constant UTIL_RATE = 5e14;
    uint256 constant PEN_RATE  = 1e15;   // 0.10 % per day
    uint256 constant PGD       = 2;      // penaltyGraceDays
    uint256 constant TENURE    = 30;
    uint256 constant RESERVE_RATE   = 1e17;
    uint256 constant RESERVE_TARGET = 1_000_000 * SCALE;
    uint256 constant HURDLE_FRAC    = 1e18;
    uint256 constant LP_BONUS       = 0;

    // Timing (seed=9000)
    uint256 constant LOCK_TS   = 432000;              // 5D
    uint256 constant MATURITY  = LOCK_TS + TENURE*D;  // 3024000
    uint256 constant DRAW_TS   = 1555200;             // day 18
    uint256 constant REPAY_TS  = MATURITY + 2*D;      // 3196800 = maturity + graceSecs
    uint256 constant END_TS    = REPAY_TS + D;        // 3283200 = maturity + 3D

    // Amounts (seed=9000)
    uint256 constant DEP_A     = 804_394  * SCALE;
    uint256 constant DEP_B     = 1_348_748 * SCALE;
    uint256 constant DRAW_AMT  = 293_148  * SCALE;

    // Proved exact values (verify_seed9000.py)
    uint256 constant EXP_ACC_IDLE    = 29_805_372_000_000_000;
    uint256 constant EXP_ACC_PENALTY = 29_805_372_000_000;

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant LP_A     = address(0xAAAA);
    address constant LP_B     = address(0xBBBB);

    bytes32 constant REF_O1   = keccak256("o1");

    MockStablecoin usdc;
    TreasuryReserve treasury;
    PoolFactory    factory;
    PoolContract   impl;
    PoolContract   pool;

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
            30 * 86400, // maxFundingDurationSecs (30 days)
            25e16,  // fundingExecBufferDays (WAD fraction = 0.25 day)
            3,      // maxGracePeriodDays
            1,      // minDdDays
            7      // maxDdDays
        );

        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);

        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:        PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:          1 * SCALE,
            hardCap:          9_000_000 * SCALE,
            tenure:           TENURE,
            idleRateDaily:    IDLE_RATE,
            utilizedRateDaily: UTIL_RATE,
            penaltyRateDaily: PEN_RATE,
            penaltyGraceDays: PGD,
            minDeposit:       0,
            aprAnnual:        APR,
            agent1:           AGENT1,
            agent2:           AGENT2,
            multisig:         MULTISIG
        }));
        pool = PoolContract(addr);
    }

    function test_seed9000_accIdleFees_and_accPenalty() public {
        // ── t=0: deposits ────────────────────────────────────────────────────
        usdc.mint(LP_A, DEP_A);
        vm.prank(LP_A); usdc.approve(address(pool), DEP_A);
        vm.prank(LP_A); pool.deposit(DEP_A);

        usdc.mint(LP_B, DEP_B);
        vm.prank(LP_B); usdc.approve(address(pool), DEP_B);
        vm.prank(LP_B); pool.deposit(DEP_B);

        // ── t=LOCK_TS: finalize funding ──────────────────────────────────────
        vm.warp(LOCK_TS);
        pool.finalizeFunding();
        assertEq(pool.poolFinalityTs(), MATURITY, "poolFinalityTs mismatch");
        assertEq(pool.availableToDd(),  DEP_A + DEP_B, "availableToDd mismatch");

        // ── t=DRAW_TS: execute draw (single-step) ────────────────────────────
        vm.warp(DRAW_TS);
        vm.prank(AGENT2);
        pool.executeDrawdown(REF_O1, PSP, DRAW_AMT, 1);   // settle=1 day

        // ── t=REPAY_TS: repay ─────────────────────────────────────────────────
        vm.warp(REPAY_TS);
        (, , uint256 repayTotal) = pool.getRepaymentOwed(REF_O1);
        usdc.mint(PSP, repayTotal);
        vm.prank(PSP); usdc.approve(address(pool), repayTotal);
        vm.prank(PSP); pool.repay(REF_O1);

        // accIdleFees should now equal idle1 + idle2, no penalty yet
        uint256 actualIdle = pool.accIdleFees();
        assertEq(
            actualIdle,
            EXP_ACC_IDLE,
            "accIdleFees mismatch after repay"
        );
        assertEq(pool.accPenalty(), 0, "accPenalty must be 0 at repay_ts (t == grace boundary)");

        // ── t=END_TS: read getIdleFeesBreakdown() — view, no state change ─────────
        vm.warp(END_TS);
        (uint256 idleFees, uint256 penaltyOwed, ) = pool.getIdleFeesBreakdown();
        assertEq(idleFees,    EXP_ACC_IDLE,    "getIdleFeesBreakdown: idleFees mismatch at end_ts");
        assertEq(penaltyOwed, EXP_ACC_PENALTY, "getIdleFeesBreakdown: penaltyOwed mismatch at end_ts");

        // ── Confirm 0.9 factor ───────────────────────────────────────────────
        // accPenalty × (1 - RESERVE_RATE/WAD) must equal the harness delta
        uint256 expected_delta_pf = EXP_ACC_PENALTY * 9 / 10;
        assertEq(expected_delta_pf, 26_824_834_800_000, "0.9 factor arithmetic mismatch");
    }
}
