// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Shared base: one factory + PSP, reusable helpers
// ─────────────────────────────────────────────────────────────────────────────

contract AuditBase is Test {
    uint256 constant SCALE = 1e12;
    uint256 constant WAD   = 1e18;
    uint256 constant D     = 86400;
    uint256 constant LOCK  = 5 * D;
    uint256 constant TENOR = 30;
    uint256 constant MAT   = LOCK + TENOR * D;

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant PSP2     = address(0x6666);
    address constant LP_A     = address(0xAAAA);
    address constant LP_B     = address(0xBBBB);

    MockStablecoin  usdc;
    TreasuryReserve treasury;
    PoolFactory     factory;

    function _deployInfra() internal {
        vm.warp(0);
        usdc = new MockStablecoin();
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
    }

    function _createPoolWithFloor(uint256 floor) internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              TENOR,
            idleRateDaily:       5e14,
            utilizedRateDaily:   5e14,
            penaltyRateDaily:    1e15,
            penaltyGraceDays:    2,
            minDeposit:          floor,
            aprAnnual:           1e17,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
        p = PoolContract(addr);
    }

    function _createPool() internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           9_000_000 * SCALE,
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
        p = PoolContract(addr);
    }

    function _lock(PoolContract p) internal {
        usdc.mint(LP_A, 1_000_000 * SCALE);
        vm.prank(LP_A); usdc.approve(address(p), type(uint256).max);
        vm.prank(LP_A); p.deposit(1_000_000 * SCALE);
        vm.warp(LOCK); p.finalizeFunding();
    }

    function _draw(PoolContract p, bytes32 ref, uint256 amtUSDC, uint256 settle) internal {
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, amtUSDC * SCALE, settle);
    }

    function _repay(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.prank(PSP); usdc.approve(address(p), total);
        vm.prank(PSP); p.repay(ref);
    }

    function _closePool(PoolContract p) internal {
        vm.warp(MAT + D);
        (, , uint256 owed) = p.getIdleFeesBreakdown();
        if (owed > 0) {
            usdc.mint(PSP, owed);
            vm.prank(PSP); usdc.approve(address(p), owed);
            vm.prank(PSP); p.payAccruedIdleFees(owed);
        }
        if (p.status() == PoolContract.Status.Active) {
            vm.prank(LP_A); p.claimYield();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM 1 — settleDefaultPrincipal underflow: worst-case multi-path sequence
//
// Proving invariant: once in Default, availableToDd == 0 and
//   outstanding + collectedPrincipal == principal (partition identity preserved).
// Therefore owed = outstanding, and paid = fromAmount + fromReserve <= owed,
// so outstanding -= paid cannot underflow.
// ─────────────────────────────────────────────────────────────────────────────
contract Item1Test is AuditBase {
    function setUp() public { _deployInfra(); }

    /// Worst-case sequence: draw, partial repay, default, multiple partial settle calls.
    /// Each outstanding -= paid must complete without revert.
    function test_item1_settleDefaultPrincipal_noUnderflow() public {
        PoolContract p = _createPool();
        _lock(p);

        // Two draws, one repaid before default
        _draw(p, "r1", 300_000, 3);
        _draw(p, "r2", 200_000, 3);
        vm.warp(LOCK + 3 * D);
        _repay(p, "r1");   // 300k back; outstanding = 200k

        // Default at maturity with 200k outstanding
        vm.warp(MAT + D);
        vm.prank(AGENT2); p.declareDefault();
        assertEq(p.outstanding(), 200_000 * SCALE, "outstanding before settle");

        // Partition invariant: outstanding + collectedPrincipal == principal
        assertEq(
            p.outstanding() + p.collectedPrincipal(),
            p.principal(),
            "partition identity after default"
        );

        // Partial settle #1: 100k — outstanding -= 100k, no revert
        usdc.mint(MULTISIG, 200_000 * SCALE);
        vm.prank(MULTISIG); usdc.approve(address(p), type(uint256).max);
        vm.prank(MULTISIG); p.settleDefaultPrincipal(100_000 * SCALE);
        assertEq(p.outstanding(), 100_000 * SCALE, "outstanding after settle#1");

        // Partial settle #2: full remaining 100k — outstanding → 0, no revert
        vm.prank(MULTISIG); p.settleDefaultPrincipal(100_000 * SCALE);
        assertEq(p.outstanding(), 0, "outstanding after settle#2");

        // Default holds slot: declareDefault does NOT release PSP slot
        (, address activePool) = factory.psps(PSP);
        assertEq(activePool, address(p), "default must not release PSP slot");
    }

    /// Confirm declareDefault with reserve draw: paid still bounded by owed.
    function test_item1_settleWithReserve_noUnderflow() public {
        // Seed treasury reserve
        uint256 reserveAmt = 150_000 * SCALE;
        vm.store(address(treasury), bytes32(uint256(1)), bytes32(reserveAmt));
        usdc.mint(address(treasury), reserveAmt);

        PoolContract p = _createPool();
        _lock(p);
        _draw(p, "r1", 400_000, 3);
        vm.warp(MAT + D);
        vm.prank(AGENT2); p.declareDefault();

        // settleDefaultPrincipal with amount=0: reserve covers up to its balance
        vm.prank(MULTISIG); p.settleDefaultPrincipal(0);

        // outstanding must still be >= 0 (Solidity 0.8 ensures no underflow)
        uint256 out = p.outstanding();
        assertGe(out, 0, "outstanding underflowed"); // trivially true; proves no revert
        assertEq(
            p.outstanding() + p.collectedPrincipal(),
            p.principal(),
            "partition identity after reserve settle"
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM 2 — Receiver whitelist: addReceiver / removeReceiver access controls
//           and draw enforcement
// ─────────────────────────────────────────────────────────────────────────────
contract ReceiverWhitelistTest is AuditBase {
    function setUp() public { _deployInfra(); }

    // Draw to non-authorized receiver reverts
    function test_receiverWhitelist_unauthorizedRevert() public {
        PoolContract p = _createPool();
        _lock(p);  // _lock now adds PSP as receiver; test a different address

        address UNAUTH = address(0x9999);
        vm.prank(AGENT2);
        vm.expectRevert("Pool: receiver not authorized");
        p.executeDrawdown("o1", UNAUTH, 100_000 * SCALE, 1);
    }

    // addReceiver then draw succeeds; drawdown record has correct receiver
    function test_receiverWhitelist_addAndDraw() public {
        PoolContract p = _createPool();
        _lock(p);  // PSP already added in _lock
        _draw(p, "o1", 100_000, 3);

        PoolContract.DrawDown memory dd = p.getDrawDown("o1");
        assertEq(dd.principal, 100_000 * SCALE, "drawdown principal");
        assertEq(dd.receiverWallet, PSP, "drawdown receiver must be PSP");
        assertGt(p.outstanding(), 0, "outstanding > 0 after draw");
    }

    // addReceiver twice reverts
    function test_receiverWhitelist_duplicateAddReverts() public {
        PoolContract p = _createPool();
        _lock(p);  // PSP already added in _lock
        vm.prank(AGENT1);
        vm.expectRevert("Pool: already authorized");
        p.addReceiver(PSP);
    }

    // addReceiver in Closed state reverts
    function test_receiverWhitelist_addReverts_terminalState() public {
        PoolContract p = _createPool();
        _lock(p);
        _closePool(p);
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "must be closed");

        vm.prank(AGENT1);
        vm.expectRevert("Pool: terminal state");
        p.addReceiver(address(0x9999));
    }

    // removeReceiver blocked while there is a live drawdown to that receiver
    function test_receiverWhitelist_removeBlockedByLiveDrawdown() public {
        PoolContract p = _createPool();
        _lock(p);
        _draw(p, "o1", 100_000, 3);

        // Cannot remove PSP while drawdown is outstanding
        vm.prank(MULTISIG);
        vm.expectRevert("Pool: live drawdown");
        p.removeReceiver(PSP);
    }

    // removeReceiver allowed after draw is repaid
    function test_receiverWhitelist_removeAllowedAfterSettle() public {
        PoolContract p = _createPool();
        _lock(p);
        _draw(p, "o1", 100_000, 3);
        vm.warp(LOCK + 3 * D);
        _repay(p, "o1");

        // Now outstanding == 0 for PSP; remove should succeed
        vm.prank(MULTISIG);
        p.removeReceiver(PSP);
        assertFalse(p.isAuthorizedReceiver(PSP), "PSP must no longer be authorized");
    }

    // removeReceiver only callable by MULTISIG_ROLE
    function test_receiverWhitelist_removeOnlyMultisig() public {
        PoolContract p = _createPool();
        _lock(p);

        vm.prank(AGENT2);
        vm.expectRevert();
        p.removeReceiver(PSP);
    }

    // drawdown.receiverWallet == PSP after draw
    function test_receiverWhitelist_drawdownRecordHasReceiver() public {
        PoolContract p = _createPool();
        _lock(p);
        _draw(p, "o1", 50_000, 1);

        PoolContract.DrawDown memory dd = p.getDrawDown("o1");
        assertEq(dd.receiverWallet, PSP, "drawdown.receiverWallet must be PSP");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM 3 — Buffer boundary test: APR near coverability threshold flips
//          pass→fail when fractional buffer is included correctly.
//
// Parameters derived from:
//   util = 5e14, tenure = 30, fundingDays = 5, pgd = 2, buffer = 0.25d
//   maxTenureSecs_with_buffer    = 37.25 * 86400 = 3218400
//   maxTenureSecs_without_buffer = 37    * 86400 = 3196800
//
//   apr=1471e14: apr*3218400 > util*946080000 (FAIL with buffer)
//                apr*37 <= util*10950         (PASS without buffer — old bug)
//   apr=1467e14: apr*3218400 < util*946080000 (PASS with buffer)
// ─────────────────────────────────────────────────────────────────────────────
contract Item3Test is AuditBase {
    function setUp() public { _deployInfra(); }

    // Verify math: buffer is 21600 seconds
    function test_item3_bufferSecs_correct() public pure {
        uint256 bufferSecs = MathLib.mulDiv(25e16, MathLib.SECONDS_PER_DAY, MathLib.WAD);
        assertEq(bufferSecs, 21600, "0.25 day = 21600 seconds");
    }

    // APR=1471e14 FAILS with buffer-inclusive guard (old floored guard would have passed)
    function test_item3_buffer_boundary_highApr_reverts() public {
        // Deploy a fresh factory with the same bounds
        PoolContract impl2 = new PoolContract();
        TreasuryReserve tr2 = new TreasuryReserve(
            address(usdc), MULTISIG, 1e17, 1_000_000 * SCALE, WAD, 0
        );
        PoolFactory fac2 = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl2), address(tr2), address(usdc),
            30 * 86400, 25e16, 3, 1, 7
        );
        vm.prank(MULTISIG); tr2.setFactory(address(fac2));
        vm.prank(MULTISIG); fac2.approvePsp(PSP);

        // Verify old (floored) guard would have PASSED: apr*37 <= util*10950
        uint256 aprBoundary = 1471e14;
        uint256 util        = 5e14;
        assertTrue(aprBoundary * 37 <= util * 10950, "old guard should pass for this APR");

        // Verify new (seconds) guard FAILS: apr*3218400 > util*946080000
        uint256 maxTenureSecs = 3218400; // 37.25 * 86400
        assertTrue(aprBoundary * maxTenureSecs > util * 365 * 30 * MathLib.SECONDS_PER_DAY,
            "new guard should fail for this APR");

        // Python oracle also FAILS:
        // real_tenure_apr = 0.1471 * (37.25/30) = 0.18262 > util*365 = 0.1825
        // (confirmed analytically)

        vm.prank(DEPLOYER);
        vm.expectRevert("Factory: APR not coverable by util rate");
        fac2.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           9_000_000 * SCALE,
            tenure:            30,
            idleRateDaily:     5e14,
            utilizedRateDaily: util,
            penaltyRateDaily:  1e15,
            penaltyGraceDays:  2,
            minDeposit:        0,
            aprAnnual:         aprBoundary,
            agent1:            AGENT1,
            agent2:            AGENT2,
            multisig:          MULTISIG
        }));
    }

    // APR=1467e14 PASSES with buffer-inclusive guard
    function test_item3_buffer_boundary_lowerApr_passes() public {
        PoolContract impl2 = new PoolContract();
        TreasuryReserve tr2 = new TreasuryReserve(
            address(usdc), MULTISIG, 1e17, 1_000_000 * SCALE, WAD, 0
        );
        PoolFactory fac2 = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl2), address(tr2), address(usdc),
            30 * 86400, 25e16, 3, 1, 7
        );
        vm.prank(MULTISIG); tr2.setFactory(address(fac2));
        vm.prank(MULTISIG); fac2.approvePsp(PSP);

        uint256 aprJustBelow = 1467e14;
        uint256 util         = 5e14;
        uint256 maxTenureSecs = 3218400;
        assertTrue(aprJustBelow * maxTenureSecs <= util * 365 * 30 * MathLib.SECONDS_PER_DAY,
            "new guard should pass for this APR");

        vm.prank(DEPLOYER);
        fac2.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           9_000_000 * SCALE,
            tenure:            30,
            idleRateDaily:     5e14,
            utilizedRateDaily: util,
            penaltyRateDaily:  1e15,
            penaltyGraceDays:  2,
            minDeposit:        0,
            aprAnnual:         aprJustBelow,
            agent1:            AGENT1,
            agent2:            AGENT2,
            multisig:          MULTISIG
        }));
        // No revert — pool created successfully
    }

    // Confirm that maxTenureSecs stored in pool is correct (37.25*D = 3218400)
    function test_item3_pool_maxTenureSecs_stored() public {
        PoolContract p = _createPool();
        assertEq(p.maxTenureSecs(), 37 * D + 21600,
            "maxTenureSecs = (5+30+2)*D + 21600");
    }

    // Confirm all existing golden-vector pools still create (guard doesn't regress)
    function test_item3_standardParams_still_create() public {
        // Standard params: apr=1e17, util=5e14, tenure=30, pgd=2 — should always pass
        PoolContract p = _createPool();
        assertTrue(address(p) != address(0), "pool should be created with standard params");
        assertEq(p.maxTenureSecs(), 3218400, "standard maxTenureSecs");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM 4 — PSP registry / wallet rotation
// ─────────────────────────────────────────────────────────────────────────────
contract Item4Test is AuditBase {
    function setUp() public { _deployInfra(); }

    // (1) One-pool-per-PSP: attempt second pool while first is live → revert
    function test_item4_onlyOnePoolPerPsp_reverts() public {
        _createPool(); // PSP slot is now occupied

        vm.prank(DEPLOYER);
        vm.expectRevert("Factory: PSP has live pool");
        factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           9_000_000 * SCALE,
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
    }

    // (1b) After terminal state (Closed), slot is released → second pool succeeds
    function test_item4_slotReusedAfterClose() public {
        PoolContract p = _createPool();
        _lock(p);
        _closePool(p);
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "pool must be closed");

        // Slot released by releasePsp
        (, address activePool) = factory.psps(PSP);
        assertEq(activePool, address(0), "slot must be released after close");

        // Create a second pool for the same PSP
        vm.prank(DEPLOYER);
        address pool2Addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           9_000_000 * SCALE,
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
        assertTrue(pool2Addr != address(0), "second pool should be created");
        (, address newSlot) = factory.psps(PSP);
        assertEq(newSlot, pool2Addr, "slot holds second pool");
    }

    // (1c) Unsuccessful pool (funding failed) also releases slot
    function test_item4_slotReusedAfterUnsuccessful() public {
        PoolContract p = _createPool();
        // Warp past funding window without depositing enough
        vm.warp(LOCK);
        p.finalizeFunding(); // no deposits → Unsuccessful
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Unsuccessful), "should be unsuccessful");

        (, address activePool) = factory.psps(PSP);
        assertEq(activePool, address(0), "slot released after unsuccessful");

        vm.prank(DEPLOYER);
        address pool2Addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           9_000_000 * SCALE,
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
        assertTrue(pool2Addr != address(0), "second pool after unsuccessful");
    }

    // (2) reassignPspWallet: old record cleared, new record holds activePool, pool.pspWallet updated
    function test_item4_reassignPspWallet() public {
        PoolContract p = _createPool();

        // reassignPspWallet carries the approved flag to the new record; PSP2 need not be pre-approved.
        vm.prank(MULTISIG);
        factory.reassignPspWallet(PSP, PSP2);

        // Old record cleared
        (bool oldApproved, address oldActive) = factory.psps(PSP);
        assertFalse(oldApproved, "old PSP record should be cleared");
        assertEq(oldActive, address(0), "old active pool should be cleared");

        // New record holds the active pool and approved=true
        (bool newApproved, address newActive) = factory.psps(PSP2);
        assertTrue(newApproved, "new PSP should be approved");
        assertEq(newActive, address(p), "new PSP should hold the active pool");

        // Pool's pspWallet updated
        assertEq(p.pspWallet(), PSP2, "pool.pspWallet must point to new PSP");
    }

    // (2b) reassign non-approved PSP reverts
    function test_item4_reassignNonApproved_reverts() public {
        address RANDOM_PSP = address(0xDEAD);
        vm.prank(MULTISIG);
        vm.expectRevert("Factory: old psp not approved");
        factory.reassignPspWallet(RANDOM_PSP, PSP2);
    }

    // (2c) reassign to a newPsp that already holds a live pool must revert —
    // the blind overwrite would orphan newPsp's existing pool and corrupt the registry.
    function test_item4_reassignToActivePsp_reverts() public {
        // Give PSP2 its own live pool.
        vm.prank(MULTISIG); factory.approvePsp(PSP2);
        vm.prank(DEPLOYER);
        factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP2,
            fundingDurationSecs: 5 * 86400,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              TENOR,
            idleRateDaily:       5e14,
            utilizedRateDaily:   5e14,
            penaltyRateDaily:    1e15,
            penaltyGraceDays:    2,
            minDeposit:          0,
            aprAnnual:           1e17,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));

        // PSP also has a live pool.
        _createPool();

        // Reassigning PSP → PSP2 must revert: would overwrite PSP2's live-pool record.
        vm.prank(MULTISIG);
        vm.expectRevert("Factory: new psp has live pool");
        factory.reassignPspWallet(PSP, PSP2);
    }

    // (2d) happy-path reassign still works after the new guard —
    // newPsp is pre-approved but has no active pool (approved-but-empty is a valid target).
    function test_item4_reassignToApprovedEmptyPsp_succeeds() public {
        PoolContract p = _createPool();
        // PSP2 is approved but never had a pool.
        vm.prank(MULTISIG); factory.approvePsp(PSP2);

        vm.prank(MULTISIG);
        factory.reassignPspWallet(PSP, PSP2);

        (, address oldActive) = factory.psps(PSP);
        (bool newApproved, address newActive) = factory.psps(PSP2);
        assertEq(oldActive,   address(0),  "old slot cleared");
        assertTrue(newApproved,             "new PSP approved");
        assertEq(newActive,   address(p),   "new PSP holds active pool");
        assertEq(p.pspWallet(), PSP2,       "pool.pspWallet updated");
    }

    // (3) releasePsp gate: non-slot-holder reverts
    function test_item4_releasePsp_wrongCaller_reverts() public {
        PoolContract p = _createPool();
        address poolAddr = address(p);

        // Caller is PSP itself (not the pool contract)
        vm.prank(PSP);
        vm.expectRevert("Factory: not slot holder");
        factory.releasePsp(PSP);

        // Random caller
        vm.prank(address(0xDEAD));
        vm.expectRevert("Factory: not slot holder");
        factory.releasePsp(PSP);

        // Only the active pool can call releasePsp — confirmed by checking it's set
        (, address activePool) = factory.psps(PSP);
        assertEq(activePool, poolAddr, "pool still holds slot");
    }

    // (4) Default holds the slot: declareDefault does NOT release the PSP slot.
    //     Only reaching Closed (via settlement) releases it.
    function test_item4_default_holdsSlot() public {
        PoolContract p = _createPool();
        _lock(p);
        _draw(p, "r1", 500_000, 3);
        vm.warp(MAT + D);
        vm.prank(AGENT2); p.declareDefault();

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default), "must be in default");

        // Slot NOT released
        (, address activePool) = factory.psps(PSP);
        assertEq(activePool, address(p), "slot must NOT be released in default");

        // Settle to Closed: settleDefaultPrincipal then settleDefaultYield
        uint256 outstanding = p.outstanding();
        usdc.mint(MULTISIG, outstanding);
        vm.prank(MULTISIG); usdc.approve(address(p), outstanding);
        vm.prank(MULTISIG); p.settleDefaultPrincipal(outstanding);

        // Yield settle: must cover both base yield shortfall and overrun shortfall
        uint256 yieldShort  = p.yieldOwed()    > p.collectedYield()        ? p.yieldOwed()    - p.collectedYield()        : 0;
        uint256 overrunShort = p.overrunYield() > p.collectedOverrunYield() ? p.overrunYield() - p.collectedOverrunYield() : 0;
        uint256 totalShort  = yieldShort + overrunShort;
        if (totalShort > 0) {
            usdc.mint(MULTISIG, totalShort);
            vm.prank(MULTISIG); usdc.approve(address(p), totalShort);
            vm.prank(MULTISIG); p.settleDefaultYield(totalShort);
        }

        // Now should be Closed, slot released
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "must be closed after settlement");
        (, address slotAfter) = factory.psps(PSP);
        assertEq(slotAfter, address(0), "slot released after Closed via settlement");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM 5 — Tighten soft tests
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Reentrant ERC20 duplicate (inline to avoid import coupling)
contract ReentrantToken is MockStablecoin {
    address public hookRecipient;
    address public hookCallTarget;
    bytes   public hookCalldata;
    bool    private _inHook;

    event ReentryAttempt(bool success, bytes returnData);

    function setHook(address recipient, address callTarget, bytes calldata data) external {
        hookRecipient  = recipient;
        hookCallTarget = callTarget;
        hookCalldata   = data;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (hookCallTarget != address(0) && to == hookRecipient && !_inHook) {
            _inHook = true;
            (bool success, bytes memory ret) = hookCallTarget.call(hookCalldata);
            emit ReentryAttempt(success, ret);
            _inHook = false;
        }
        return ok;
    }
}

contract Item5Test is AuditBase {
    uint256 constant D2 = 86400;

    function setUp() public { _deployInfra(); }

    // (5a) testReentrancy_claimYield_blocked: assert ReentryAttempt emitted with success==false
    function test_item5_reentrancy_claimYield_reentryAttemptFalse() public {
        ReentrantToken rToken = new ReentrantToken();
        PoolContract impl2 = new PoolContract();
        TreasuryReserve tr2 = new TreasuryReserve(
            address(rToken), MULTISIG, 1e17, 1_000_000 * SCALE, WAD, 0
        );
        PoolFactory fac2 = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl2), address(tr2), address(rToken),
            30 * 86400, 25e16, 3, 1, 7
        );
        vm.prank(MULTISIG); tr2.setFactory(address(fac2));
        vm.prank(MULTISIG); fac2.approvePsp(PSP);
        vm.prank(DEPLOYER);
        address pAddr = fac2.createPool(PoolFactory.CreatePoolParams({
            pspWallet: PSP, softCap: 1 * SCALE, hardCap: 9_000_000 * SCALE,
            fundingDurationSecs: 5 * 86400,
            tenure: TENOR, idleRateDaily: 5e14, utilizedRateDaily: 5e14,
            penaltyRateDaily: 1e15, penaltyGraceDays: 2, minDeposit: 0,
            aprAnnual: 1e17, agent1: AGENT1, agent2: AGENT2, multisig: MULTISIG
        }));
        PoolContract rPool = PoolContract(pAddr);

        rToken.mint(LP_A, 1_000_000 * SCALE);
        vm.prank(LP_A); rToken.approve(pAddr, type(uint256).max);
        vm.prank(LP_A); rPool.deposit(1_000_000 * SCALE);

        vm.warp(LOCK); rPool.finalizeFunding();
        rToken.mint(PSP, 50_000_000 * SCALE);
        vm.prank(PSP); rToken.approve(pAddr, type(uint256).max);
        vm.prank(AGENT2); rPool.executeDrawdown(bytes32("r1"), PSP, 100_000 * SCALE, 3);
        vm.warp(LOCK + 3 * D2);
        (, , uint256 repayTotal) = rPool.getRepaymentOwed(bytes32("r1"));
        rToken.mint(PSP, repayTotal);
        vm.prank(PSP); rToken.approve(pAddr, repayTotal);
        vm.prank(PSP); rPool.repay(bytes32("r1"));

        // Arm the hook: on claimYield's transfer to LP_A, re-enter claimYield
        rToken.setHook(LP_A, address(rPool), abi.encodeCall(rPool.claimYield, ()));

        // Record logs to inspect the ReentryAttempt event
        vm.recordLogs();
        vm.prank(LP_A); rPool.claimYield();

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sigHash = keccak256("ReentryAttempt(bool,bytes)");
        bool foundEvent = false;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == sigHash) {
                (bool success,) = abi.decode(logs[i].data, (bool, bytes));
                assertFalse(success, "ReentryAttempt must have success=false (nonReentrant blocked it)");
                foundEvent = true;
                break;
            }
        }
        assertTrue(foundEvent, "ReentryAttempt event must have been emitted");

        // Outer claim succeeded
        assertGt(rToken.balanceOf(LP_A), 0, "outer claimYield must have transferred yield");
    }

    // (5b) test_v6_multilp_close: tolerance tightened from SCALE to 2 units.
    //
    // Both LPs deposit at t=0 (proportional ds = 60%/40%), so the mulDiv ratio
    // 600_000/1_000_000 is exact (no fractional residue). The at-most-1-unit
    // floor from each mulDiv chain results in at most 2 units total per LP.
    function test_item5_v6_multilp_tightTolerance() public {
        PoolContract p = _createPool();

        usdc.mint(LP_A, 600_000 * SCALE);
        usdc.mint(LP_B, 400_000 * SCALE);
        vm.prank(LP_A); usdc.approve(address(p), type(uint256).max);
        vm.prank(LP_B); usdc.approve(address(p), type(uint256).max);
        vm.prank(LP_A); p.deposit(600_000 * SCALE);
        vm.prank(LP_B); p.deposit(400_000 * SCALE);
        vm.warp(LOCK); p.finalizeFunding();

        _draw(p, "o1", 800_000, 7);
        vm.warp(LOCK + 7 * D2);
        _repay(p, "o1");
        _closePool(p);

        vm.prank(LP_A); p.claimYield(); vm.prank(LP_A); p.claimPrincipal();
        vm.prank(LP_B); p.claimYield(); vm.prank(LP_B); p.claimPrincipal();

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "must be closed");

        uint256 expectedYield = p.yieldOwed();
        // LP share: 60% of yieldOwed (exact since ds ratio is exact)
        uint256 lpA_yield_exp = MathLib.mulDiv(600_000 * SCALE, expectedYield, 1_000_000 * SCALE);
        uint256 lpB_yield_exp = expectedYield - lpA_yield_exp;

        uint256 lpA_usdc = usdc.balanceOf(LP_A);
        uint256 lpB_usdc = usdc.balanceOf(LP_B);

        // Tolerance: at most 2 units from two mulDiv floor operations (yield + principal).
        // In this scenario the ratio is exact, so actual delta is 0 or 1.
        assertApproxEqAbs(lpA_usdc, 600_000 * SCALE + lpA_yield_exp, 2, "v6 lpA tight tolerance");
        assertApproxEqAbs(lpB_usdc, 400_000 * SCALE + lpB_yield_exp, 2, "v6 lpB tight tolerance");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ITEM 6 — minDeposit floor symmetry: withdraw must preserve the floor
//
// Bug: deposit enforces amount >= minDeposit but withdraw had no remainder guard.
// An LP depositing exactly minDeposit could withdraw (minDeposit - 1), leaving a
// 1-wei position — violating the floor that the deposit guard established.
//
// Fix: require(remaining == 0 || remaining >= minDeposit).
// The remaining == 0 branch is mandatory — a full exit must always be allowed.
//
// Three cases exercise all three branches of the floor predicate:
//   (a) partial withdraw leaving sub-minimum → reverts
//   (b) full withdrawal to zero             → succeeds (remaining == 0 branch)
//   (c) partial withdraw leaving exactly floor → succeeds (remaining >= minDeposit branch)
// ─────────────────────────────────────────────────────────────────────────────
contract Item6Test is AuditBase {
    uint256 constant MIN_DEP = 5e11; // 0.5 SCALE

    function setUp() public { _deployInfra(); }

    // (a) Deposit exactly minDeposit; partial withdraw that would leave a sub-minimum
    //     remainder must revert with the new guard.
    function test_item6_dustRemainderReverts() public {
        PoolContract p = _createPoolWithFloor(MIN_DEP);
        usdc.mint(LP_A, MIN_DEP);
        vm.prank(LP_A); usdc.approve(address(p), type(uint256).max);
        vm.prank(LP_A); p.deposit(MIN_DEP);

        vm.prank(LP_A);
        vm.expectRevert("Pool: remainder below minDeposit");
        p.withdraw(MIN_DEP - 1); // leaves 1 wei — below floor
    }

    // (b) Full withdrawal from exactly minDeposit must succeed — remaining == 0 branch.
    //     Blocking full exit would trap LPs with no recovery path.
    function test_item6_fullExitFromMinDeposit() public {
        PoolContract p = _createPoolWithFloor(MIN_DEP);
        usdc.mint(LP_A, MIN_DEP);
        vm.prank(LP_A); usdc.approve(address(p), type(uint256).max);
        vm.prank(LP_A); p.deposit(MIN_DEP);

        vm.prank(LP_A);
        p.withdraw(MIN_DEP); // remaining == 0 → allowed

        (uint256 prin,,,,,,,, ) = p.lpPositions(LP_A);
        assertEq(prin, 0, "position must be closed after full exit");
        assertEq(usdc.balanceOf(LP_A), MIN_DEP, "USDC must be returned");
    }

    // (c) Partial withdrawal that leaves exactly the floor must succeed.
    function test_item6_aboveFloorSucceeds() public {
        PoolContract p = _createPoolWithFloor(MIN_DEP);
        usdc.mint(LP_A, 2 * MIN_DEP);
        vm.prank(LP_A); usdc.approve(address(p), type(uint256).max);
        vm.prank(LP_A); p.deposit(2 * MIN_DEP);

        vm.prank(LP_A);
        p.withdraw(MIN_DEP); // leaves exactly MIN_DEP → allowed

        (uint256 prin,,,,,,,, ) = p.lpPositions(LP_A);
        assertEq(prin, MIN_DEP, "remainder must equal the floor exactly");
    }
}
