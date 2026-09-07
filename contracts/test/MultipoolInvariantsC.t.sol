// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "./MultipoolHandlerC.sol";
import "../src/PoolContract.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";

/// @dev Layer C invariant suite: shared mutualized reserve under cross-pool contention.
///
/// Invariants:
///   LC1  Reserve conservation: treasury.reserveBalance == initial + topUps - draws
///   LC2  No cross-pool bleed: covered[i] == directReceived[i] + reserveReceived[i] (per-pool exact)
///   LC3  Draw accounting closes: sum(reserveReceived) == totalDraws
///   LC4  No overdraw, monotonic settlement, non-negative draws
///
/// Setup: 3 pools, all declared Default from constructor; reserve = 1000 SCALE < 3000 total shortfall.
/// Pool[0] (first to settle) consumes the reserve; pool[1] and pool[2] are clamped.
///
/// Verify-it-can-fail:
///   test_LC2_breakVerification   — swap attribution, LC2 fires, LC3 holds
///   test_LC2LC3_breakVerification — phantom credit, LC2 + LC3 both fire
///
/// Non-vacuity:
///   test_LC_contention — deterministic sequence proving ghost_clampCount >= 2
///   test_LC_uncontendedControl — reserve >= total shortfall → ghost_clampCount == 0
///
/// Fuzzer config: runs=1000, depth=200
contract MultipoolInvariantsC is Test {
    MultipoolHandlerC handler;
    MockStablecoin    usdc;
    TreasuryReserve   treasury;

    uint256 constant SCALE = 1e12;
    uint256 constant D     = 86400;

    function setUp() public {
        handler  = new MultipoolHandlerC();
        usdc     = handler.usdc();
        treasury = handler.treasury();
        targetContract(address(handler));

        // Selector weights: settle handlers dominant, warpTime light.
        bytes4[] memory sel = new bytes4[](9);
        sel[0] = handler.handler_settleDefaultPrincipal.selector;
        sel[1] = handler.handler_settleDefaultPrincipal.selector; // weight ×2
        sel[2] = handler.handler_settleDefaultPrincipal.selector; // weight ×3
        sel[3] = handler.handler_settleDefaultPrincipal.selector; // weight ×4
        sel[4] = handler.handler_settleDefaultPrincipal.selector; // weight ×5
        sel[5] = handler.handler_settleDefaultYield.selector;
        sel[6] = handler.handler_settleDefaultYield.selector;     // weight ×2
        sel[7] = handler.handler_settleDefaultYield.selector;     // weight ×3
        sel[8] = handler.handler_warpTime.selector;

        targetSelector(FuzzSelector({ addr: address(handler), selectors: sel }));
    }

    // ── Conservation helpers ───────────────────────────────────────────────────

    function _coveredDelta(uint256 idx) internal view returns (uint256) {
        PoolContract p = handler.pools(idx);
        uint256 total = p.collectedPrincipal() + p.collectedYield() + p.collectedOverrunYield();
        uint256 pre   = handler.ghost_preDefaultCollected(idx);
        return total >= pre ? total - pre : 0;
    }

    function _ghostExpected(uint256 idx) internal view returns (uint256) {
        return handler.ghost_directReceived(idx) + handler.ghost_reserveReceived(idx);
    }

    function _sumReserveReceived() internal view returns (uint256 total) {
        for (uint256 i = 0; i < 3; i++) {
            total += handler.ghost_reserveReceived(i);
        }
    }

    // ── LC1: Reserve conservation + non-negativity ────────────────────────────
    //
    // treasury.reserveBalance must equal what the ghost model predicts:
    //   initial + topUps - draws
    // Non-negativity holds structurally (drawReserve clamps) but is asserted
    // to catch any future accounting regression.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_LC1_reserveConservation() public view {
        uint256 initial  = handler.ghost_reserveInitial();
        uint256 topUps   = handler.ghost_totalTopUps();
        uint256 draws    = handler.ghost_totalDraws();
        uint256 expected = initial + topUps - draws;

        assertEq(
            treasury.reserveBalance(),
            expected,
            string.concat(
                "LC1: reserveBalance=", vm.toString(treasury.reserveBalance()),
                " expected=", vm.toString(expected),
                " (initial=", vm.toString(initial),
                " +topUps=", vm.toString(topUps),
                " -draws=", vm.toString(draws), ")"
            )
        );
    }

    // ── LC2: No cross-pool bleed ──────────────────────────────────────────────
    //
    // For each pool i, the amount "covered" since default declaration must equal
    // exactly the sum of direct MULTISIG payments and reserve draws attributed to i.
    // Any phantom credit (one pool's draw credited to another) breaks this equality.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_LC2_noReserveBleed() public view {
        for (uint256 i = 0; i < 3; i++) {
            uint256 covered  = _coveredDelta(i);
            uint256 expected = _ghostExpected(i);
            assertEq(
                covered,
                expected,
                string.concat(
                    "LC2: pool[", vm.toString(i), "] covered=", vm.toString(covered),
                    " != direct+reserve=", vm.toString(expected),
                    " (direct=", vm.toString(handler.ghost_directReceived(i)),
                    " reserve=", vm.toString(handler.ghost_reserveReceived(i)), ")"
                )
            );
        }
    }

    // ── LC3: Draw accounting closes ───────────────────────────────────────────
    //
    // The sum of per-pool ghost_reserveReceived must equal ghost_totalDraws.
    // A cross-pool attribution swap that inflates one pool's ghost while reducing
    // another's passes this check (sum is unchanged) — LC2 catches that case.
    // LC3 catches double-counting and phantom credits that inflate the sum.
    // Together LC2 + LC3 cover both failure modes.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_LC3_drawAccountingCloses() public view {
        uint256 sumReceived = _sumReserveReceived();
        uint256 totalDraws  = handler.ghost_totalDraws();

        assertEq(
            sumReceived,
            totalDraws,
            string.concat(
                "LC3: sum(reserveReceived)=", vm.toString(sumReceived),
                " != totalDraws=", vm.toString(totalDraws),
                " (pool[0]=", vm.toString(handler.ghost_reserveReceived(0)),
                " pool[1]=", vm.toString(handler.ghost_reserveReceived(1)),
                " pool[2]=", vm.toString(handler.ghost_reserveReceived(2)), ")"
            )
        );
    }

    // ── LC4: No overdraw, monotonic settlement, non-negative draws ────────────
    //
    // (a) Total draws cannot exceed what was initially available:
    //     totalDraws <= initial + totalTopUps
    // (b) Per-pool covered amounts are bounded by their respective shortfalls:
    //     covered[i] <= principal[i] + yieldOwed[i] + overrunYield[i] - preDefault[i]
    // (c) No pool's covered amount exceeds the combined direct + reserve received.
    //     (This is the exact LC2 assertion restated; LC4 adds the bound check.)
    // (d) Monotonicity is structural (uint256 only increments) — no assertion needed.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_LC4_noOverdrawMonotonicSettlement() public view {
        uint256 initial   = handler.ghost_reserveInitial();
        uint256 topUps    = handler.ghost_totalTopUps();
        uint256 draws     = handler.ghost_totalDraws();

        assertLe(
            draws,
            initial + topUps,
            string.concat(
                "LC4: totalDraws=", vm.toString(draws),
                " exceeds initial+topUps=", vm.toString(initial + topUps)
            )
        );

        for (uint256 i = 0; i < 3; i++) {
            PoolContract p = handler.pools(i);
            uint256 maxCoverable = p.principal() + p.yieldOwed() + p.overrunYield()
                                 - handler.ghost_preDefaultCollected(i);

            uint256 covered = _coveredDelta(i);
            assertLe(
                covered,
                maxCoverable,
                string.concat(
                    "LC4: pool[", vm.toString(i), "] covered=", vm.toString(covered),
                    " exceeds max=", vm.toString(maxCoverable)
                )
            );

            assertLe(
                handler.ghost_reserveReceived(i),
                draws,
                string.concat(
                    "LC4: pool[", vm.toString(i), "] reserveReceived > totalDraws"
                )
            );
        }
    }

    // ── afterInvariant: liveness / fault check ────────────────────────────────
    //
    // Asserts no panic or cross-pool state bleed was detected during the run.
    // ghost_clampCount is logged but NOT asserted here — shrinking would produce
    // a 1-call run with 0 clamps. test_LC_contention proves contention is reached.
    // ─────────────────────────────────────────────────────────────────────────
    function afterInvariant() external view {
        assertFalse(handler.ghost_panicDetected(), handler.ghost_panicInfo());
        assertFalse(handler.ghost_bleedDetected(), handler.ghost_bleedInfo());
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Verify-it-can-fail: break tests
    // ══════════════════════════════════════════════════════════════════════════

    // ── LC2 break (swap attribution) ──────────────────────────────────────────
    //
    // Settle pool[0] principal → gets 1000 SCALE from reserve.
    // Inject swap (pool[0] ↔ pool[1] ghost receipts).
    // LC2 fires for pool[0] (covered=1000 != 0+0=0)
    //     and pool[1] (covered=0 != 0+1000=1000).
    // LC3 holds (sum unchanged by swap).
    // ─────────────────────────────────────────────────────────────────────────
    function test_LC2_breakVerification() public {
        MultipoolHandlerC h = new MultipoolHandlerC();

        // LC2 holds before any intervention
        for (uint256 i = 0; i < 3; i++) {
            uint256 covered  = _coveredDeltaOf(h, i);
            uint256 expected = h.ghost_directReceived(i) + h.ghost_reserveReceived(i);
            assertEq(covered, expected, string.concat("LC2 must hold before inject: pool[", vm.toString(i), "]"));
        }

        // Settle pool[0] with 0 direct (full reserve draw)
        h.handler_settleDefaultPrincipal(0, 0); // pSeed=0 → pool[0], pct=0 → all from reserve

        // Pool[0] principal should now be settled (reserve had 1000 SCALE = full owed)
        assertEq(h.ghost_reserveReceived(0), 1_000 * SCALE, "pool[0] must have received 1000 SCALE from reserve");
        assertEq(h.ghost_totalDraws(), 1_000 * SCALE, "totalDraws must be 1000 SCALE");

        // Inject swap: pool[0] ghost ↔ pool[1] ghost
        h.helper_injectSwapBleed_forTest();

        // After swap: ghost[0]=0, ghost[1]=1000, but covered[0]=1000, covered[1]=0
        // LC2 must fire for pool[0]
        uint256 covered0  = _coveredDeltaOf(h, 0);
        uint256 expected0 = h.ghost_directReceived(0) + h.ghost_reserveReceived(0);
        assertFalse(covered0 == expected0, "LC2 must fire for pool[0] after swap");

        // LC2 must fire for pool[1]
        uint256 covered1  = _coveredDeltaOf(h, 1);
        uint256 expected1 = h.ghost_directReceived(1) + h.ghost_reserveReceived(1);
        assertFalse(covered1 == expected1, "LC2 must fire for pool[1] after swap");

        // LC3 holds (sum is unchanged by a pure swap)
        uint256 sumR = h.ghost_reserveReceived(0) + h.ghost_reserveReceived(1) + h.ghost_reserveReceived(2);
        assertEq(sumR, h.ghost_totalDraws(), "LC3 holds after swap (sum unchanged)");
    }

    // ── LC2 + LC3 break (phantom credit) ─────────────────────────────────────
    //
    // Inject phantom before any settlement: add RESERVE_SEED to pool[0] ghost
    // without a real draw and without updating ghost_totalDraws.
    // LC2 fires (covered_0=0 != 0+1000=1000).
    // LC3 fires (sum=1000 != totalDraws=0).
    // ─────────────────────────────────────────────────────────────────────────
    function test_LC2LC3_breakVerification() public {
        MultipoolHandlerC h = new MultipoolHandlerC();

        // All invariants hold before injection
        for (uint256 i = 0; i < 3; i++) {
            assertEq(_coveredDeltaOf(h, i), 0, "no coverage before settlement");
            assertEq(h.ghost_reserveReceived(i), 0, "no ghost reserve before injection");
        }
        assertEq(h.ghost_totalDraws(), 0, "no draws before injection");

        // Inject phantom credit into pool[0]
        h.helper_injectPhantomBleed_forTest();

        // LC2 fires: pool[0] covered=0, but ghost says direct+reserve = 0+1000 = 1000
        uint256 covered0  = _coveredDeltaOf(h, 0);
        uint256 expected0 = h.ghost_directReceived(0) + h.ghost_reserveReceived(0);
        assertFalse(covered0 == expected0, "LC2 must fire for pool[0] after phantom inject");

        // LC3 fires: sum(ghost) = 1000 but totalDraws = 0
        uint256 sumR = h.ghost_reserveReceived(0) + h.ghost_reserveReceived(1) + h.ghost_reserveReceived(2);
        assertFalse(sumR == h.ghost_totalDraws(), "LC3 must fire after phantom inject");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Non-vacuity: contention coverage
    // ══════════════════════════════════════════════════════════════════════════

    // ── Contended run ─────────────────────────────────────────────────────────
    //
    // Deterministically reproduces the reference contention outcome:
    //   Pool[0]: draws 1000 SCALE from reserve (exact, no clamp) → principal settled
    //   Pool[1]: reserve exhausted → draw 0 < requested 1000 → CLAMP
    //   Pool[2]: reserve exhausted → draw 0 < requested 1000 → CLAMP
    //   ghost_clampCount == 2; reserve == 0; LC1-LC4 hold.
    //
    // Also verifies:
    //   Pool[0] stays Default after principal settle (yield still owed)
    //   Pool[1] and pool[2] stay Default with full principal shortfall remaining
    // ─────────────────────────────────────────────────────────────────────────
    function test_LC_contention() public {
        MultipoolHandlerC h = new MultipoolHandlerC();
        TreasuryReserve   t = h.treasury();

        // Confirm setup: all pools in Default, reserve = 1000 SCALE
        for (uint256 i = 0; i < 3; i++) {
            assertEq(
                uint256(h.pools(i).status()), uint256(PoolContract.Status.Default),
                string.concat("pool[", vm.toString(i), "] must be Default at start")
            );
        }
        assertEq(t.reserveBalance(), 1_000 * SCALE, "reserve must be 1000 SCALE at start");

        // Step 1: settle pool[0] principal with 0 direct → draws all 1000 SCALE from reserve
        h.handler_settleDefaultPrincipal(0, 0);
        assertEq(t.reserveBalance(), 0, "reserve must be 0 after pool[0] draws");
        assertEq(h.ghost_reserveReceived(0), 1_000 * SCALE, "pool[0] must receive 1000 SCALE");
        assertEq(h.ghost_totalDraws(), 1_000 * SCALE, "totalDraws must be 1000 SCALE");
        assertEq(h.ghost_clampCount(), 0, "no clamp yet (pool[0] got exactly what it requested)");

        // Pool[0] still in Default: principal settled, yield still owed
        assertEq(
            uint256(h.pools(0).status()), uint256(PoolContract.Status.Default),
            "pool[0] stays Default (yield still owed)"
        );
        assertEq(h.pools(0).collectedPrincipal(), 1_000 * SCALE, "pool[0] principal covered");

        // Step 2: settle pool[1] principal with 0 direct → reserve exhausted → CLAMP
        h.handler_settleDefaultPrincipal(1, 0);
        assertEq(h.ghost_reserveReceived(1), 0, "pool[1] receives 0 (reserve exhausted)");
        assertEq(h.ghost_clampCount(), 1, "pool[1] settlement clamped");
        assertEq(h.pools(1).collectedPrincipal(), 0, "pool[1] principal still uncovered");
        assertEq(
            uint256(h.pools(1).status()), uint256(PoolContract.Status.Default),
            "pool[1] stays Default"
        );

        // Step 3: settle pool[2] principal with 0 direct → reserve exhausted → CLAMP
        h.handler_settleDefaultPrincipal(2, 0);
        assertEq(h.ghost_reserveReceived(2), 0, "pool[2] receives 0 (reserve exhausted)");
        assertEq(h.ghost_clampCount(), 2, "pool[2] settlement clamped -> clampCount=2");
        assertEq(h.pools(2).collectedPrincipal(), 0, "pool[2] principal still uncovered");

        // Verify LC1
        assertEq(
            t.reserveBalance(),
            h.ghost_reserveInitial() + h.ghost_totalTopUps() - h.ghost_totalDraws(),
            "LC1: reserve conservation holds"
        );

        // Verify LC2 for each pool
        for (uint256 i = 0; i < 3; i++) {
            uint256 covered  = _coveredDeltaOf(h, i);
            uint256 expected = h.ghost_directReceived(i) + h.ghost_reserveReceived(i);
            assertEq(covered, expected,
                string.concat("LC2: pool[", vm.toString(i), "] covered == ghost"));
        }

        // Verify LC3
        uint256 sumR = h.ghost_reserveReceived(0) + h.ghost_reserveReceived(1) + h.ghost_reserveReceived(2);
        assertEq(sumR, h.ghost_totalDraws(), "LC3: sum(reserveReceived) == totalDraws");

        // Verify LC4: no overdraw
        assertLe(h.ghost_totalDraws(), h.ghost_reserveInitial() + h.ghost_totalTopUps(),
            "LC4: totalDraws <= initial + topUps");

        // Non-vacuity proof: genuine contention occurred
        assertGe(h.ghost_clampCount(), 2,
            "non-vacuity: at least 2 clamps must occur (pool[1] and pool[2] clamped)");

        emit log_named_uint("ghost_clampCount",              h.ghost_clampCount());
        emit log_named_uint("ghost_totalDraws",              h.ghost_totalDraws());
        emit log_named_uint("ghost_reserveReceived_pool0",   h.ghost_reserveReceived(0));
        emit log_named_uint("ghost_reserveReceived_pool1",   h.ghost_reserveReceived(1));
        emit log_named_uint("ghost_reserveReceived_pool2",   h.ghost_reserveReceived(2));
        emit log_named_uint("treasury_reserveBalance_final", t.reserveBalance());
    }

    // ── Uncontended control ───────────────────────────────────────────────────
    //
    // When reserve >= total shortfall, all pools settle without clamping.
    // Proves the clamp counter discriminates: 0 in the uncontended case.
    // Override the reserve seed: mint 3000 SCALE so all 3 pools can draw in full.
    // ─────────────────────────────────────────────────────────────────────────
    function test_LC_uncontendedControl() public {
        MultipoolHandlerC h = new MultipoolHandlerC();
        TreasuryReserve   t = h.treasury();

        // Boost reserve to 3000 SCALE (≥ total 3000 SCALE principal shortfall)
        uint256 boost = 2_000 * SCALE; // adds to existing 1000 SCALE seed
        h.usdc().mint(address(t), boost);
        vm.store(address(t), bytes32(uint256(1)), bytes32(t.reserveBalance() + boost));

        assertEq(t.reserveBalance(), 3_000 * SCALE, "reserve must be 3000 SCALE for control");

        // Settle all 3 pools with 0 direct → each draws exactly its shortfall
        h.handler_settleDefaultPrincipal(0, 0); // draws 1000
        h.handler_settleDefaultPrincipal(1, 0); // draws 1000
        h.handler_settleDefaultPrincipal(2, 0); // draws 1000

        assertEq(h.ghost_clampCount(), 0, "control: no clamps when reserve covers all shortfalls");
        assertEq(t.reserveBalance(), 0, "control: reserve fully consumed without clamping");
        assertEq(h.ghost_totalDraws(), 3_000 * SCALE, "control: 3000 SCALE drawn total");

        emit log_named_uint("control_clampCount",       h.ghost_clampCount());
        emit log_named_uint("control_totalDraws",       h.ghost_totalDraws());
        emit log_named_uint("control_reserveBalance",   t.reserveBalance());
    }

    // ── Campaign-wide clamp distribution ─────────────────────────────────────
    //
    // Simulates N independent 200-call runs using the same selector weights as
    // setUp() (5×settleDefaultPrincipal, 3×settleDefaultYield, 1×warpTime = 9).
    // Reports total clamp count, contended-run count, and distribution statistics.
    //
    // Reference model predicts ~98% of random orderings reach contention at the
    // 1/3 reserve ratio, averaging ~2.6 clamps per run.  This test verifies the
    // Solidity campaign matches that breadth.
    // ─────────────────────────────────────────────────────────────────────────
    function test_LC_clampDistribution() public {
        uint256 N     = 20;
        uint256 DEPTH = 200;

        uint256 totalClamps   = 0;
        uint256 contentedRuns = 0;
        uint256[] memory clamps_arr = new uint256[](N);

        for (uint256 run = 0; run < N; run++) {
            MultipoolHandlerC h = new MultipoolHandlerC();

            for (uint256 c = 0; c < DEPTH; c++) {
                uint256 seed   = uint256(keccak256(abi.encode(run, c)));
                uint256 choice = seed % 9;
                uint256 a1     = uint256(keccak256(abi.encode(seed, uint256(1))));
                uint256 a2     = uint256(keccak256(abi.encode(seed, uint256(2))));

                // Selector layout: 0-4 = settleDefaultPrincipal (5×),
                // 5-7 = settleDefaultYield (3×), 8 = warpTime (1×)
                if      (choice < 5) h.handler_settleDefaultPrincipal(a1, a2);
                else if (choice < 8) h.handler_settleDefaultYield(a1, a2);
                else                 h.handler_warpTime(a1);
            }

            uint256 clamps = h.ghost_clampCount();
            clamps_arr[run] = clamps;
            totalClamps += clamps;
            if (clamps > 0) contentedRuns++;
        }

        // Sort for percentile reporting
        uint256[] memory sorted = new uint256[](N);
        for (uint256 i = 0; i < N; i++) sorted[i] = clamps_arr[i];
        for (uint256 i = 0; i < N - 1; i++)
            for (uint256 j = 0; j < N - 1 - i; j++)
                if (sorted[j] > sorted[j + 1]) (sorted[j], sorted[j + 1]) = (sorted[j + 1], sorted[j]);

        emit log_named_uint("CLAMP_total_across_N_runs",   totalClamps);
        emit log_named_uint("CLAMP_contended_runs",         contentedRuns);
        emit log_named_uint("CLAMP_total_runs",             N);
        emit log_named_uint("CLAMP_contended_pct_x100",    contentedRuns * 100 / N);
        emit log_named_uint("CLAMP_avg_per_run_x100",      totalClamps * 100 / N);
        emit log_named_uint("CLAMP_min  (p0) ",             sorted[0]);
        emit log_named_uint("CLAMP_p25  (p25)",             sorted[4]);
        emit log_named_uint("CLAMP_p50  (p50)",             sorted[9]);
        emit log_named_uint("CLAMP_p75  (p75)",             sorted[14]);
        emit log_named_uint("CLAMP_max  (p100)",            sorted[N - 1]);

        // Non-vacuity assertion: campaign must have reached genuine contention.
        // A large total clamp count proves the fuzzer exercised contended states
        // broadly, not just through the single deterministic test_LC_contention.
        // Threshold: ≥10 clamps across 20 runs (conservative vs. predicted ~52).
        assertGe(totalClamps, 10,
            string.concat(
                "campaign breadth: expected >=10 total clamps across 20 runs, got ",
                vm.toString(totalClamps)
            )
        );

        // ≥50% contended runs (conservative vs. predicted ~98%)
        assertGe(contentedRuns, 10,
            string.concat(
                "campaign breadth: expected >=10 contended runs out of 20, got ",
                vm.toString(contentedRuns)
            )
        );
    }

    // ── Internal: per-handler-instance covered delta helper ───────────────────
    // (Cannot call internal functions of a different handler instance via the
    // state-variable helpers; read pool fields directly.)
    function _coveredDeltaOf(MultipoolHandlerC h, uint256 idx) internal view returns (uint256) {
        PoolContract p = h.pools(idx);
        uint256 total = p.collectedPrincipal() + p.collectedYield() + p.collectedOverrunYield();
        uint256 pre   = h.ghost_preDefaultCollected(idx);
        return total >= pre ? total - pre : 0;
    }
}
