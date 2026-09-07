// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";

/// @dev Minimal factory stub that recognises one registered pool.
contract MockFactory {
    mapping(address => bool) public isPoolExist;

    function register(address pool) external {
        isPoolExist[pool] = true;
    }
}

contract TreasuryReserveTest is Test {
    MockStablecoin usdc;
    TreasuryReserve treasury;
    MockFactory factory;

    address multisig = address(0xAA);
    address pool = address(0xBB);
    address nonPool = address(0xCC);

    uint256 constant WAD = 1e18;

    function setUp() public {
        usdc = new MockStablecoin();
        factory = new MockFactory();
        factory.register(pool);

        treasury = new TreasuryReserve(
            address(usdc),
            multisig,
            WAD / 10,    // reserveRate 10%
            1_000_000e6, // reserveTarget 1M USDC
            WAD / 10,    // hurdleFrac 10%
            WAD / 5      // lpBonusShare 20%
        );
        vm.prank(multisig);
        treasury.setFactory(address(factory));
    }

    // ── Caller gating ──────────────────────────────────────────────────────

    function test_drawReserve_revertsForNonPool() public {
        vm.prank(nonPool);
        vm.expectRevert("TR: not a pool");
        treasury.drawReserve(100e6);
    }

    function test_topUp_revertsForNonPool() public {
        vm.prank(nonPool);
        vm.expectRevert("TR: not a pool");
        treasury.topUp(100e6);
    }

    function test_depositImFees_revertsForNonPool() public {
        vm.prank(nonPool);
        vm.expectRevert("TR: not a pool");
        treasury.depositImFees(100e6);
    }

    // ── Segregation ────────────────────────────────────────────────────────

    function test_segregation_topUpDoesNotTouchImFees() public {
        usdc.mint(pool, 500e6);
        vm.startPrank(pool);
        usdc.approve(address(treasury), 500e6);
        treasury.topUp(500e6);
        vm.stopPrank();

        assertEq(treasury.reserveBalance(), 500e6, "reserve");
        assertEq(treasury.imFeesBalance(), 0, "imFees untouched");
        assertEq(usdc.balanceOf(address(treasury)), 500e6, "token balance");
    }

    function test_segregation_depositImFeesDoesNotTouchReserve() public {
        usdc.mint(pool, 200e6);
        vm.startPrank(pool);
        usdc.approve(address(treasury), 200e6);
        treasury.depositImFees(200e6);
        vm.stopPrank();

        assertEq(treasury.imFeesBalance(), 200e6, "imFees");
        assertEq(treasury.reserveBalance(), 0, "reserve untouched");
    }

    function test_segregation_bothBucketsIndependent() public {
        usdc.mint(pool, 700e6);
        vm.startPrank(pool);
        usdc.approve(address(treasury), 700e6);
        treasury.topUp(500e6);
        treasury.depositImFees(200e6);
        vm.stopPrank();

        assertEq(treasury.reserveBalance(), 500e6);
        assertEq(treasury.imFeesBalance(), 200e6);
        assertEq(usdc.balanceOf(address(treasury)), 700e6);
    }

    // ── drawReserve ────────────────────────────────────────────────────────

    function test_drawReserve_fullAmount() public {
        // fund reserve
        usdc.mint(pool, 500e6);
        vm.startPrank(pool);
        usdc.approve(address(treasury), 500e6);
        treasury.topUp(500e6);
        // draw
        uint256 drawn = treasury.drawReserve(300e6);
        vm.stopPrank();

        assertEq(drawn, 300e6, "drawn");
        assertEq(treasury.reserveBalance(), 200e6, "reserve after");
        assertEq(usdc.balanceOf(pool), 300e6, "pool received");
    }

    function test_drawReserve_clampedToBalance() public {
        usdc.mint(pool, 100e6);
        vm.startPrank(pool);
        usdc.approve(address(treasury), 100e6);
        treasury.topUp(100e6);
        uint256 drawn = treasury.drawReserve(999e6);
        vm.stopPrank();

        assertEq(drawn, 100e6, "clamped");
        assertEq(treasury.reserveBalance(), 0, "exhausted");
    }

    // ── Withdrawal (multisig-only) ─────────────────────────────────────────

    function test_withdrawReserve_onlyOwner() public {
        vm.prank(nonPool);
        vm.expectRevert();
        treasury.withdrawReserve(nonPool, 1e6);
    }

    function test_withdrawImFees_onlyOwner() public {
        vm.prank(nonPool);
        vm.expectRevert();
        treasury.withdrawImFees(nonPool, 1e6);
    }

    // ── reserveShortfallToTarget ───────────────────────────────────────────

    function test_shortfall() public {
        assertEq(treasury.reserveShortfallToTarget(), 1_000_000e6, "full shortfall at start");

        usdc.mint(pool, 400_000e6);
        vm.startPrank(pool);
        usdc.approve(address(treasury), 400_000e6);
        treasury.topUp(400_000e6);
        vm.stopPrank();

        assertEq(treasury.reserveShortfallToTarget(), 600_000e6, "partial fill");
    }
}
