// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";

// ─────────────────────────────────────────────────────────────────────────────
// I18 — LP position floor invariant
//
// Invariant: for every LP, pos.principal == 0 OR pos.principal >= pool.minDeposit().
//
// The original fuzz campaign (PoolInvariants.t.sol, I0–I17) used minDeposit=0
// throughout, making any position-floor invariant trivially satisfied.  This
// suite runs with minDeposit = 0.5 SCALE so the property is non-trivial and
// the fuzzer can find violations if the withdraw guard is absent.
//
// The break-test demonstrates the invariant fires by corrupting a position
// directly via vm.store — the same technique used by I1–I17 break-tests.
// ─────────────────────────────────────────────────────────────────────────────

// ── Handler ──────────────────────────────────────────────────────────────────

contract FloorHandler is Test {
    uint256 public constant SCALE   = 1e12;
    uint256 public constant MIN_DEP = 5e11;  // 0.5 SCALE — the pool's minDeposit
    uint256 constant D              = 86400;

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant PSP      = address(0x5555);
    address public constant LP_A = address(0xAAAA);
    address public constant LP_B = address(0xBBBB);

    MockStablecoin  public usdc;
    TreasuryReserve public treasury;
    PoolFactory     public factory;
    PoolContract    public pool;

    constructor() {
        vm.warp(0);
        usdc = new MockStablecoin();
        PoolContract impl = new PoolContract();
        treasury = new TreasuryReserve(address(usdc), MULTISIG, 1e17, 1_000_000 * SCALE, 1e18, 0);
        factory  = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * D, 25e16, 3, 1, 7
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);

        vm.prank(DEPLOYER);
        address p = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 5 * D,
            softCap:             3 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              30,
            idleRateDaily:       5e14,
            utilizedRateDaily:   5e14,
            penaltyRateDaily:    1e15,
            penaltyGraceDays:    2,
            minDeposit:          MIN_DEP,
            aprAnnual:           1e17,
            agent1:              AGENT1,
            agent2:              AGENT1,
            multisig:            MULTISIG
        }));
        pool = PoolContract(p);

        usdc.mint(LP_A, 1000 * SCALE);
        usdc.mint(LP_B, 1000 * SCALE);
        vm.prank(LP_A); usdc.approve(address(pool), type(uint256).max);
        vm.prank(LP_B); usdc.approve(address(pool), type(uint256).max);
    }

    function handler_deposit(uint256 amount, uint256 lpSeed) external {
        if (pool.status() != PoolContract.Status.Funding) return;
        amount = bound(amount, MIN_DEP, 2 * SCALE);
        address lp = lpSeed % 2 == 0 ? LP_A : LP_B;
        if (pool.principal() + amount > pool.hardCap()) return;
        vm.prank(lp);
        try pool.deposit(amount) {} catch {}
    }

    // Attempts arbitrary partial or full withdrawals. After the fix, amounts that
    // would leave a sub-minimum non-zero remainder revert with the new guard —
    // the try/catch swallows those reverts so the fuzzer continues. The invariant
    // is then checked against the resulting state, which must satisfy the floor.
    function handler_withdraw(uint256 amount, uint256 lpSeed) external {
        PoolContract.Status s = pool.status();
        if (s != PoolContract.Status.Funding && s != PoolContract.Status.Unsuccessful) return;
        address lp = lpSeed % 2 == 0 ? LP_A : LP_B;
        (uint256 pos,,,,,,,, ) = pool.lpPositions(lp);
        if (pos == 0) return;
        amount = bound(amount, 1, pos);
        vm.prank(lp);
        try pool.withdraw(amount) {} catch {}
    }

    function handler_finalize() external {
        if (pool.status() != PoolContract.Status.Funding) return;
        if (block.timestamp < pool.fMaturityTs()) vm.warp(pool.fMaturityTs());
        try pool.finalizeFunding() {} catch {}
    }

    // Break-test helper: overwrite LP's pos.principal to val, bypassing the withdraw guard.
    // lpPositions mapping is at storage slot 58; LPPosition.principal is at struct depth 0.
    function helper_corruptLpPrincipal_forTest(address lp, uint256 val) external {
        bytes32 base = keccak256(abi.encode(lp, uint256(58)));
        vm.store(address(pool), base, bytes32(val));
    }
}

// ── Invariant test ───────────────────────────────────────────────────────────

contract PositionFloorInvariants is Test {
    FloorHandler handler;

    function setUp() public {
        handler = new FloorHandler();
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.handler_deposit.selector;
        selectors[1] = handler.handler_withdraw.selector;
        selectors[2] = handler.handler_finalize.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    // ── I18: LP position floor ────────────────────────────────────────────────
    //
    // Every non-zero LP principal must be at or above minDeposit.  A position
    // at exactly zero is a full exit and is allowed; anything in (0, minDeposit)
    // is a dust state the design forbids and the original code silently permitted.
    //
    // This invariant is non-trivially evaluated: the handler uses minDeposit=0.5
    // SCALE and the fuzzer will attempt withdraw amounts that create dust remainders
    // — each such attempt now reverts, keeping the invariant green.  Remove the fix
    // (the two lines added to withdraw() in PoolContract.sol) and this invariant
    // fires within a handful of fuzzer runs.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I18_positionFloor() public view {
        PoolContract p     = handler.pool();
        uint256      floor = p.minDeposit();
        if (floor == 0) return; // trivially satisfied; non-trivial only when floor > 0

        address[2] memory lps = [handler.LP_A(), handler.LP_B()];
        for (uint256 i = 0; i < 2; i++) {
            (uint256 prin,,,,,,,, ) = p.lpPositions(lps[i]);
            if (prin == 0) continue;
            assertGe(prin, floor, "I18: LP position is below minDeposit floor");
        }
    }

    // ── I18 break ─────────────────────────────────────────────────────────────
    //
    // Deposits exactly minDeposit from LP_A — invariant holds.
    // Corrupts LP_A.principal to 1 wei via vm.store (the state the old contract
    // could produce via partial withdraw, now blocked by the fix).
    // Confirms the invariant fires on the corrupted state.
    // ─────────────────────────────────────────────────────────────────────────
    function test_I18_breakVerification() public {
        PoolContract p     = handler.pool();
        uint256      floor = p.minDeposit();

        vm.prank(handler.LP_A());
        p.deposit(floor); // exactly the minimum — invariant must hold

        assertTrue(_i18Ok(), "I18 should hold after correct minimum deposit");

        // Corrupt LP_A.principal to 1 wei — bypasses the withdraw guard
        handler.helper_corruptLpPrincipal_forTest(handler.LP_A(), 1);

        (uint256 prin,,,,,,,, ) = p.lpPositions(handler.LP_A());
        assertEq(prin, 1, "corruption: principal is now 1 wei");
        assertTrue(prin > 0 && prin < floor, "corruption: sub-floor non-zero position created");

        assertFalse(_i18Ok(), "I18 must fire: LP_A.principal is below minDeposit floor");
    }

    function _i18Ok() internal view returns (bool) {
        PoolContract p     = handler.pool();
        uint256      floor = p.minDeposit();
        if (floor == 0) return true;
        address[2] memory lps = [handler.LP_A(), handler.LP_B()];
        for (uint256 i = 0; i < 2; i++) {
            (uint256 prin,,,,,,,, ) = p.lpPositions(lps[i]);
            if (prin > 0 && prin < floor) return false;
        }
        return true;
    }
}
