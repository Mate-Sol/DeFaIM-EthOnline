// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "./mocks/MockStablecoin.sol";

// ─────────────────────────────────────────────────────────────────────────────
// ERC-4626 compatibility surface.
//
// The pool is a credit facility, not a compliant tokenized vault: no share
// token, deposits confined to the funding window, redemption by waterfall.
// These tests pin the read surface and the standard event shapes that
// tokenized-vault indexers rely on, including the points where the pool
// deliberately reports zero because the standard's assumption does not hold.
// ─────────────────────────────────────────────────────────────────────────────

contract ERC4626SurfaceTest is Test {
    uint256 constant SCALE = 1e12;
    uint256 constant WAD   = 1e18;
    uint256 constant D     = 86400;
    uint256 constant TENOR = 30;
    uint256 constant LOCK  = 5 * D;

    uint256 constant IDLE_RATE = 5e14;
    uint256 constant UTIL_RATE = 5e14;
    uint256 constant PEN_RATE  = 1e15;
    uint256 constant APR       = 1e17;

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant LP_A     = address(0xAAAA);
    address constant LP_B     = address(0xBBBB);

    uint256 constant HARD_CAP = 9_000_000 * SCALE;

    MockStablecoin  usdc;
    TreasuryReserve treasury;
    PoolFactory     factory;
    PoolContract    pool;

    // ERC-4626 canonical signatures, restated here so a change to the
    // contract's event shape fails these tests rather than passing silently.
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );

    function setUp() public {
        vm.warp(0);
        usdc = new MockStablecoin();
        PoolContract impl = new PoolContract();
        treasury = new TreasuryReserve(
            address(usdc), MULTISIG, 1e17, 1_000_000 * SCALE, WAD, 0
        );
        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * D, 25e16, 3, 1, 7
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);

        vm.prank(DEPLOYER);
        pool = PoolContract(factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 5 * D,
            softCap:             1 * SCALE,
            hardCap:             HARD_CAP,
            tenure:              TENOR,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    2,
            minDeposit:          0,
            aprAnnual:           APR,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        })));
    }

    function _fund(address lp, uint256 amount) internal {
        usdc.mint(lp, amount);
        vm.prank(lp); usdc.approve(address(pool), type(uint256).max);
        vm.prank(lp); pool.deposit(amount);
    }

    // ── asset ────────────────────────────────────────────────────────────────

    function test_asset_isTheSettlementToken() public view {
        assertEq(pool.asset(), address(usdc), "asset() must report the settlement token");
    }

    // ── totals track principal ───────────────────────────────────────────────

    function test_totalAssets_emptyPool() public view {
        assertEq(pool.totalAssets(), 0);
        assertEq(pool.totalSupply(), 0);
    }

    function test_totalAssets_tracksDeposits() public {
        _fund(LP_A, 1_000 * SCALE);
        assertEq(pool.totalAssets(), 1_000 * SCALE);

        _fund(LP_B, 2_500 * SCALE);
        assertEq(pool.totalAssets(), 3_500 * SCALE, "totalAssets is the sum of LP principal");
        assertEq(pool.totalSupply(), pool.totalAssets(), "shares are 1:1 with assets");
    }

    function test_balanceOf_isLpPrincipal() public {
        _fund(LP_A, 1_000 * SCALE);
        _fund(LP_B, 2_500 * SCALE);

        assertEq(pool.balanceOf(LP_A), 1_000 * SCALE);
        assertEq(pool.balanceOf(LP_B), 2_500 * SCALE);
        assertEq(pool.balanceOf(address(0xDEAD)), 0, "a non-LP holds nothing");
    }

    function test_totalAssets_fallsOnWithdraw() public {
        _fund(LP_A, 1_000 * SCALE);
        vm.prank(LP_A); pool.withdraw(400 * SCALE);

        assertEq(pool.totalAssets(), 600 * SCALE);
        assertEq(pool.balanceOf(LP_A), 600 * SCALE);
    }

    // ── conversions are identity ─────────────────────────────────────────────

    function testFuzz_conversionsAreIdentity(uint256 amount) public view {
        assertEq(pool.convertToShares(amount), amount);
        assertEq(pool.convertToAssets(amount), amount);
        assertEq(pool.previewDeposit(amount), amount);
        assertEq(pool.previewWithdraw(amount), amount);
    }

    function test_conversionsRoundTrip() public view {
        uint256 assets = 1_234_567;
        assertEq(pool.convertToAssets(pool.convertToShares(assets)), assets);
    }

    // ── maxDeposit encodes the funding window and the hard cap ───────────────

    function test_maxDeposit_isHeadroomWhileFunding() public {
        assertEq(pool.maxDeposit(LP_A), HARD_CAP, "empty pool: full hard cap available");

        _fund(LP_A, 1_000_000 * SCALE);
        assertEq(pool.maxDeposit(LP_A), HARD_CAP - 1_000_000 * SCALE);
    }

    function test_maxDeposit_isZeroOnceLocked() public {
        _fund(LP_A, 1_000_000 * SCALE);
        vm.warp(LOCK);
        pool.finalizeFunding();

        assertEq(pool.maxDeposit(LP_A), 0, "no deposits accepted after the pool locks");
    }

    function test_maxDeposit_isZeroAtHardCap() public {
        _fund(LP_A, HARD_CAP);
        assertEq(pool.maxDeposit(LP_A), 0, "no headroom left at the hard cap");
    }

    // ── maxWithdraw closes when principal moves to the waterfall ─────────────

    function test_maxWithdraw_isPrincipalWhileFunding() public {
        _fund(LP_A, 1_000 * SCALE);
        assertEq(pool.maxWithdraw(LP_A), 1_000 * SCALE);
    }

    function test_maxWithdraw_isZeroOnceLocked() public {
        _fund(LP_A, 1_000_000 * SCALE);
        vm.warp(LOCK);
        pool.finalizeFunding();

        assertEq(
            pool.maxWithdraw(LP_A), 0,
            "after lock, principal returns via claimPrincipal() under the waterfall"
        );
    }

    // ── standard event shapes ────────────────────────────────────────────────

    function test_deposit_emitsErc4626Shape() public {
        usdc.mint(LP_A, 1_000 * SCALE);
        vm.prank(LP_A); usdc.approve(address(pool), type(uint256).max);

        vm.expectEmit(true, true, false, true, address(pool));
        emit Deposit(LP_A, LP_A, 1_000 * SCALE, 1_000 * SCALE);

        vm.prank(LP_A); pool.deposit(1_000 * SCALE);
    }

    function test_withdraw_emitsErc4626Shape() public {
        _fund(LP_A, 1_000 * SCALE);

        vm.expectEmit(true, true, true, true, address(pool));
        emit Withdraw(LP_A, LP_A, LP_A, 400 * SCALE, 400 * SCALE);

        vm.prank(LP_A); pool.withdraw(400 * SCALE);
    }

    // ── the surface stays consistent with the pool's own accounting ──────────

    function test_surfaceAgreesWithGetLpPosition() public {
        _fund(LP_A, 1_000 * SCALE);
        (uint256 principal_, , , , , ) = pool.getLpPosition(LP_A);
        assertEq(pool.balanceOf(LP_A), principal_, "balanceOf must not drift from LPPosition");
    }
}
