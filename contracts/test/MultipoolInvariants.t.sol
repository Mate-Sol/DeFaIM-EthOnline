// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "./MultipoolHandler.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";

/// @dev Multipool Layer-A invariant suite: registry/factory dynamics.
///
/// Invariants:
///   LA0  No arithmetic panic in any factory/pool call
///   LA1  One live pool per PSP at all times
///   LA2  Slot lifecycle: held iff pool is live; released iff terminal
///   LA3  Reassignment integrity: pool.pspWallet and factory registry agree
///   LA4  Registry consistency: every created pool is in isPoolExist
///
/// Layer A ONLY — no economic invariants.  Pool economics neutered (aprAnnual=0)
/// so all three close paths are reachable cheaply.
///
/// Selector weighting: high-value registry operations (reassign, second-pool
/// attempt, all three close paths) appear multiple times in the target selector
/// array to drive high coverage counts.
contract MultipoolInvariants is Test {
    MultipoolHandler handler;

    function setUp() public {
        handler = new MultipoolHandler();
        targetContract(address(handler));

        // Weighted selector list: high-value handlers repeated for frequency.
        bytes4[] memory sel = new bytes4[](20);
        sel[0]  = handler.handler_createPool.selector;
        sel[1]  = handler.handler_createPool.selector;          // weight ×2
        sel[2]  = handler.handler_secondPoolAttempt.selector;
        sel[3]  = handler.handler_secondPoolAttempt.selector;   // weight ×2
        sel[4]  = handler.handler_secondPoolAttempt.selector;   // weight ×3
        sel[5]  = handler.handler_reassignPspWallet.selector;
        sel[6]  = handler.handler_reassignPspWallet.selector;   // weight ×2
        sel[7]  = handler.handler_reassignPspWallet.selector;   // weight ×3
        sel[8]  = handler.handler_chainedReassign.selector;
        sel[9]  = handler.handler_chainedReassign.selector;     // weight ×2
        sel[10] = handler.handler_closeViaUnsuccessful.selector;
        sel[11] = handler.handler_closeViaUnsuccessful.selector; // weight ×2
        sel[12] = handler.handler_closeViaClosed.selector;
        sel[13] = handler.handler_closeViaClosed.selector;      // weight ×2
        sel[14] = handler.handler_closeViaMaturity.selector;
        sel[15] = handler.handler_closeViaMaturity.selector;    // weight ×2
        sel[16] = handler.handler_approvePsp.selector;
        sel[17] = handler.handler_revokePsp.selector;
        sel[18] = handler.handler_warpTime.selector;
        sel[19] = handler.handler_warpTime.selector;             // weight ×2

        targetSelector(FuzzSelector({ addr: address(handler), selectors: sel }));
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    function _isLive(PoolContract p) internal view returns (bool) {
        PoolContract.Status s = p.status();
        return s != PoolContract.Status.Closed &&
               s != PoolContract.Status.Unsuccessful;
    }

    // ── LA0: No arithmetic panic ──────────────────────────────────────────

    function invariant_LA0_noPanic() public view {
        assertFalse(handler.ghost_panicDetected(), handler.ghost_panicInfo());
    }

    // ── LA1: One live pool per PSP ────────────────────────────────────────
    //
    // At all times: at most one live pool per PSP address (measured by
    // pool.pspWallet(), which is updated by reassignPspWallet).
    //
    // Break-tested: removing the "PSP has live pool" guard in createPool
    // causes LA1 to fire at run 3.
    // ─────────────────────────────────────────────────────────────────────
    function invariant_LA1_oneLivePoolPerPsp() public view {
        uint256 n = handler.poolCount();

        for (uint256 pi = 0; pi < 8; pi++) {
            address psp = handler.PSPS(pi);
            uint256 liveCount = 0;

            for (uint256 i = 0; i < n; i++) {
                PoolContract pool = PoolContract(handler.allPools(i));
                if (pool.pspWallet() == psp && _isLive(pool)) {
                    liveCount++;
                }
            }

            assertLe(liveCount, 1,
                string.concat("LA1: PSP has >1 live pool: ", vm.toString(psp)));
        }
    }

    // ── LA2: Slot lifecycle ───────────────────────────────────────────────
    //
    // For every pool in allPools[]:
    //   live  → factory.psps[pool.pspWallet()].activePool == pool address
    //   terminal → factory.psps[pool.pspWallet()].activePool != pool address
    //
    // Verified across all three close paths (Unsuccessful, DefaultClose,
    // MaturityClose) via the per-path ghost counters in the coverage test.
    //
    // Break-tested: commenting out _releasePsp() in _finalizeFunding (the
    // Unsuccessful branch) causes LA2 to fire on the first Unsuccessful close.
    // ─────────────────────────────────────────────────────────────────────
    function invariant_LA2_slotLifecycle() public view {
        PoolFactory f = handler.factory();
        uint256 n = handler.poolCount();

        for (uint256 i = 0; i < n; i++) {
            address poolAddr = handler.allPools(i);
            PoolContract pool = PoolContract(poolAddr);
            address currentPsp = pool.pspWallet();
            (, address activePool) = f.psps(currentPsp);

            if (_isLive(pool)) {
                assertEq(activePool, poolAddr,
                    string.concat("LA2: live pool not in factory slot. pool=",
                        vm.toString(poolAddr)));
            } else {
                assertTrue(activePool != poolAddr,
                    string.concat("LA2: terminal pool still holds factory slot. pool=",
                        vm.toString(poolAddr)));
            }
        }
    }

    // ── LA3: Reassignment integrity ───────────────────────────────────────
    //
    // For every live pool: factory.psps[pool.pspWallet()].activePool == pool.
    // This catches the storage-ref bug class (factory updated but pool.pspWallet
    // not, or vice versa).
    //
    // Break-tested: skipping setPspWallet in reassignPspWallet causes LA3 to
    // fire immediately with the correct mismatch message.
    // ─────────────────────────────────────────────────────────────────────
    function invariant_LA3_reassignmentIntegrity() public view {
        PoolFactory f = handler.factory();
        uint256 n = handler.poolCount();

        for (uint256 i = 0; i < n; i++) {
            address poolAddr = handler.allPools(i);
            PoolContract pool = PoolContract(poolAddr);
            if (!_isLive(pool)) continue;

            address pspOnPool = pool.pspWallet();
            (, address activePool) = f.psps(pspOnPool);

            assertEq(activePool, poolAddr,
                string.concat("LA3: pool.pspWallet mismatch with factory. pool=",
                    vm.toString(poolAddr),
                    " pspWallet=", vm.toString(pspOnPool)));
        }
    }

    // ── LA4: Registry consistency ─────────────────────────────────────────

    function invariant_LA4_registryConsistency() public view {
        PoolFactory f = handler.factory();
        uint256 n = handler.poolCount();

        for (uint256 i = 0; i < n; i++) {
            address poolAddr = handler.allPools(i);
            assertTrue(f.isPoolExist(poolAddr),
                string.concat("LA4: pool not in factory.isPoolExist: ",
                    vm.toString(poolAddr)));
            assertEq(PoolContract(poolAddr).factory(), address(f),
                string.concat("LA4: pool.factory() mismatch. pool=",
                    vm.toString(poolAddr)));
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Verify-it-can-fail: Layer A break tests (LA0–LA4)
    // ══════════════════════════════════════════════════════════════════════════
    //
    // Pattern: assertTrue(holds before) → perturb → assertFalse(holds after).
    // All perturbations use vm.store to bypass contract guards, producing states
    // the contract cannot produce itself.  Guard states confirmed: each perturbed
    // state is one the invariant ACTUALLY EVALUATES (not one its guard skips).
    //
    // Storage slots used (from forge inspect):
    //   PoolContract  slot 19 = pspWallet (address, right-aligned)
    //   PoolFactory   slot  1 = psps mapping  (PspRecord: bool approved @ byte 0, address activePool @ bytes 1-20)
    //   PoolFactory   slot  3 = isPoolExist mapping (address → bool)

    // ── Bool-returning helpers mirroring each invariant ───────────────────

    function _la0Ok() internal view returns (bool) {
        return !handler.ghost_panicDetected();
    }

    function _la1Ok() internal view returns (bool) {
        uint256 n = handler.poolCount();
        for (uint256 pi = 0; pi < 8; pi++) {
            address psp = handler.PSPS(pi);
            uint256 liveCount = 0;
            for (uint256 i = 0; i < n; i++) {
                PoolContract pool = PoolContract(handler.allPools(i));
                if (pool.pspWallet() == psp && _isLive(pool)) liveCount++;
            }
            if (liveCount > 1) return false;
        }
        return true;
    }

    function _la2Ok() internal view returns (bool) {
        PoolFactory f = handler.factory();
        uint256 n = handler.poolCount();
        for (uint256 i = 0; i < n; i++) {
            address poolAddr = handler.allPools(i);
            PoolContract pool = PoolContract(poolAddr);
            address currentPsp = pool.pspWallet();
            (, address activePool) = f.psps(currentPsp);
            if (_isLive(pool)) {
                if (activePool != poolAddr) return false;
            } else {
                if (activePool == poolAddr) return false;
            }
        }
        return true;
    }

    function _la3Ok() internal view returns (bool) {
        PoolFactory f = handler.factory();
        uint256 n = handler.poolCount();
        for (uint256 i = 0; i < n; i++) {
            address poolAddr = handler.allPools(i);
            PoolContract pool = PoolContract(poolAddr);
            if (!_isLive(pool)) continue;
            (, address activePool) = f.psps(pool.pspWallet());
            if (activePool != poolAddr) return false;
        }
        return true;
    }

    function _la4Ok() internal view returns (bool) {
        PoolFactory f = handler.factory();
        uint256 n = handler.poolCount();
        for (uint256 i = 0; i < n; i++) {
            address poolAddr = handler.allPools(i);
            if (!f.isPoolExist(poolAddr)) return false;
            if (PoolContract(poolAddr).factory() != address(f)) return false;
        }
        return true;
    }

    // ── LA0: real panic through typed catch ───────────────────────────────
    //
    // helper_injectPanic_forTest() calls helper_deliberatePanic() externally,
    // which underflows → real EVM Panic(0x11) → typed catch Panic catches it →
    // _recordPanic sets ghost_panicDetected. Same wiring as campaign handlers.
    // Guard: none (assertFalse always evaluates ghost_panicDetected).
    function test_LA0_breakVerification() public {
        assertTrue(_la0Ok(), "LA0 should hold before injection");
        handler.helper_injectPanic_forTest();
        assertFalse(_la0Ok(), "LA0 should fire after real panic injection");
    }

    // ── LA1: two live pools with same PSP ─────────────────────────────────
    //
    // Create pool[0] (PSP_0) and pool[1] (PSP_1), both live (Funding).
    // Corrupt pool[1].pspWallet to PSP_0 via vm.store slot 19.
    // liveCount(PSP_0) becomes 2 → assertLe(2, 1) fires.
    // Guard: poolCount > 0 and the psp loop finds PSP_0 with liveCount=2.
    function test_LA1_breakVerification() public {
        handler.handler_createPool(0); // pool[0] for PSP_0, live
        handler.handler_createPool(1); // pool[1] for PSP_1, live
        assertTrue(_la1Ok(), "LA1 should hold before corrupt");
        // Corrupt pool[1].pspWallet to PSP_0 (slot 19, right-aligned address)
        address pool1Addr = handler.allPools(1);
        vm.store(pool1Addr, bytes32(uint256(18)), bytes32(uint256(uint160(handler.PSPS(0)))));
        assertFalse(_la1Ok(), "LA1 should fire: two live pools share PSP_0");
    }

    // ── LA2: live pool evicted from factory slot ──────────────────────────
    //
    // Create pool[0] for PSP_0 (live). Corrupt factory.psps[PSP_0].activePool
    // to address(0) while keeping approved=true. The live pool is no longer in
    // its factory slot → assertEq(address(0), poolAddr) fires.
    // Guard: live pool is evaluated (not skipped).
    function test_LA2_breakVerification() public {
        handler.handler_createPool(0); // pool[0] for PSP_0, live (Funding)
        assertTrue(_la2Ok(), "LA2 should hold before corrupt");
        address psp0 = handler.PSPS(0);
        bytes32 pspSlot = bytes32(uint256(keccak256(abi.encode(psp0, uint256(1)))));
        vm.store(address(handler.factory()), pspSlot, bytes32(uint256(1))); // approved=true, activePool=0
        assertFalse(_la2Ok(), "LA2 should fire: live pool not in factory slot");
    }

    // ── LA3: pool.pspWallet diverges from factory registry ───────────────
    //
    // Create pool[0] for PSP_0 (live). Corrupt pool[0].pspWallet to PSP_1
    // (slot 19). factory.psps[PSP_1].activePool is address(0) (PSP_1 unused) →
    // assertEq(address(0), pool[0]) fails → LA3 fires.
    // Guard: live pool is evaluated (not skipped by !_isLive check).
    function test_LA3_breakVerification() public {
        handler.handler_createPool(0); // pool[0] for PSP_0, live
        assertTrue(_la3Ok(), "LA3 should hold before corrupt");
        // Corrupt pool[0].pspWallet to PSP_1 — factory.psps[PSP_1].activePool = address(0)
        address pool0Addr = handler.allPools(0);
        vm.store(pool0Addr, bytes32(uint256(18)), bytes32(uint256(uint160(handler.PSPS(1)))));
        assertFalse(_la3Ok(), "LA3 should fire: pool.pspWallet - factory mismatch");
    }

    // ── LA4: pool removed from factory.isPoolExist ────────────────────────
    //
    // Create pool[0]. Corrupt factory.isPoolExist[pool[0]] = false via vm.store.
    // handler.allPools still tracks the address, but factory no longer recognises it
    // → assertTrue(isPoolExist) fires.
    // Guard: poolCount > 0 (loop runs).
    function test_LA4_breakVerification() public {
        handler.handler_createPool(0);
        assertTrue(_la4Ok(), "LA4 should hold before corrupt");
        address pool0Addr = handler.allPools(0);
        bytes32 existSlot = bytes32(uint256(keccak256(abi.encode(pool0Addr, uint256(3)))));
        vm.store(address(handler.factory()), existSlot, bytes32(0));
        assertFalse(_la4Ok(), "LA4 should fire after isPoolExist corruption");
    }

    // ── Coverage: explicit reachability test ──────────────────────────────
    //
    // Walks a specific sequence proving every key state is reachable.
    //
    // Timing constraint: pools share fMaturityTs if created at the same t.
    // Any handler that warps to fMaturityTs (Unsuccessful, DefaultClose) blocks
    // the deposit-window for all pools with the same fMaturityTs.  The maturity-
    // close pool must therefore be created AFTER the first warp, so it has a
    // strictly later fMaturityTs.
    //
    // Confirmed: _mature() moves availableToDd → collectedPrincipal before
    // _checkFinality(), so an undrawn pool with aprAnnual=0 DOES reach Closed
    // and _releasePsp() fires.  The earlier test failure was a sequencing artifact,
    // not a property of the maturity-close path.
    //
    // Sequence:
    //   t=0   create pool[0] (PSP_0), pool[1] (PSP_1)  →  fMaturityTs = 5D
    //   t=0   second-pool attempts (both live)
    //   t=0   closeViaClosed(0): deposit, warp to 5D, lock → Active, declareDefault → Closed
    //   t=5D  closeViaUnsuccessful(1): no deposit, finalize → Unsuccessful
    //         (slot released for PSP_0 after Default; PSP_1 after Unsuccessful)
    //   t=5D  createPool(0): PSP_0 reuse after Default  → pool[2]  fMaturityTs=10D
    //   t=5D  createPool(1): PSP_1 reuse after Unsuccessful → pool[3]  fMaturityTs=10D
    //   t=5D  reassignPspWallet(0→4), chainedReassign(4→5→6), back-reassign(6→0)
    //   t=5D  closeViaMaturity(3): deposit, warp to 10D, lock → Active, warp to 40D,
    //         claimYield → _mature() → collectedPrincipal=principal → _checkFinality → Closed
    //   t=40D createPool(1): PSP_1 reuse after Maturity → pool[4]
    // ─────────────────────────────────────────────────────────────────────
    function test_LA_coverage() public {
        MultipoolHandler h = new MultipoolHandler();

        // ── t=0: create pool[0] (PSP_0) and pool[1] (PSP_1)  ────────────
        h.handler_createPool(0);
        h.handler_createPool(1);
        assertEq(h.ghost_poolsCreated(), 2, "2 pools created at t=0");

        // ── Second-pool attempts while both are live ──────────────────────
        h.handler_secondPoolAttempt(0);
        h.handler_secondPoolAttempt(1);
        h.handler_createPool(0); // createPool also hits guard → increments
        assertGe(h.ghost_secondPoolAttempts(), 3, ">=3 second-pool attempts");

        // ── Reassign-to-active guard: PSP_0→PSP_1 while PSP_1 holds pool[1] ─
        // Both PSP_0 (oldPsp, approved+live) and PSP_1 (newPsp, live pool) exist.
        // The handler must call factory.reassignPspWallet and let the contract
        // reject it; ghost_panicDetected would fire if the guard were absent.
        h.handler_reassignPspWallet(0, 1);
        assertGe(h.ghost_reassignToActiveAttempts(), 1, ">=1 reassign-to-active attempt");
        assertEq(h.ghost_reassignments(),            0, "no successful reassignments yet");

        // ── Path 2 (DefaultClose) for pool[0] BEFORE any warp ────────────
        // closeViaClosed deposits at t=0 then warps to fMaturityTs=5D to finalize.
        h.handler_closeViaClosed(0);
        assertEq(uint256(PoolContract(h.allPools(0)).status()),
            uint256(PoolContract.Status.Closed), "pool[0] Closed via default");
        assertEq(h.poolPath(0), 2, "pool[0] path = DefaultClose");
        // block.timestamp is now 5D.

        // ── Path 1 (Unsuccessful) for pool[1]: no deposit, finalize at 5D ─
        h.handler_closeViaUnsuccessful(1);
        assertEq(uint256(PoolContract(h.allPools(1)).status()),
            uint256(PoolContract.Status.Unsuccessful), "pool[1] Unsuccessful");
        assertEq(h.poolPath(1), 1, "pool[1] path = Unsuccessful");

        // ── Slot reuse after Default (PSP_0) → pool[2] at t=5D, fMaturityTs=10D
        h.handler_createPool(0);
        assertEq(h.ghost_slotReuse_afterDefault(), 1, "reuse after DefaultClose");

        // ── Slot reuse after Unsuccessful (PSP_1) → pool[3] at t=5D, fMaturityTs=10D
        h.handler_createPool(1);
        assertEq(h.ghost_slotReuse_afterUnsuccessful(), 1, "reuse after Unsuccessful");

        // pool[2] (PSP_0) and pool[3] (PSP_1) are both live with fMaturityTs=10D.
        // We're at t=5D — still inside the deposit window.

        // ── Reassignment: pool[2] PSP_0 → PSP_4 ─────────────────────────
        h.handler_reassignPspWallet(0, 4);
        assertEq(h.ghost_reassignments(), 1, "one reassignment");
        assertEq(PoolContract(h.allPools(2)).pspWallet(), h.PSPS(4),
            "pool[2].pspWallet = PSP_4");
        (bool oldApproved, address oldActive) = h.factory().psps(h.PSPS(0));
        assertFalse(oldApproved, "PSP_0 record deleted after reassign");
        assertEq(oldActive, address(0), "PSP_0 activePool cleared");
        (bool newApproved, address newActive) = h.factory().psps(h.PSPS(4));
        assertTrue(newApproved, "PSP_4 approved");
        assertEq(newActive, h.allPools(2), "PSP_4 activePool == pool[2]");

        // ── Chained reassign: PSP_4 → PSP_5, then PSP_5 → PSP_6 ─────────
        h.handler_chainedReassign(4, 5, 6);
        assertGe(h.ghost_chainedReassigns(), 1, "chained reassign legs >= 1");

        // ── Back-reassign: re-approve PSP_0, move slot back PSP_6 → PSP_0 ─
        h.handler_approvePsp(0);
        h.handler_reassignPspWallet(6, 0); // PSP_6 → PSP_0
        h.handler_reassignPspWallet(5, 0); // fallback if PSP_5 still holds the slot
        assertGe(h.ghost_reassignments(), 2, ">=2 reassignments total");

        // ── Path 3 (MaturityClose) for pool[3] (PSP_1, fMaturityTs=10D) ──
        //
        // Root cause of prior test failure: all pools created at t=0 shared
        // fMaturityTs=5D.  After warp to 5D, handler_closeViaMaturity's guard
        // (block.timestamp >= fMaturityTs) fired immediately.  pool[3] was
        // created at t=5D so fMaturityTs=10D; we're at t=5D < 10D — window open.
        //
        // _mature() will run: collectedPrincipal += availableToDd (= principal),
        // then _checkFinality: all conditions met with aprAnnual=0 → Closed + _releasePsp.
        h.handler_closeViaMaturity(3);
        assertEq(uint256(PoolContract(h.allPools(3)).status()),
            uint256(PoolContract.Status.Closed), "pool[3] Closed via maturity");
        assertEq(h.poolPath(3), 3, "pool[3] path = MaturityClose");
        // block.timestamp is now >= 40D (10D lock + 30D tenure).

        // ── Slot reuse after Maturity (PSP_1) ────────────────────────────
        h.handler_createPool(1);
        assertEq(h.ghost_slotReuse_afterMaturity(), 1, "reuse after MaturityClose");

        // ── All three per-path reuse counters confirmed > 0 ──────────────
        assertGe(h.ghost_slotReuse_afterDefault(),      1, "Default reuse > 0");
        assertGe(h.ghost_slotReuse_afterUnsuccessful(), 1, "Unsuccessful reuse > 0");
        assertGe(h.ghost_slotReuse_afterMaturity(),     1, "Maturity reuse > 0");

        emit log_named_uint("ghost_poolsCreated",                  h.ghost_poolsCreated());
        emit log_named_uint("ghost_secondPoolAttempts",            h.ghost_secondPoolAttempts());
        emit log_named_uint("ghost_reassignments",                 h.ghost_reassignments());
        emit log_named_uint("ghost_reassignToActiveAttempts",      h.ghost_reassignToActiveAttempts());
        emit log_named_uint("ghost_chainedReassigns",              h.ghost_chainedReassigns());
        emit log_named_uint("ghost_slotReuse_afterDefault",      h.ghost_slotReuse_afterDefault());
        emit log_named_uint("ghost_slotReuse_afterUnsuccessful", h.ghost_slotReuse_afterUnsuccessful());
        emit log_named_uint("ghost_slotReuse_afterMaturity",     h.ghost_slotReuse_afterMaturity());
        emit log_named_uint("ghost_pspsBitmap",                  h.ghost_pspsBitmap());
    }
}
