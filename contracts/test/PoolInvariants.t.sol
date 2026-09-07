// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "./PoolHandler.sol";
import "../src/PoolContract.sol";
import "../src/MathLib.sol";

/// @dev Phase 2 — Foundry invariant tests.
///
/// Seven invariants checked after every random handler call:
///
///   I1  Cash conservation  — pool USDC == tracked buckets
///   I2  Partition identity — availableToDd + outstanding + collectedPrincipal == principal
///   I3  F1 / claim-timing  — no LP can over-claim their yield share
///   I4  Reserve non-neg    — treasury.reserveBalance >= 0  (uint, always true)
///       Reserve monotone   — reserveBalance never exceeds topups minus draws
///   I5  Funding-credit     — dollarSeconds >= fundingCredit + principal*span after lock
///   I6  Default fee clear  — protocolFees == 0 while status == Default
///   I7  One-pool-per-PSP   — factory.psps[PSP].activePool is pool OR 0 (released)
///
/// Each invariant is checked in its own `invariant_*` function so Foundry reports
/// them individually.
contract PoolInvariants is Test {
    PoolHandler handler;

    function setUp() public {
        handler = new PoolHandler();
        targetContract(address(handler));

        // Weighted selector: deposit 10x, appendAndDraw 3x, repay 3x, others 1x = 27 total.
        // Deposit at 10x makes degenerate runs (finalize before enough deposits) a minority
        // (~10-15%) while still leaving finalizeFunding at 1x to exercise both:
        //   Active path (softCap met before finalize) — draw/repay cycles
        //   Unsuccessful path (finalize after 1-2 deposits below softCap=3 SCALE) — I8 cap-path
        bytes4[] memory selectors = new bytes4[](27);
        selectors[0]  = handler.handler_deposit.selector;  // deposit 10x
        selectors[1]  = handler.handler_deposit.selector;
        selectors[2]  = handler.handler_deposit.selector;
        selectors[3]  = handler.handler_deposit.selector;
        selectors[4]  = handler.handler_deposit.selector;
        selectors[5]  = handler.handler_deposit.selector;
        selectors[6]  = handler.handler_deposit.selector;
        selectors[7]  = handler.handler_deposit.selector;
        selectors[8]  = handler.handler_deposit.selector;
        selectors[9]  = handler.handler_deposit.selector;
        selectors[10] = handler.handler_withdraw.selector;
        selectors[11] = handler.handler_finalizeFunding.selector;
        selectors[12] = handler.handler_draw.selector;  // draw 3x
        selectors[13] = handler.handler_draw.selector;
        selectors[14] = handler.handler_draw.selector;
        selectors[15] = handler.handler_repay.selector;          // repay 3x
        selectors[16] = handler.handler_repay.selector;
        selectors[17] = handler.handler_repay.selector;
        selectors[18] = handler.handler_payIdleFees.selector;
        selectors[19] = handler.handler_claimYield.selector;
        selectors[20] = handler.handler_claimPrincipal.selector;
        selectors[21] = handler.handler_declareDefault.selector;
        selectors[22] = handler.handler_settleDefaultPrincipal.selector;
        selectors[23] = handler.handler_settleDefaultYield.selector;
        selectors[24] = handler.handler_warpTime.selector;
        selectors[25] = handler.handler_warpToLock.selector;
        selectors[26] = handler.handler_warpToMaturity.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _pool()     internal view returns (PoolContract)    { return handler.pool(); }
    function _treasury() internal view returns (TreasuryReserve) { return handler.treasury(); }
    function _usdc()     internal view returns (IERC20)          { return IERC20(address(handler.usdc())); }

    // ── I0: No arithmetic panic in any pool call ──────────────────────────────
    //
    // Arithmetic panics (Panic(0x11) overflow, 0x12 div-by-zero, 0x32 OOB) are
    // caught by the typed catch Panic clause in each handler and recorded in
    // ghost_panicDetected. A bare catch {} does NOT capture Panic — only typed
    // catch Panic does. This invariant surfaces any detected panic as a failing
    // counterexample with the handler name and panic code.
    //
    // fail_on_revert=false (foundry.toml default): handler reverts are discarded
    // silently. Only the ghost+invariant path reliably surfaces panics.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I0_noPanicInPool() public view {
        assertFalse(handler.ghost_panicDetected(), handler.ghost_panicInfo());
    }

    // ── I1: Cash conservation ─────────────────────────────────────────────────
    //
    // All USDC inside the pool must equal the sum of its tracked ledger buckets.
    // Nothing is assumed from token.balanceOf on the liabilities side — the
    // assets side is always token.balanceOf; we check it equals tracked buckets.
    //
    // Decomposition:
    //   pool USDC = (principal - outstanding - claimedPrincipal)   [principal ledger]
    //             + (collectedYield - claimedYield)                [yield ledger]
    //             + reservedYield                                   [pre-maturity reserve]
    //             + (collectedOverrunYield - claimedOverrunYield)  [extension ledger]
    //             + (collectedBonus - claimedBonus)                [bonus ledger]
    //             + protocolFees                                    [protocol share]
    //
    // Note: accIdleFees/accPenalty are OWED but not yet paid — they are NOT in
    // the pool's USDC balance until PSP calls payAccruedIdleFees.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I1_cashConservation() public view {
        PoolContract p = _pool();
        if (p.principal() == 0) return; // no deposits yet, trivially empty

        uint256 actualUSDC = _usdc().balanceOf(address(p));

        uint256 tracked =
            (p.principal() - p.outstanding() - p.claimedPrincipal())
            + (p.collectedYield() - p.claimedYield())
            + p.reservedYield()
            + (p.collectedOverrunYield() - p.claimedOverrunYield())
            + (p.collectedBonus() - p.claimedBonus())
            + p.protocolFees();

        assertEq(actualUSDC, tracked,
            "I1: pool USDC != tracked ledger buckets");
    }

    // ── I2: Partition identity ────────────────────────────────────────────────
    //
    // Once the pool is Active (after _lock), every unit of principal lives in
    // exactly one of three buckets:
    //   outstanding + availableToDd + collectedPrincipal = principal
    //
    // In Funding, availableToDd is 0 and no principal has moved — the invariant
    // is not applicable yet (LP deposits are tracked via principal alone).
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I2_partitionIdentity() public view {
        PoolContract p = _pool();
        PoolContract.Status s = p.status();
        // Partition only applies after _lock (Active/Closed/Default).
        // Funding: availableToDd not set. Unsuccessful: _lock was never called.
        if (s == PoolContract.Status.Funding ||
            s == PoolContract.Status.Unsuccessful ||
            p.principal() == 0) return;

        assertEq(
            p.outstanding() + p.availableToDd() + p.collectedPrincipal(),
            p.principal(),
            "I2: outstanding + available + collectedPrincipal != principal"
        );
    }

    // ── I3: F1 / claim-timing neutrality ─────────────────────────────────────
    //
    // No LP can claim more yield than their dollar-seconds share of yieldOwed.
    // Checked via the pool-level caps: claimedYield <= collectedYield,
    // and per-LP: pos.claimedYield <= base_share * collectedYield.
    //
    // Simplified here: pool-level claimed counters can never exceed collected.
    // (Per-LP full F1 proof would require iterating all LP positions.)
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I3_F1_noOverClaim() public view {
        PoolContract p = _pool();

        assertLe(p.claimedYield(), p.collectedYield(),
            "I3: claimedYield > collectedYield");
        assertLe(p.claimedOverrunYield(), p.collectedOverrunYield(),
            "I3: claimedOverrunYield > collectedOverrunYield");
        assertLe(p.claimedBonus(), p.collectedBonus(),
            "I3: claimedBonus > collectedBonus");
        assertLe(p.claimedPrincipal(), p.collectedPrincipal(),
            "I3: claimedPrincipal > collectedPrincipal");

        // F1 per LP — verify neither LP's claimed yield exceeds their ds share
        if (p.dollarSeconds() == 0 || p.principal() == 0) return;
        address LP_A = handler.LP_A();
        address LP_B = handler.LP_B();

        _checkLpF1(p, LP_A);
        _checkLpF1(p, LP_B);
    }

    function _checkLpF1(PoolContract p, address lp) internal view {
        // getLpPosition returns (lpPrincipal, lpDollarSeconds, claimableYield, claimablePrincipal, claimableOverrun, claimableBonus)
        (uint256 lpPrin, uint256 lpDs, , , , ) = p.getLpPosition(lp);
        if (lpPrin == 0 || p.dollarSeconds() == 0 || p.collectedYield() == 0) return;
        uint256 totalDs = p.dollarSeconds();

        // Access claimedYield via auto-getter tuple destructuring
        // lpPositions(lp) returns (principal, fundingCredit, lastUpdate, dollarSeconds,
        //                          claimedYield, claimedPrincipal, claimedOverrunYield, claimedBonus, finalized)
        (, , , , uint256 lpClaimedYield, , , , ) = p.lpPositions(lp);

        // LP's claimedYield * totalDs must not exceed lpDs * collectedYield
        // (equivalent to: lpClaimedYield <= lpDs/totalDs * collectedYield, scaled up)
        assertLe(
            lpClaimedYield * totalDs,
            lpDs * p.collectedYield(),
            "I3-F1: LP claimed more yield than their ds-share"
        );
    }

    // ── I4: Treasury USDC conservation ────────────────────────────────────────
    //
    // All five USDC-moving paths in TreasuryReserve update exactly one counter
    // in lockstep with the token transfer:
    //   topUp           → reserveBalance += amount; transferFrom
    //   depositImFees   → imFeesBalance  += amount; transferFrom
    //   drawReserve     → reserveBalance -= drawn;  transfer
    //   withdrawReserve → reserveBalance -= amount; transfer
    //   withdrawImFees  → imFeesBalance  -= amount; transfer
    // No receive/fallback, no sweep, no unaccounted path exists.
    // Therefore: balanceOf(treasury) == reserveBalance + imFeesBalance always.
    //
    // The old check (reserveBalance <= reserveTarget) was trivially true:
    // topUp clamps to the shortfall, so the balance can never exceed the target.
    // It could never fire. This conservation check CAN fire (deal() injection).
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I4_reserveConservation() public view {
        TreasuryReserve t = _treasury();
        assertEq(
            _usdc().balanceOf(address(t)),
            t.reserveBalance() + t.imFeesBalance(),
            "I4: treasury USDC != reserveBalance + imFeesBalance"
        );
    }

    // ── I5: Funding-credit conservation ──────────────────────────────────────
    //
    // After _lock:
    //   dollarSeconds == fundingCredit + principal * span
    //
    // The fundingCredit captures the pre-lock accumulation. Once span is fixed,
    // dollarSeconds is fully determined and must not change post-lock (it is
    // only rebased downward in declareDefault pre-maturity, where the span
    // shortens — in that case dollarSeconds = fundingCredit + principal * newSpan).
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I5_fundingCreditConservation() public view {
        PoolContract p = _pool();
        if (p.status() == PoolContract.Status.Funding) return;
        if (p.status() == PoolContract.Status.Unsuccessful) return;
        if (p.principal() == 0) return;
        if (p.span() == 0) return;

        assertEq(
            p.dollarSeconds(),
            p.fundingCredit() + p.principal() * p.span(),
            "I5: dollarSeconds != fundingCredit + principal*span"
        );
    }

    // ── I6: protocol_fees == 0 in Default ────────────────────────────────────
    //
    // When the pool enters Default, declareDefault() flushes reservedYield +
    // protocolFees into priority buckets (yield → principal). Any remainder
    // flows back as protocolFees ONLY if yield and overrun are already fully
    // covered. In the typical default case (principal shortfall), the remainder
    // goes to principal. So protocolFees must be 0 in Default.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I6_noProtocolFeesInDefault() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Default) return;
        assertEq(p.protocolFees(), 0,
            "I6: protocolFees != 0 in Default status");
    }

    // ── I7: One live pool per PSP ─────────────────────────────────────────────
    //
    // The factory enforces at most one active pool per PSP wallet. Once a pool
    // moves to Closed or Unsuccessful, releasePsp() clears the slot.
    // Invariant: psps[PSP].activePool is either the handler's pool or address(0).
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I7_onePoolPerPsp() public view {
        (, address activePool) = handler.factory().psps(handler.PSP());
        address poolAddr = address(handler.pool());
        assertTrue(
            activePool == poolAddr || activePool == address(0),
            "I7: factory has unexpected activePool for PSP"
        );
    }

    // ── I8: LP funding-credit symmetry (exact equality) ──────────────────────
    //
    // During Funding and Unsuccessful, the following exact equality holds:
    //
    //   pool.fundingCredit == Σ_k (pos_k.fundingCredit + pos_k.principal * (pool.lastUpdate - pos_k.lastUpdate))
    //
    // Proof of equality: _globalCheckpoint and _lpCheckpoint are always called
    // together (deposit/withdraw), advancing both to the same block.timestamp.
    // The global accrues total_principal*dt; the LP accrues lp_principal*dt.
    // The "pending" term captures each LP's accrual that the global has recorded
    // but the LP's position has not yet lazily synced.  Together they sum exactly.
    //
    // Sub-property: pool.lastUpdate >= pos.lastUpdate for every LP, because the
    // global checkpoint fires on every LP interaction (so pool.lastUpdate advances
    // whenever any LP's lastUpdate does).  Violation of this sub-property means
    // an LP checkpoint ran further than the global — which is the exact failure
    // mode of Bug 2 (missing Unsuccessful cap).
    //
    // Why not >=: the weaker inequality was implemented first and is correct, but
    // it is blind to the opposite desync (global too large / LP under-credited).
    // The equality catches both directions.
    //
    // LP universe: handler uses only LP_A and LP_B (lpSeed % 2); no other address
    // can reach pool.deposit() through the handler, so the sum is complete.
    // ─────────────────────────────────────────────────────────────────────────────
    function invariant_I8_lpFundingCreditSymmetry() public view {
        PoolContract p = _pool();
        PoolContract.Status s = p.status();
        if (s != PoolContract.Status.Funding && s != PoolContract.Status.Unsuccessful) return;
        if (p.principal() == 0) return;

        uint256 poolLastUpdate = p.lastUpdate();

        (uint256 principalA, uint256 fcA, uint256 lastUpdateA, , , , , , ) = p.lpPositions(handler.LP_A());
        (uint256 principalB, uint256 fcB, uint256 lastUpdateB, , , , , , ) = p.lpPositions(handler.LP_B());

        // Sub-property: pool.lastUpdate must be >= each LP's lastUpdate.
        // If violated (LP ran past pool), the pending subtraction below would underflow.
        assertGe(poolLastUpdate, lastUpdateA, "I8a: pool.lastUpdate < LP_A.lastUpdate");
        assertGe(poolLastUpdate, lastUpdateB, "I8b: pool.lastUpdate < LP_B.lastUpdate");

        uint256 sumLp = (fcA + principalA * (poolLastUpdate - lastUpdateA))
                      + (fcB + principalB * (poolLastUpdate - lastUpdateB));

        assertEq(
            p.fundingCredit(),
            sumLp,
            "I8: pool.fundingCredit != sum(LP (fundingCredit + pending))"
        );
    }

    // ── afterInvariant: per-run cycle health (Active path only) ──────────────
    //
    // Answers: "do I1-I8 ever get violated across whatever states the fuzzer reaches?"
    // That is the campaign's job — NOT detecting degenerate runs (low-exercise runs
    // are a coverage-quality concern, measured separately in test_drawsDistribution).
    //
    // Single assertion: if the pool went Active this run, at least 1 draw must have
    // succeeded. Threshold = 1, measured from test_drawsDistribution (N=20):
    //   Active-run draw distribution: p0=1, p25=1, p50=2, p75=5, max=5 (11 runs).
    //   p0=p25=1 — raising to 2 false-positives on 4 of 11 healthy 1-draw runs
    //   (run1/17/18/19 each drew once; their pools funded, drew, and matured normally).
    //
    // What this catches / does NOT catch:
    //   CATCHES: total draw failure — a drawable Active pool with 0 draws = definite stall.
    //   DOES NOT CATCH: weak-cycle stalls (drew once then stalled). The draw distribution
    //   is too compressed (max=5) to separate "healthy 1-draw run" from "stalled after 1".
    //   Finer stall detection would need a different signal (draw/repay ratio, cycle count)
    //   — documented limitation.
    //
    // Degenerate runs (pool Unsuccessful with principal==0, no LP positions) pass
    // this assertion by design — they exercised nothing, but they violated nothing.
    // Their rate is measured (and bounded) in test_drawsDistribution.
    // ─────────────────────────────────────────────────────────────────────────
    function afterInvariant() external view {
        if (!handler.ghost_poolWentActive()) return;

        // "Real draw opportunity" = a draw call that cleared the not-drawable early returns:
        //   - notActive:  status != Active OR pool past poolFinalityTs (no valid settlement day)
        //   - availZero:  availableToDd == 0 (principal collected after maturity, no draws left)
        //   - availSmall: 0 < avail < 1 SCALE (too small to draw minimum)
        //
        // realOpp counts calls that passed all three early-return checks and reached the
        // slot-lookup / appendOrder phase. If realOpp >= 1 but draws=0, something blocked
        // every real opportunity — appendFail / execFail / noFreeSlot — which is a stall.
        //
        // If realOpp == 0: no draw call ever had a real window to succeed (pool never drawable
        // during the run's Active phase, e.g. finalize fired late, avail went to 0 at maturity,
        // etc.). That is NOT a stall — skip the floor.
        uint256 realOpp = handler.ghost_draw_calls()
            - handler.ghost_draw_notActive()
            - handler.ghost_draw_availZero()
            - handler.ghost_draw_availSmall();
        if (realOpp == 0) return;

        assertGe(handler.ghost_drawSuccessCount(), 1,
            string.concat(
                "draws=",       vm.toString(handler.ghost_drawSuccessCount()),
                " drawCalls=",  vm.toString(handler.ghost_draw_calls()),
                " notActive=",  vm.toString(handler.ghost_draw_notActive()),
                " availZero=",  vm.toString(handler.ghost_draw_availZero()),
                " availSmall=", vm.toString(handler.ghost_draw_availSmall()),
                " noSlot=",     vm.toString(handler.ghost_draw_noFreeSlot()),
                " appFail=",    vm.toString(handler.ghost_draw_execFail()),
                " repays=",     vm.toString(handler.ghost_repaySuccessCount()),
                " repCalls=",   vm.toString(handler.ghost_repay_calls()),
                " repNoSlot=",  vm.toString(handler.ghost_repay_noSlot())
            ));
    }

    // ── Diagnostic: per-run draws / repays / coverage distribution ───────────
    //
    // Simulates N independent 200-call runs using the same 27-way weighted selector
    // as setUp() (deposit 10x, draw 3x, repay 3x, others 1x). Reports three buckets:
    //
    //   BUCKET_ACTIVE         — pool went Active; draw/repay cycles occurred
    //   BUCKET_UNSUCCESSFUL_LP — pool went Unsuccessful with principal>0 and ≥1 LP;
    //                            I8 cap-path exercised (meaningful)
    //   BUCKET_DEGENERATE     — pool went Unsuccessful with principal==0 / 0 LPs;
    //                            all invariants' principal==0 early-return fired (empty)
    //
    // Run this BEFORE the full campaign to calibrate afterInvariant() draw threshold.
    // Also run after any selector/param change to verify the distribution is healthy.
    // ─────────────────────────────────────────────────────────────────────────
    function test_drawsDistribution() public {
        uint256 N     = 20;
        uint256 DEPTH = 200;

        uint256[] memory draws_arr         = new uint256[](N);
        uint256[] memory repays_arr        = new uint256[](N);
        uint256[] memory drawCalls_arr     = new uint256[](N);
        uint256[] memory appendFail_arr    = new uint256[](N);
        uint256[] memory noFreeSlot_arr    = new uint256[](N);
        uint256[] memory notActive_arr     = new uint256[](N);
        uint256[] memory finalized_arr     = new uint256[](N);
        uint256[] memory deposits_arr      = new uint256[](N);
        bool[]    memory wentActive_arr    = new bool[](N);
        bool[]    memory wentUnsuc_arr     = new bool[](N);
        uint256[] memory principalFin_arr  = new uint256[](N);
        uint256[] memory lpCountFin_arr    = new uint256[](N);
        uint256[] memory pendingOrder_arr  = new uint256[](N);

        for (uint256 run = 0; run < N; run++) {
            PoolHandler h = new PoolHandler();

            for (uint256 c = 0; c < DEPTH; c++) {
                uint256 seed   = uint256(keccak256(abi.encode(run, c)));
                uint256 choice = seed % 27;
                uint256 a1     = uint256(keccak256(abi.encode(seed, uint256(1))));
                uint256 a2     = uint256(keccak256(abi.encode(seed, uint256(2))));
                uint256 a3     = uint256(keccak256(abi.encode(seed, uint256(3))));

                // Selector layout matches setUp(): 27 entries, weighted.
                // 0-9=deposit(10x), 10=withdraw, 11=finalizeFunding,
                // 12-14=appendAndDraw(3x), 15-17=repay(3x),
                // 18=payIdleFees, 19=claimYield, 20=claimPrincipal,
                // 21=declareDefault, 22=settleDefaultPrincipal,
                // 23=settleDefaultYield, 24=warpTime, 25=warpToLock, 26=warpToMaturity
                if      (choice <= 9)  h.handler_deposit(a1, a2);
                else if (choice == 10) h.handler_withdraw(a1, a2);
                else if (choice == 11) h.handler_finalizeFunding();
                else if (choice <= 14) h.handler_draw(a1, a2, a3);
                else if (choice <= 17) h.handler_repay(a1);
                else if (choice == 18) h.handler_payIdleFees();
                else if (choice == 19) h.handler_claimYield(a1);
                else if (choice == 20) h.handler_claimPrincipal(a1);
                else if (choice == 21) h.handler_declareDefault();
                else if (choice == 22) h.handler_settleDefaultPrincipal(a1);
                else if (choice == 23) h.handler_settleDefaultYield(a1);
                else if (choice == 24) h.handler_warpTime(a1);
                else if (choice == 25) h.handler_warpToLock();
                else                   h.handler_warpToMaturity();
            }

            draws_arr[run]        = h.ghost_drawSuccessCount();
            repays_arr[run]       = h.ghost_repaySuccessCount();
            drawCalls_arr[run]    = h.ghost_draw_calls();
            appendFail_arr[run]   = h.ghost_draw_execFail();
            noFreeSlot_arr[run]   = h.ghost_draw_noFreeSlot();
            notActive_arr[run]    = h.ghost_draw_notActive();
            finalized_arr[run]    = h.ghost_finalizeSuccessCount();
            deposits_arr[run]     = h.ghost_depositSuccessCount();
            wentActive_arr[run]   = h.ghost_poolWentActive();
            wentUnsuc_arr[run]    = h.ghost_poolWentUnsuccessful();
            principalFin_arr[run] = h.ghost_principalAtFinalize();
            lpCountFin_arr[run]   = h.ghost_lpCountAtFinalize();
            pendingOrder_arr[run] = 0;
        }

        // Three-bucket classification.
        uint256 bucketActive = 0;
        uint256 bucketUnsuccessfulLP = 0;
        uint256 bucketDegenerate = 0;
        for (uint256 i = 0; i < N; i++) {
            if (wentActive_arr[i]) {
                bucketActive++;
            } else if (wentUnsuc_arr[i] && principalFin_arr[i] > 0 && lpCountFin_arr[i] >= 1) {
                bucketUnsuccessfulLP++;
            } else {
                bucketDegenerate++;
            }
        }

        // Sort draws (Active-only) for percentiles.
        uint256 activeN = bucketActive;
        uint256[] memory activeSorted = new uint256[](activeN == 0 ? 1 : activeN);
        uint256 ai = 0;
        for (uint256 i = 0; i < N; i++)
            if (wentActive_arr[i]) activeSorted[ai++] = draws_arr[i];
        for (uint256 i = 0; i < (activeN > 1 ? activeN - 1 : 0); i++)
            for (uint256 j = 0; j < activeN - 1 - i; j++)
                if (activeSorted[j] > activeSorted[j + 1])
                    (activeSorted[j], activeSorted[j + 1]) = (activeSorted[j + 1], activeSorted[j]);

        uint256 drawSum = 0;
        uint256 repaySum = 0;
        for (uint256 i = 0; i < N; i++) { drawSum += draws_arr[i]; repaySum += repays_arr[i]; }

        emit log_named_uint("BUCKET_ACTIVE         ", bucketActive);
        emit log_named_uint("BUCKET_UNSUCCESSFUL_LP", bucketUnsuccessfulLP);
        emit log_named_uint("BUCKET_DEGENERATE     ", bucketDegenerate);

        // Coverage quality assertions: funded buckets must dominate.
        // v2 baseline (explicit finalize, no hard-cap auto-lock): ~6 Active / 3 Unsuccessful-with-LP / 11 Degen.
        // Threshold lowered to 40% for v2 (was 50% in v1 where hardCap auto-lock boosted Active count).
        // If degenerate runs exceed 60%, increase finalize weight or deposit weight in the selector.
        uint256 funded = bucketActive + bucketUnsuccessfulLP;
        assertGe(funded, N * 40 / 100,
            string.concat(
                "DIST: funded runs (Active + Unsuccessful-with-LP) < 40% of simulated runs. ",
                "Increase deposit weight or finalize weight. ",
                "active=", vm.toString(bucketActive),
                " unsuc_lp=", vm.toString(bucketUnsuccessfulLP),
                " degen=", vm.toString(bucketDegenerate)
            ));
        assertLe(bucketDegenerate, N * 60 / 100,
            string.concat(
                "DIST: degenerate runs > 60%. Selector does not adequately weight deposit+finalize. ",
                "active=", vm.toString(bucketActive),
                " unsuc_lp=", vm.toString(bucketUnsuccessfulLP),
                " degen=", vm.toString(bucketDegenerate)
            ));

        if (activeN > 0) {
            emit log_named_uint("ACTIVE_DRAWS_min (p0) ", activeSorted[0]);
            emit log_named_uint("ACTIVE_DRAWS_p25      ", activeSorted[activeN / 4]);
            emit log_named_uint("ACTIVE_DRAWS_p50      ", activeSorted[activeN / 2]);
            emit log_named_uint("ACTIVE_DRAWS_p75      ", activeSorted[activeN * 3 / 4]);
            emit log_named_uint("ACTIVE_DRAWS_max(p100)", activeSorted[activeN - 1]);
        }
        emit log_named_uint("DRAWS_avg_x10 (all)   ", drawSum * 10 / N);
        emit log_named_uint("REPAY_avg_x10 (all)   ", repaySum * 10 / N);

        // Min-draw run breakdown (for stall diagnosis).
        uint256 minIdx = 0;
        for (uint256 i = 1; i < N; i++)
            if (draws_arr[i] < draws_arr[minIdx]) minIdx = i;

        emit log_named_uint("MINRUN_idx            ", minIdx);
        emit log_named_uint("MINRUN_draws          ", draws_arr[minIdx]);
        emit log_named_uint("MINRUN_drawCalls      ", drawCalls_arr[minIdx]);
        emit log_named_uint("MINRUN_appendFail     ", appendFail_arr[minIdx]);
        emit log_named_uint("MINRUN_noFreeSlot     ", noFreeSlot_arr[minIdx]);
        emit log_named_uint("MINRUN_notActive      ", notActive_arr[minIdx]);
        emit log_named_uint("MINRUN_repays         ", repays_arr[minIdx]);
        emit log_named_uint("MINRUN_finalized      ", finalized_arr[minIdx]);
        emit log_named_uint("MINRUN_deposits       ", deposits_arr[minIdx]);
        emit log_named_uint("MINRUN_wentActive     ", wentActive_arr[minIdx] ? 1 : 0);
        emit log_named_uint("MINRUN_principalFin   ", principalFin_arr[minIdx]);

        // Full per-run table.
        for (uint256 i = 0; i < N; i++) {
            string memory bucket = wentActive_arr[i] ? "ACTIVE" :
                (wentUnsuc_arr[i] && principalFin_arr[i] > 0 && lpCountFin_arr[i] >= 1)
                    ? "UNSUC_LP" : "DEGEN";
            emit log_named_uint(
                string.concat(
                    "run", vm.toString(i),
                    " [", bucket, "]",
                    " dep=",  vm.toString(deposits_arr[i]),
                    " dr=",   vm.toString(draws_arr[i]),
                    " re=",   vm.toString(repays_arr[i]),
                    " dCal=", vm.toString(drawCalls_arr[i]),
                    " af=",   vm.toString(appendFail_arr[i]),
                    " po=",   vm.toString(pendingOrder_arr[i]),
                    " pFin=", vm.toString(principalFin_arr[i]),
                    " lps=",  vm.toString(lpCountFin_arr[i])
                ),
                0
            );
        }
    }

    // ── I9: Drawdown ledger integrity ─────────────────────────────────────────
    //
    // In Active status, outstanding must equal the sum of principals across all
    // live drawdowns. executeDrawdown and _removeDrawDown maintain this in lockstep.
    // Checked against the handler's refs[0..2]/ddActive[0..2] universe (complete:
    // the handler is the only caller, and it only uses these three refs).
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I9_drawdownLedger() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Active) return;

        uint256 sumPrincipal = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (handler.ddActive(i)) {
                (uint256 ddPrin, , ,) = p.drawDowns(handler.refs(i));
                sumPrincipal += ddPrin;
            }
        }
        assertEq(p.outstanding(), sumPrincipal,
            "I9: outstanding != sum of active drawdown principals");
    }

    // ── I10: accIdleFees and accPenalty zeroed in normal-maturity Closed ───────
    //
    // _checkFinality requires accIdleFees == 0 && accPenalty == 0 before closing.
    // (The default-close path _resolveDefaultIfWhole does NOT require this, so
    //  we skip when ghost_defaultDeclared to avoid false positives.)
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I10_closedIdleFeesZero() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return;
        if (handler.ghost_defaultDeclared()) return;
        assertEq(p.accIdleFees(), 0, "I10: accIdleFees != 0 in Closed (non-default)");
        assertEq(p.accPenalty(),  0, "I10: accPenalty != 0 in Closed (non-default)");
    }

    // ── I11: reservedYield == 0 in Closed ────────────────────────────────────
    //
    // All close paths zero reservedYield:
    //   _allocate (post-maturity else branch): reservedYield = 0
    //   declareDefault: reservedYield = 0
    // So any Closed pool must have reservedYield == 0.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I11_reservedYieldZeroInClosed() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return;
        assertEq(p.reservedYield(), 0, "I11: reservedYield != 0 in Closed");
    }

    // ── I12: Closed pool satisfies its close preconditions ───────────────────
    //
    // Both close paths (_checkFinality and _resolveDefaultIfWhole) require:
    //   collectedYield >= yieldOwed
    //   collectedOverrunYield >= overrunYield
    //   collectedPrincipal >= principal
    // Re-asserting post-close catches any path that closes without meeting obligations.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I12_closedIsConsistent() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return;
        if (p.principal() == 0) return;
        assertGe(p.collectedYield(),        p.yieldOwed(),    "I12: Closed with yield shortfall");
        assertGe(p.collectedOverrunYield(),  p.overrunYield(), "I12: Closed with overrun shortfall");
        assertGe(p.collectedPrincipal(),     p.principal(),    "I12: Closed with principal shortfall");
    }

    // ── I13: yieldOwed-dollarSeconds consistency post-lock ───────────────────
    //
    // At _lock: yieldOwed = mulDiv(dollarSeconds, aprAnnual, WAD * SPY). This
    // relationship holds through Active, normally-closed, Case-1 default (rebase
    // keeps both in sync, lines 604-606), and post-maturity default (neither
    // touched). It breaks only in Case 2 (earned <= collectedYield, line 608):
    // yieldOwed = collectedYield independently of dollarSeconds.
    //
    // Guard: skip only when Case 2 fired (ghost_defaultDeclared && !ghost_caseOneDefaulted).
    // ghost_caseOneDefaulted is set in handler_declareDefault when the identity
    // still holds immediately after the call, which covers Case 1 and post-maturity.
    // This allows I13 to check Case-1 Default/Closed states — the rebase path
    // where a partial-update bug (ds updated, yieldOwed not, or vice versa) is
    // most likely to surface.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I13_yieldOwedConsistency() public view {
        PoolContract p = _pool();
        if (p.status() == PoolContract.Status.Funding)      return;
        if (p.status() == PoolContract.Status.Unsuccessful)  return;
        if (p.principal() == 0 || p.span() == 0)            return;
        if (handler.ghost_defaultDeclared() && !handler.ghost_caseOneDefaulted()) return;
        assertEq(
            p.yieldOwed(),
            MathLib.mulDiv(p.dollarSeconds(), p.aprAnnual(), MathLib.WAD * MathLib.SECONDS_PER_YEAR),
            "I13: yieldOwed != mulDiv(dollarSeconds, apr, WAD*SPY)"
        );
    }

    // ── Break-test helpers (bool-returning mirrors of each invariant check) ────
    //
    // Each `_iNOk()` function returns `true` if the invariant holds, `false` if
    // it would fire. They mirror the corresponding `invariant_*` exactly, but
    // return a bool instead of asserting. Used exclusively by `test_I*_breakVerification`.

    function _i0Ok() internal view returns (bool) {
        return !handler.ghost_panicDetected();
    }

    function _i1Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.principal() == 0) return true;
        uint256 tracked =
            (p.principal() - p.outstanding() - p.claimedPrincipal())
            + (p.collectedYield() - p.claimedYield())
            + p.reservedYield()
            + (p.collectedOverrunYield() - p.claimedOverrunYield())
            + (p.collectedBonus() - p.claimedBonus())
            + p.protocolFees();
        return _usdc().balanceOf(address(p)) == tracked;
    }

    function _i2Ok() internal view returns (bool) {
        PoolContract p = _pool();
        PoolContract.Status s = p.status();
        if (s == PoolContract.Status.Funding || s == PoolContract.Status.Unsuccessful || p.principal() == 0) return true;
        return p.outstanding() + p.availableToDd() + p.collectedPrincipal() == p.principal();
    }

    function _i3PoolOk() internal view returns (bool) {
        PoolContract p = _pool();
        return p.claimedYield()        <= p.collectedYield()
            && p.claimedOverrunYield() <= p.collectedOverrunYield()
            && p.claimedBonus()        <= p.collectedBonus()
            && p.claimedPrincipal()    <= p.collectedPrincipal();
    }

    function _i3F1LpAOk() internal view returns (bool) {
        PoolContract p = _pool();
        address lp = handler.LP_A();
        (uint256 lpPrin, uint256 lpDs, , , , ) = p.getLpPosition(lp);
        if (lpPrin == 0 || p.dollarSeconds() == 0 || p.collectedYield() == 0) return true;
        (, , , , uint256 lpClaimedYield, , , , ) = p.lpPositions(lp);
        return lpClaimedYield * p.dollarSeconds() <= lpDs * p.collectedYield();
    }

    function _i4Ok() internal view returns (bool) {
        TreasuryReserve t = _treasury();
        return _usdc().balanceOf(address(t)) == t.reserveBalance() + t.imFeesBalance();
    }

    function _i5Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() == PoolContract.Status.Funding || p.status() == PoolContract.Status.Unsuccessful) return true;
        if (p.principal() == 0 || p.span() == 0) return true;
        return p.dollarSeconds() == p.fundingCredit() + p.principal() * p.span();
    }

    function _i6Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Default) return true;
        return p.protocolFees() == 0;
    }

    function _i7Ok() internal view returns (bool) {
        (, address activePool) = handler.factory().psps(handler.PSP());
        address poolAddr = address(handler.pool());
        return activePool == poolAddr || activePool == address(0);
    }

    function _i8SubOk() internal view returns (bool) {
        PoolContract p = _pool();
        PoolContract.Status s = p.status();
        if (s != PoolContract.Status.Funding && s != PoolContract.Status.Unsuccessful) return true;
        if (p.principal() == 0) return true;
        uint256 poolLU = p.lastUpdate();
        (, , uint256 lastUpdateA, , , , , , ) = p.lpPositions(handler.LP_A());
        (, , uint256 lastUpdateB, , , , , , ) = p.lpPositions(handler.LP_B());
        return poolLU >= lastUpdateA && poolLU >= lastUpdateB;
    }

    function _i8EqualityOk() internal view returns (bool) {
        PoolContract p = _pool();
        PoolContract.Status s = p.status();
        if (s != PoolContract.Status.Funding && s != PoolContract.Status.Unsuccessful) return true;
        if (p.principal() == 0) return true;
        uint256 poolLU = p.lastUpdate();
        (uint256 principalA, uint256 fcA, uint256 lastUpdateA, , , , , , ) = p.lpPositions(handler.LP_A());
        (uint256 principalB, uint256 fcB, uint256 lastUpdateB, , , , , , ) = p.lpPositions(handler.LP_B());
        if (poolLU < lastUpdateA || poolLU < lastUpdateB) return true; // sub-property violated; skip to avoid underflow
        uint256 sumLp = (fcA + principalA * (poolLU - lastUpdateA))
                      + (fcB + principalB * (poolLU - lastUpdateB));
        return p.fundingCredit() == sumLp;
    }

    // ── Break-test functions (verify-it-can-fail for I0–I8) ──────────────────
    //
    // Pattern: assertTrue(holds before) → perturb → assertFalse(holds after).
    // Each test confirms the invariant fires precisely on the corrupt state and
    // holds on the clean state (both directions verified).
    //
    // Group A — direct perturbation (no handler helper needed for setup).
    // Group B — requires handler helper to drive pool to guard-passing state.

    // I0 (Group A): inject panic via ghost path.
    // Guard: none (always evaluates ghost_panicDetected).
    function test_I0_breakVerification() public {
        assertTrue(_i0Ok(), "I0 should hold before injection");
        handler.helper_injectPanic_forTest();
        assertFalse(_i0Ok(), "I0 should fire after panic injection");
    }

    // I1 (Group A): inject 1 extra USDC into pool bypassing contract logic.
    // Guard: principal == 0 → skip. Need at least one deposit first.
    function test_I1_breakVerification() public {
        handler.handler_deposit(2 * 1e12, 0); // LP_A deposits 2 SCALE
        assertTrue(_i1Ok(), "I1 should hold before deal");
        uint256 cur = _usdc().balanceOf(address(_pool()));
        deal(address(handler.usdc()), address(_pool()), cur + 1);
        assertFalse(_i1Ok(), "I1 should fire after USDC injection into pool");
    }

    // I2 (Group B): inflate outstanding — breaks partition.
    // Guard: Active/Closed/Default only. helper_setupActive drives to Active.
    function test_I2_breakVerification() public {
        handler.helper_setupActive_forTest();
        assertTrue(_i2Ok(), "I2 should hold before corrupt");
        handler.helper_corruptOutstanding_forTest(1);
        assertFalse(_i2Ok(), "I2 should fire after outstanding inflation");
    }

    // I3 pool-level (Group A): set claimedYield > collectedYield.
    // Guard: none (assertLe always runs).
    function test_I3_poolLevel_breakVerification() public {
        assertTrue(_i3PoolOk(), "I3 pool-level should hold before corrupt");
        handler.helper_corruptPoolClaimedYield_forTest(1); // claimedYield=1, collectedYield=0
        assertFalse(_i3PoolOk(), "I3 pool-level should fire after claimedYield > collectedYield");
    }

    // I3-F1 LP (Group B): over-claim LP yield share.
    // Guard: dollarSeconds==0 || principal==0 || collectedYield==0 → skip.
    // First: drive to Active (dollarSeconds>0, principal>0).
    // Then:  corruptCollectedYield=1 (passes collectedYield!=0 guard).
    // Then:  corruptLpClaimedYield=2 → lpClaimedYield*totalDs >> lpDs*1 → fires.
    function test_I3_F1_breakVerification() public {
        handler.helper_setupActive_forTest();
        handler.helper_corruptCollectedYield_forTest(1); // pass guard: collectedYield != 0
        assertTrue(_i3F1LpAOk(), "I3-F1 should hold before LP corrupt (lpClaimedYield=0 <= share)");
        handler.helper_corruptLpClaimedYield_forTest(handler.LP_A(), 2);
        assertFalse(_i3F1LpAOk(), "I3-F1 should fire after LP over-claim");
    }

    // I4 (Group A): inject USDC directly into treasury bypassing accounting.
    // Guard: none (assertEq always runs).
    function test_I4_breakVerification() public {
        assertTrue(_i4Ok(), "I4 should hold before deal");
        uint256 cur = _usdc().balanceOf(address(_treasury()));
        deal(address(handler.usdc()), address(_treasury()), cur + 1);
        assertFalse(_i4Ok(), "I4 should fire after USDC injection into treasury");
    }

    // I5 (Group B): zero out dollarSeconds on a locked pool.
    // Guard: Funding/Unsuccessful → skip; principal==0 || span==0 → skip.
    // helper_setupActive drives to Active; _lock() sets span=30D and dollarSeconds correctly.
    function test_I5_breakVerification() public {
        handler.helper_setupActive_forTest();
        assertTrue(_i5Ok(), "I5 should hold before corrupt");
        handler.helper_corruptDollarSeconds_forTest(0);
        assertFalse(_i5Ok(), "I5 should fire after dollarSeconds zeroed");
    }

    // I6 (Group B): inject protocolFees while in Default.
    // Guard: status != Default → skip.
    // helper_setupActive + helper_setupDefault drives to Default with protocolFees=0.
    function test_I6_breakVerification() public {
        handler.helper_setupActive_forTest();
        handler.helper_setupDefault_forTest();
        assertTrue(_i6Ok(), "I6 should hold before corrupt");
        handler.helper_corruptProtocolFees_forTest(1);
        assertFalse(_i6Ok(), "I6 should fire after protocolFees injection in Default");
    }

    // I7 (Group A): corrupt factory.psps[PSP].activePool to a bogus address.
    // Guard: none (assertTrue always runs).
    function test_I7_breakVerification() public {
        assertTrue(_i7Ok(), "I7 should hold before corrupt");
        handler.helper_corruptFactoryActivePool_forTest(address(0xDEAD));
        assertFalse(_i7Ok(), "I7 should fire after factory activePool corrupted");
    }

    // I8 sub-property (Group B): push LP_A.lastUpdate past pool.lastUpdate.
    // Guard: Funding/Unsuccessful only; principal > 0.
    // helper_setupUnsuccessfulWith2LPs drives to Unsuccessful with 2 LPs.
    function test_I8_subProperty_breakVerification() public {
        handler.helper_setupUnsuccessfulWith2LPs_forTest();
        assertTrue(_i8SubOk(), "I8 sub-property should hold before corrupt");
        handler.helper_corruptLpLastUpdatePastPool_forTest(); // LP_A.lastUpdate = pool.lastUpdate+1
        assertFalse(_i8SubOk(), "I8 sub-property should fire after LP_A.lastUpdate > pool.lastUpdate");
    }

    // I8 equality (Group B): inflate LP_A.fundingCredit by 1 → sum exceeds pool total.
    // Guard: same as sub-property. Sub-property must hold so equality evaluates without underflow.
    function test_I8_equality_breakVerification() public {
        handler.helper_setupUnsuccessfulWith2LPs_forTest();
        assertTrue(_i8EqualityOk(), "I8 equality should hold before corrupt");
        handler.helper_corruptLpFundingCredit_forTest(1);
        assertFalse(_i8EqualityOk(), "I8 equality should fire after LP_A fundingCredit inflation");
    }

    // ── I9–I13 bool helpers ───────────────────────────────────────────────────

    function _i9Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Active) return true;
        uint256 sum = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (handler.ddActive(i)) {
                (uint256 ddPrin, , ,) = p.drawDowns(handler.refs(i));
                sum += ddPrin;
            }
        }
        return p.outstanding() == sum;
    }

    function _i10Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return true;
        if (handler.ghost_defaultDeclared()) return true;
        return p.accIdleFees() == 0 && p.accPenalty() == 0;
    }

    function _i11Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return true;
        return p.reservedYield() == 0;
    }

    function _i12Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return true;
        if (p.principal() == 0) return true;
        return p.collectedYield()       >= p.yieldOwed()
            && p.collectedOverrunYield() >= p.overrunYield()
            && p.collectedPrincipal()    >= p.principal();
    }

    function _i13Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() == PoolContract.Status.Funding)      return true;
        if (p.status() == PoolContract.Status.Unsuccessful)  return true;
        if (p.principal() == 0 || p.span() == 0)            return true;
        if (handler.ghost_defaultDeclared() && !handler.ghost_caseOneDefaulted()) return true;
        return p.yieldOwed() ==
            MathLib.mulDiv(p.dollarSeconds(), p.aprAnnual(), MathLib.WAD * MathLib.SECONDS_PER_YEAR);
    }

    // ── I9 break ─────────────────────────────────────────────────────────────
    //
    // Inflate drawDowns[refs[0]].principal by 1 without touching outstanding.
    // Sum of drawdown principals becomes outstanding+1 → I9 fires.
    // I2 and I1 are unaffected (outstanding and USDC balance unchanged).
    // ─────────────────────────────────────────────────────────────────────────
    function test_I9_breakVerification() public {
        handler.helper_setupActiveWithDraw_forTest();
        assertTrue(_i9Ok(), "I9 should hold before corrupt");
        handler.helper_corruptDrawdownPrincipal_forTest(0, 1);
        assertFalse(_i9Ok(), "I9 should fire after drawdown principal inflation");
    }

    // ── I10 break ─────────────────────────────────────────────────────────────
    //
    // Drive to Closed via normal maturity (no default), then inject accIdleFees=1.
    // _checkFinality required accIdleFees==0 to close, so this state is unreachable
    // through valid paths — vm.store creates it directly.
    // ─────────────────────────────────────────────────────────────────────────
    function test_I10_breakVerification() public {
        handler.helper_setupClosed_forTest();
        assertTrue(_i10Ok(), "I10 should hold before corrupt");
        handler.helper_corruptAccIdleFees_forTest(1);
        assertFalse(_i10Ok(), "I10 should fire after accIdleFees injection in Closed");
    }

    // ── I11 break ─────────────────────────────────────────────────────────────
    //
    // Drive to Closed, then inject reservedYield=1.
    // All close paths zero reservedYield, so this state is unreachable through
    // valid paths.
    // ─────────────────────────────────────────────────────────────────────────
    function test_I11_breakVerification() public {
        handler.helper_setupClosed_forTest();
        assertTrue(_i11Ok(), "I11 should hold before corrupt");
        handler.helper_corruptReservedYield_forTest(1);
        assertFalse(_i11Ok(), "I11 should fire after reservedYield injection in Closed");
    }

    // ── I12 break ─────────────────────────────────────────────────────────────
    //
    // Drive to Closed, then inflate yieldOwed above collectedYield.
    // Closed pools cannot have a yield shortfall through valid paths.
    // ─────────────────────────────────────────────────────────────────────────
    function test_I12_breakVerification() public {
        handler.helper_setupClosed_forTest();
        assertTrue(_i12Ok(), "I12 should hold before corrupt");
        handler.helper_corruptYieldOwed_forTest(1);
        assertFalse(_i12Ok(), "I12 should fire after yieldOwed > collectedYield in Closed");
    }

    // ── I13 break (Active state) ──────────────────────────────────────────────
    //
    // Drive to Active, then inflate yieldOwed by 1 without touching dollarSeconds.
    // yieldOwed becomes mulDiv(dollarSeconds, apr, WAD*SPY) + 1 → I13 fires.
    // I5 is unaffected (dollarSeconds unchanged). I1 is unaffected (USDC unchanged).
    // ─────────────────────────────────────────────────────────────────────────
    function test_I13_breakVerification() public {
        handler.helper_setupActive_forTest();
        assertTrue(_i13Ok(), "I13 should hold before corrupt");
        handler.helper_corruptYieldOwedActive_forTest(1);
        assertFalse(_i13Ok(), "I13 should fire after yieldOwed inflated past computed value");
    }

    // ── I13 break (Case-1 Default state) ─────────────────────────────────────
    //
    // Drive to Default via Case 1 (pre-maturity, earned > collectedYield).
    // Case 1 rebases span, dollarSeconds, and yieldOwed atomically (lines 604-606)
    // so the identity holds immediately after declareDefault. ghost_caseOneDefaulted
    // is set → I13 checks this state (old broad guard would have silently skipped it).
    // Corrupt yieldOwed by 1 without touching dollarSeconds → simulates a partial
    // Case-1 rebase (ds updated, yieldOwed not) → I13 fires.
    // ─────────────────────────────────────────────────────────────────────────
    function test_I13_caseOneDefault_breakVerification() public {
        handler.helper_setupDefaultCaseOne_forTest();
        assertTrue(_i13Ok(), "I13 should hold in Case-1 Default before corrupt");
        handler.helper_corruptYieldOwedDefault_forTest(1);
        assertFalse(_i13Ok(), "I13 should fire after partial Case-1 rebase (yieldOwed not updated)");
    }

    // ── I3b: Collected streams bounded by owed ────────────────────────────────
    //
    // Safety-net regression invariant: every path that writes to a collected
    // counter clamps to (owed - collected) in _allocate, the settle paths, and
    // the default rebase, so these should always hold. A future regression in
    // any clamping path will surface here unconditionally.
    //
    // Scope: whenever principal > 0 (post-first-deposit). In Funding/Unsuccessful
    // yieldOwed = 0 and collectedYield = 0, so both sides are 0 and the check
    // passes trivially. Bonus has no separate owed ceiling and is excluded.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I3b_collectedWithinOwed() public view {
        PoolContract p = _pool();
        if (p.principal() == 0) return;
        assertLe(p.collectedYield(),        p.yieldOwed(),    "I3b: collectedYield > yieldOwed");
        assertLe(p.collectedOverrunYield(), p.overrunYield(), "I3b: collectedOverrunYield > overrunYield");
    }

    function _i3bOk() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.principal() == 0) return true;
        return p.collectedYield()        <= p.yieldOwed()
            && p.collectedOverrunYield() <= p.overrunYield();
    }

    // ── I3b break ─────────────────────────────────────────────────────────────
    //
    // Drive to Active (yieldOwed > 0 after lock), then inject collectedYield
    // above yieldOwed via vm.store at slot 40. I3b fires immediately.
    // ─────────────────────────────────────────────────────────────────────────
    function test_I3b_breakVerification() public {
        handler.helper_setupActive_forTest();
        assertTrue(_i3bOk(), "I3b should hold before corrupt");
        handler.helper_corruptCollectedYield_forTest(handler.pool().yieldOwed() + 1);
        assertFalse(_i3bOk(), "I3b should fire after collectedYield > yieldOwed");
    }

    // ── I14: Terminal exact split ─────────────────────────────────────────────
    //
    // At Closed status, each LP that has started claiming must have received
    // exactly their proportional entitlement on each of the three yield streams:
    //
    //   Base yield:  lpClaimedYield        ≈ (lpDs / totalDs) * collectedYield
    //   Overrun:     lpClaimedOverrunYield ≈ (lpPrin / principal) * collectedOverrunYield
    //   Bonus:       lpClaimedBonus        ≈ (lpPrin / principal) * collectedBonus
    //
    // Tolerance: 2 wei for base (two-step mulDiv in claimYield vs single-step
    // here); 1 wei for overrun/bonus (both use single-step mulDiv). Underclaim
    // is flagged only when claimableLeft == 0 (LP has fully drawn, confirming
    // nothing is stranded). Sum invariant is exact: the pool increments its
    // counters atomically with each LP transfer, so per-LP claimed sums must
    // exactly equal pool-level claimed counters — no dust created or lost.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I14_terminalExactSplit() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return;
        if (p.dollarSeconds() == 0 || p.principal() == 0) return;

        address lpa = handler.LP_A();
        address lpb = handler.LP_B();

        _checkTerminalLpSplit(p, lpa);
        _checkTerminalLpSplit(p, lpb);

        (,,,, uint256 aY,, uint256 aO, uint256 aB,) = p.lpPositions(lpa);
        (,,,, uint256 bY,, uint256 bO, uint256 bB,) = p.lpPositions(lpb);
        assertEq(aY + bY, p.claimedYield(),        "I14-sum: LP yield sum != pool.claimedYield");
        assertEq(aO + bO, p.claimedOverrunYield(),  "I14-sum: LP overrun sum != pool.claimedOverrunYield");
        assertEq(aB + bB, p.claimedBonus(),         "I14-sum: LP bonus sum != pool.claimedBonus");
    }

    function _checkTerminalLpSplit(PoolContract p, address lp) internal view {
        (uint256 lpPrin,,, uint256 lpDs, uint256 lpCY,, uint256 lpCO, uint256 lpCB,) = p.lpPositions(lp);
        if (lpPrin == 0) return;
        uint256 totalDs = p.dollarSeconds();
        uint256 prin    = p.principal();

        if (lpCY > 0 && p.collectedYield() > 0) {
            uint256 expY = MathLib.mulDiv(lpDs, p.collectedYield(), totalDs);
            assertLe(lpCY, expY + 2, "I14: base yield overclaim at terminal");
            (, , uint256 leftY, , , ) = p.getLpPosition(lp);
            if (leftY == 0) assertGe(lpCY + 2, expY, "I14: base yield underclaim (stranded) at terminal");
        }
        if (lpCO > 0 && p.collectedOverrunYield() > 0) {
            uint256 expO = MathLib.mulDiv(lpPrin, p.collectedOverrunYield(), prin);
            assertLe(lpCO, expO + 1, "I14: overrun overclaim at terminal");
            (, , , , uint256 leftO, ) = p.getLpPosition(lp);
            if (leftO == 0) assertGe(lpCO + 1, expO, "I14: overrun underclaim (stranded) at terminal");
        }
        if (lpCB > 0 && p.collectedBonus() > 0) {
            uint256 expB = MathLib.mulDiv(lpPrin, p.collectedBonus(), prin);
            assertLe(lpCB, expB + 1, "I14: bonus overclaim at terminal");
            (, , , , , uint256 leftB) = p.getLpPosition(lp);
            if (leftB == 0) assertGe(lpCB + 1, expB, "I14: bonus underclaim (stranded) at terminal");
        }
    }

    function _i14LpOk(PoolContract p, address lp) internal view returns (bool) {
        (uint256 lpPrin,,, uint256 lpDs, uint256 lpCY,, uint256 lpCO, uint256 lpCB,) = p.lpPositions(lp);
        if (lpPrin == 0) return true;
        uint256 totalDs = p.dollarSeconds();
        uint256 prin    = p.principal();

        if (lpCY > 0 && p.collectedYield() > 0) {
            uint256 expY = MathLib.mulDiv(lpDs, p.collectedYield(), totalDs);
            if (lpCY > expY + 2) return false;
            (, , uint256 leftY, , , ) = p.getLpPosition(lp);
            if (leftY == 0 && lpCY + 2 < expY) return false;
        }
        if (lpCO > 0 && p.collectedOverrunYield() > 0) {
            uint256 expO = MathLib.mulDiv(lpPrin, p.collectedOverrunYield(), prin);
            if (lpCO > expO + 1) return false;
            (, , , , uint256 leftO, ) = p.getLpPosition(lp);
            if (leftO == 0 && lpCO + 1 < expO) return false;
        }
        if (lpCB > 0 && p.collectedBonus() > 0) {
            uint256 expB = MathLib.mulDiv(lpPrin, p.collectedBonus(), prin);
            if (lpCB > expB + 1) return false;
            (, , , , , uint256 leftB) = p.getLpPosition(lp);
            if (leftB == 0 && lpCB + 1 < expB) return false;
        }
        return true;
    }

    function _i14Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return true;
        if (p.dollarSeconds() == 0 || p.principal() == 0) return true;

        address lpa = handler.LP_A();
        address lpb = handler.LP_B();
        if (!_i14LpOk(p, lpa)) return false;
        if (!_i14LpOk(p, lpb)) return false;

        (,,,, uint256 aY,, uint256 aO, uint256 aB,) = p.lpPositions(lpa);
        (,,,, uint256 bY,, uint256 bO, uint256 bB,) = p.lpPositions(lpb);
        return aY + bY == p.claimedYield()
            && aO + bO == p.claimedOverrunYield()
            && aB + bB == p.claimedBonus();
    }

    // ── I14 break ─────────────────────────────────────────────────────────────
    //
    // Drive to Closed (normal maturity path), both LPs claim correct shares.
    // Inflate LP_A.claimedYield by 3 via vm.store — exceeds the 2-wei tolerance.
    // The sum invariant fires first (LP sum != pool.claimedYield), proving I14
    // is not trivially always-true.
    // ─────────────────────────────────────────────────────────────────────────
    function test_I14_breakVerification() public {
        handler.helper_setupClosed_forTest();
        PoolContract p = handler.pool();

        vm.prank(handler.LP_A()); p.claimYield();
        vm.prank(handler.LP_B()); p.claimYield();
        assertTrue(_i14Ok(), "I14 should hold after correct proportional claims");

        (,,,, uint256 lpAYield,,,,) = p.lpPositions(handler.LP_A());
        handler.helper_corruptLpClaimedYield_forTest(handler.LP_A(), lpAYield + 3);
        assertFalse(_i14Ok(), "I14 should fire after LP_A yield inflated past tolerance");
    }

    // ── IDLE1: exemptAmount bounded by availableToDd ─────────────────────────
    //
    // idleExemptAmount <= availableToDd in Active state.  Both fields are mutated
    // by +ddAmount in the same branch of repay(), so they are structurally coupled,
    // but the coupling is not enforced.  A refactor that splits the two mutations
    // (or a new code path that sets exemptAmount without setting availableToDd)
    // could silently produce exemptBase = avail - exempt < 0; the Solidity guard
    // `avail > idleExemptAmount ? avail - idleExemptAmount : 0` masks the underflow
    // rather than signaling it.  This invariant makes the violation observable.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_IDLE1_exemptBounded() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Active) return;
        assertLe(p.idleExemptAmount(), p.availableToDd(),
            "IDLE1: idleExemptAmount > availableToDd");
    }

    // ── IDLE3: terminal states have exemption cleared ─────────────────────────
    //
    // In Closed and Default status, both idleExemptAmount and idleExemptUntil
    // must be zero.  Both _mature() and declareDefault() already clear them.
    // This invariant guards a future terminal-path addition that forgets to clear.
    // (Verified: _lock→_mature zeros L975-976; declareDefault zeros L631-632.)
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_IDLE3_terminalExemptionCleared() public view {
        PoolContract p = _pool();
        PoolContract.Status s = p.status();
        if (s != PoolContract.Status.Closed && s != PoolContract.Status.Default) return;
        assertEq(p.idleExemptAmount(), 0,
            "IDLE3: idleExemptAmount != 0 in terminal state");
        assertEq(p.idleExemptUntil(),  0,
            "IDLE3: idleExemptUntil != 0 in terminal state");
    }

    // ── IDLE4: lastIdleDay within billing window ──────────────────────────────
    //
    // In Active state: dayOf(poolStartTs) <= lastIdleDay <= dayOf(poolFinalityTs).
    //
    // Lower bound: _lock() initialises lastIdleDay = dayOf(t) = dayOf(poolStartTs).
    // Upper bound: dayOf(poolFinalityTs) (NOT dayOf(poolFinalityTs)-1).
    //   The accrual sentinel when all days are billed is lastBillableDay+1 =
    //   dayOf(poolFinalityTs).  Using -1 would false-fire on a fully-billed pool.
    //
    // A bug that advances lastIdleDay past dayOf(poolFinalityTs) would cause the
    // two-segment formula to compute N=0 on the next call, silently ceasing to
    // bill without _checkFinality closing the pool.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_IDLE4_lastIdleDayBounded() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Active) return;
        if (p.poolFinalityTs() == 0) return;
        assertGe(p.lastIdleDay(), MathLib.dayOf(p.poolStartTs()),
            "IDLE4: lastIdleDay < dayOf(poolStartTs)");
        assertLe(p.lastIdleDay(), MathLib.dayOf(p.poolFinalityTs()),
            "IDLE4: lastIdleDay > dayOf(poolFinalityTs)");
    }

    // ── IDLE12: no future billing ─────────────────────────────────────────────
    //
    // In Active, pre-finality state: lastIdleDay <= dayOf(block.timestamp).
    // _accrueIdleFees sets lastIdleDay = dayOf(t) at the end of each call, so
    // lastIdleDay represents the highest complete calendar day billed — it must
    // not exceed the current day.  A mutation bug that sets lastIdleDay = dayOf(t)+1
    // would cause the next accrual to compute N=0 (frm > to), silently losing a
    // billing day.
    //
    // Note: Python inv_full.py IDLE9 = "acc_idle_fees >= 0", which is trivially
    // true in Solidity (uint256).  This property is therefore numbered IDLE12 in
    // both the Python spec and this suite to avoid numbering divergence.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_IDLE12_noFutureBilling() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Active) return;
        if (p.poolFinalityTs() == 0 || block.timestamp >= p.poolFinalityTs()) return;
        assertLe(p.lastIdleDay(), MathLib.dayOf(block.timestamp),
            "IDLE12: lastIdleDay > dayOf(now) - future billing detected");
    }

    // ── outstanding <= principal ──────────────────────────────────────────────
    //
    // In Active/Closed/Default: outstanding <= principal.
    // Implied by I2 (outstanding + availableToDd + collectedPrincipal == principal,
    // all >=0), but asserting it directly makes the single-field violation
    // immediately visible without needing to inspect all three terms.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_outstanding_leq_principal() public view {
        PoolContract p = _pool();
        PoolContract.Status s = p.status();
        if (s == PoolContract.Status.Funding || s == PoolContract.Status.Unsuccessful) return;
        if (p.principal() == 0) return;
        assertLe(p.outstanding(), p.principal(),
            "outstanding > principal");
    }

    // ── CLOSED_IDLE_FROZEN: no phantom accrual after Default→Closed ──────────
    //
    // If the pool ever closed with accIdleFees > 0 (Default→Closed path), the
    // _accrueIdleFees Closed guard must prevent accPenalty from growing further.
    // Ghost tracks accPenalty at closure; this invariant asserts it never increases.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_CLOSED_IDLE_FROZEN() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return;
        if (!handler.ghost_closedWithFrozenIdleFees()) return;
        assertEq(p.accPenalty(), handler.ghost_closedAccPenalty(),
            "CLOSED_IDLE: accPenalty grew after Default->Closed with frozen idle fees");
    }

    // ── IDLE2: exemption tidiness ─────────────────────────────────────────────
    //
    // If idleExemptAmount is zero, idleExemptUntil must also be zero.
    // A non-zero idleExemptUntil with zero idleExemptAmount would cause spurious
    // exempt-day splits in _accrueIdleFees without actually shielding any capital.
    // Applies only to locked pools where exemption state can exist.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_IDLE2_exemptionConsistency() public view {
        PoolContract p = _pool();
        PoolContract.Status s = p.status();
        if (s == PoolContract.Status.Funding || s == PoolContract.Status.Unsuccessful) return;
        if (p.idleExemptAmount() == 0) {
            assertEq(p.idleExemptUntil(), 0,
                "IDLE2: idleExemptUntil != 0 when idleExemptAmount == 0");
        }
    }

    // ── IDLE6: idle billable window equals tenure ─────────────────────────────
    //
    // For any locked pool: dayOf(poolFinalityTs) - dayOf(poolStartTs) == tenure.
    // This is the window-width guarantee: exactly tenure calendar days are billable
    // regardless of create time-of-day or finalize latency within the buffer.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_IDLE6_windowEqualsTenure() public view {
        PoolContract p = _pool();
        if (p.poolFinalityTs() == 0 || p.tenure() == 0) return;
        PoolContract.Status s = p.status();
        if (s == PoolContract.Status.Funding || s == PoolContract.Status.Unsuccessful) return;
        uint256 sd          = MathLib.dayOf(p.poolStartTs());
        uint256 lastBillable = MathLib.dayOf(p.poolFinalityTs()) - 1;
        uint256 window       = lastBillable - sd + 1;
        assertEq(window, p.tenure(), "IDLE6: billing window != tenure");
    }

    // ── IDLE10: fMaturityTs is always UTC-midnight-aligned ────────────────────
    //
    // The factory snaps fMaturityTs to the next UTC midnight when the raw value
    // is not already midnight. Broken snap → off-by-one billing; IDLE6 does NOT
    // catch this (IDLE6 checks the window width, not the absolute alignment).
    // Applies to every initialized pool (fMaturityTs is set at creation).
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_IDLE10_maturityMidnight() public view {
        PoolContract p = _pool();
        if (p.fMaturityTs() == 0) return;
        assertEq(p.fMaturityTs() % MathLib.SECONDS_PER_DAY, 0,
            "IDLE10: fMaturityTs is not UTC-midnight-aligned");
    }

    // ── IDLE11: poolFinalityTs is always UTC-midnight-aligned ─────────────────
    //
    // poolFinalityTs = fMaturityTs + tenure*SPD. Since fMaturityTs is midnight-aligned
    // (IDLE10) and tenure*SPD is an integer multiple of SPD, poolFinalityTs is always
    // a UTC midnight. A broken finality anchor silently shortens or lengthens the
    // billing window in ways IDLE6 may not detect.
    // Applies to every locked pool (poolFinalityTs is set at finalizeFunding).
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_IDLE11_finalityMidnight() public view {
        PoolContract p = _pool();
        if (p.poolFinalityTs() == 0) return;
        assertEq(p.poolFinalityTs() % MathLib.SECONDS_PER_DAY, 0,
            "IDLE11: poolFinalityTs is not UTC-midnight-aligned");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bool-returning mirrors for the five new invariants (break-test use only)
    // ─────────────────────────────────────────────────────────────────────────

    function _idle1Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Active) return true;
        return p.idleExemptAmount() <= p.availableToDd();
    }

    function _idle3Ok() internal view returns (bool) {
        PoolContract p = _pool();
        PoolContract.Status s = p.status();
        if (s != PoolContract.Status.Closed && s != PoolContract.Status.Default) return true;
        return p.idleExemptAmount() == 0 && p.idleExemptUntil() == 0;
    }

    function _idle4Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Active) return true;
        if (p.poolFinalityTs() == 0) return true;
        return p.lastIdleDay() >= MathLib.dayOf(p.poolStartTs())
            && p.lastIdleDay() <= MathLib.dayOf(p.poolFinalityTs());
    }

    function _idle12Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Active) return true;
        if (p.poolFinalityTs() == 0 || block.timestamp >= p.poolFinalityTs()) return true;
        return p.lastIdleDay() <= MathLib.dayOf(block.timestamp);
    }

    function _outstandingLeqPrincipalOk() internal view returns (bool) {
        PoolContract p = _pool();
        PoolContract.Status s = p.status();
        if (s == PoolContract.Status.Funding || s == PoolContract.Status.Unsuccessful) return true;
        if (p.principal() == 0) return true;
        return p.outstanding() <= p.principal();
    }

    // ── IDLE1 break ───────────────────────────────────────────────────────────
    //
    // Drive to Active (availableToDd = 4*SCALE, idleExemptAmount = 0).
    // Corrupt slot 51 (idleExemptAmount) to availableToDd + 1.
    // IDLE1 fires: exemptAmount > availableToDd.
    // ─────────────────────────────────────────────────────────────────────────
    function test_IDLE1_breakVerification() public {
        handler.helper_setupActive_forTest();
        assertTrue(_idle1Ok(), "IDLE1 should hold in clean Active state");
        handler.helper_corruptExemptAboveAvail_forTest();
        assertFalse(_idle1Ok(), "IDLE1 should fire after idleExemptAmount > availableToDd");
    }

    // ── IDLE3 break ───────────────────────────────────────────────────────────
    //
    // Drive to Closed (both exemption fields are zero after _mature).
    // Corrupt slot 51 (idleExemptAmount) to 1 to simulate a terminal path that
    // forgot to clear the exemption.
    // IDLE3 fires: idleExemptAmount != 0 in Closed.
    // ─────────────────────────────────────────────────────────────────────────
    function test_IDLE3_breakVerification() public {
        handler.helper_setupClosed_forTest();
        assertTrue(_idle3Ok(), "IDLE3 should hold in Closed after normal maturity");
        handler.helper_corruptExemptInTerminal_forTest(1);
        assertFalse(_idle3Ok(), "IDLE3 should fire after idleExemptAmount injected in Closed");
    }

    // ── IDLE4 break ───────────────────────────────────────────────────────────
    //
    // Drive to Active. poolFinalityTs is set at lock; dayOf(poolFinalityTs) is the
    // sentinel upper bound.  Corrupt lastIdleDay (slot 49) to dayOf(poolFinalityTs)+1.
    // IDLE4 fires: lastIdleDay > dayOf(poolFinalityTs).
    // ─────────────────────────────────────────────────────────────────────────
    function test_IDLE4_breakVerification() public {
        handler.helper_setupActive_forTest();
        assertTrue(_idle4Ok(), "IDLE4 should hold in clean Active state");
        uint256 badDay = MathLib.dayOf(handler.pool().poolFinalityTs()) + 1;
        handler.helper_corruptLastIdleDayAboveFinality_forTest(badDay);
        assertFalse(_idle4Ok(), "IDLE4 should fire after lastIdleDay > dayOf(poolFinalityTs)");
    }

    // ── IDLE12 break ──────────────────────────────────────────────────────────
    //
    // Drive to Active (pre-finality).  Corrupt lastIdleDay (slot 49) to
    // dayOf(block.timestamp) + 1 (tomorrow's day number).
    // IDLE12 fires: lastIdleDay > dayOf(now).
    // ─────────────────────────────────────────────────────────────────────────
    function test_IDLE12_breakVerification() public {
        handler.helper_setupActive_forTest();
        assertTrue(_idle12Ok(), "IDLE12 should hold in clean Active state");
        handler.helper_corruptLastIdleDayToFuture_forTest(MathLib.dayOf(block.timestamp) + 1);
        assertFalse(_idle12Ok(), "IDLE12 should fire after lastIdleDay in the future");
    }

    // ── outstanding <= principal break ────────────────────────────────────────
    //
    // Drive to Active (outstanding=0, principal=4*SCALE).
    // Corrupt slot 32 (outstanding) to principal + 1 via the existing helper
    // (helper_corruptOutstanding_forTest adds excess to current outstanding).
    // outstanding > principal fires.
    // ─────────────────────────────────────────────────────────────────────────
    function test_outstanding_leq_principal_breakVerification() public {
        handler.helper_setupActive_forTest();
        assertTrue(_outstandingLeqPrincipalOk(), "outstanding <= principal should hold before corrupt");
        handler.helper_corruptOutstanding_forTest(handler.pool().principal() + 1);
        assertFalse(_outstandingLeqPrincipalOk(), "should fire after outstanding inflated above principal");
    }

    // ── CLOSED_IDLE_FROZEN bool helper ────────────────────────────────────────
    function _closedIdleFrozenOk() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return true;
        if (!handler.ghost_closedWithFrozenIdleFees()) return true;
        return p.accPenalty() == handler.ghost_closedAccPenalty();
    }

    // ── CLOSED_IDLE_FROZEN break-verification ─────────────────────────────────
    //
    // Scenario: Closed pool (normal-maturity path) with non-zero accIdleFees
    // injected to simulate Default->Closed with frozen idle. Time warped past the
    // penalty grace period so the penalty block WOULD fire without the guard.
    //
    // TEETH phase: pool stays Closed throughout. Compute the exact penalty the
    // pre-fix penalty block would have produced (same arithmetic, same inputs),
    // apply it via vm.store, and assert accPenalty grew. This confirms (a) the
    // penalty-block conditions are fully met and (b) the growth is non-trivial.
    // If the Closed guard is removed from _accrueIdleFees, this is precisely
    // what a Closed-state LP claim would compute on its own.
    //
    // FIX phase: call claimPrincipal in Closed state with the guard present,
    // assert accPenalty and accIdleFees are unchanged. This assertion fails
    // if the Closed guard is removed — that is the teeth.
    // ─────────────────────────────────────────────────────────────────────────
    function test_closedIdleFeesFrozen_breakVerification() public {
        // Step 1: bring pool to Closed via normal maturity (accIdleFees == 0).
        handler.helper_setupClosed_forTest();
        PoolContract p = _pool();
        assertEq(uint256(p.status()), uint256(PoolContract.Status.Closed), "setup: must be Closed");
        assertEq(p.accIdleFees(), 0, "setup: normal close has accIdleFees==0");

        // Inject frozen idle fees — simulates the Default->Closed path where
        // acc_idle_fees > 0 survived to closure without being paid.
        uint256 frozenIdle = 1e12; // 1 SCALE (matches handler SCALE constant)
        handler.helper_corruptAccIdleFees_forTest(frozenIdle);

        // Warp past finality + grace so the penalty block conditions are met.
        vm.warp(p.poolFinalityTs() + (p.penaltyGraceDays() + 5) * 1 days);

        // ── TEETH: show what the pre-fix _accrueIdleFees would do in Closed ─────
        // The penalty block in _accrueIdleFees (pre-fix, no Closed guard) runs when:
        //   t > maturity && accIdleFees > 0
        // and computes:
        //   pDays = dayOf(t) - max(lastPenaltyDay, penaltyStartDay)
        //   accPenalty += accIdleFees * pDays * penaltyRateDaily / WAD
        // Apply that arithmetic directly in Closed state. If the pool were in
        // Default or Active, calling any claim function would trigger this path.
        // The guard change means Closed is the only status where it's now skipped.
        uint256 penaltyBefore = p.accPenalty();
        uint256 maturityDay    = MathLib.dayOf(p.poolFinalityTs());
        uint256 penStartDay    = maturityDay + p.penaltyGraceDays();
        uint256 pfrm           = p.lastPenaltyDay() > penStartDay ? p.lastPenaltyDay() : penStartDay;
        uint256 curPenDay      = MathLib.dayOf(block.timestamp);
        uint256 pDays          = curPenDay - pfrm;

        // Pre-conditions: prove the penalty block would not be a no-op.
        assertGt(pDays, 0,    "TEETH: must be past penalty start day");
        assertGt(frozenIdle, 0, "TEETH: accIdleFees must be non-zero");

        // Compute the exact growth the pre-fix code would have written.
        uint256 preFixGrowth = MathLib.mulDiv(frozenIdle * pDays, p.penaltyRateDaily(), MathLib.WAD);
        assertGt(preFixGrowth, 0, "TEETH: pre-fix accrual produces non-zero penalty in Closed state");

        // Apply it directly (this is what a Closed-state LP claim would do pre-fix).
        handler.helper_corruptAccPenalty_forTest(penaltyBefore + preFixGrowth);
        assertEq(p.accPenalty(), penaltyBefore + preFixGrowth,
            "TEETH: applying pre-fix accrual to Closed pool grew accPenalty");

        // Reset for the fix phase.
        handler.helper_corruptAccPenalty_forTest(penaltyBefore);
        assertEq(p.accPenalty(), penaltyBefore, "setup fix phase: penalty reset");

        // ── FIX: Closed-state LP claim must not touch accPenalty or accIdleFees ──
        // pool is still Closed (status never changed). With the guard in place,
        // _accrueIdleFees returns immediately — nothing accrues.
        // Remove the Closed guard from _accrueIdleFees and this assertion fails.
        vm.prank(handler.LP_B());
        p.claimPrincipal();

        assertEq(p.accPenalty(), penaltyBefore,
            "CLOSED_IDLE: accPenalty must not grow in Closed state (guard must hold)");
        assertEq(p.accIdleFees(), frozenIdle,
            "CLOSED_IDLE: accIdleFees must not change in Closed state (guard must hold)");
    }

    // ── I15: protocolFees only after base coupon is whole (waterfall ordering) ─
    //
    // The _allocate waterfall fills collectedYield to yieldOwed BEFORE routing any
    // surplus to protocolFees. _settleTerminalSplit runs only when collectedYield
    // >= yieldOwed (enforced by _checkFinality's precondition).
    // Therefore: protocolFees > 0 implies the LP base coupon is fully funded.
    //
    // The overrun stream (collectedOverrunYield >= overrunYield) is NOT checked here.
    // overrunYield grows dynamically as post-maturity extension accrues, so a later
    // _accrueExtensionYield call can push overrunYield above collectedOverrunYield
    // after protocolFees was legitimately booked at an earlier allocation.
    // This is safe because the close gate provides the A2 guarantee for overrun:
    //   * sweepProtocolFees requires Closed status
    //   * a pool can only reach Closed when collectedOverrunYield >= overrunYield (I12)
    // protocolFees is therefore trapped until overrun is made whole — the protocol
    // can never realise fees while the LP overrun entitlement is short. I12 is the
    // standing invariant for the close-gate half of A2; I15 is the allocation-time half.
    //
    // Default excluded: I6 separately asserts protocolFees == 0 in Default.
    // Funding/Unsuccessful excluded: all accounting fields are zero.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I15_protocolFeesImpliesYieldWhole() public view {
        PoolContract p = _pool();
        if (p.principal() == 0) return;
        PoolContract.Status s = p.status();
        if (s == PoolContract.Status.Funding || s == PoolContract.Status.Unsuccessful) return;
        if (s == PoolContract.Status.Default) return; // I6 covers Default
        if (p.protocolFees() > 0) {
            assertGe(p.collectedYield(), p.yieldOwed(),
                "I15: protocolFees > 0 but collectedYield < yieldOwed");
        }
    }

    function _i15Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.principal() == 0) return true;
        PoolContract.Status s = p.status();
        if (s == PoolContract.Status.Funding || s == PoolContract.Status.Unsuccessful) return true;
        if (s == PoolContract.Status.Default) return true;
        if (p.protocolFees() > 0) {
            return p.collectedYield() >= p.yieldOwed();
        }
        return true;
    }

    // ── I15 break ─────────────────────────────────────────────────────────────
    //
    // Drive to Active (protocolFees=0, collectedYield=0, yieldOwed>0 from 8% APR).
    // Inject protocolFees=1 via vm.store. Now protocolFees>0 but collectedYield<yieldOwed.
    // I15 fires immediately.
    // ─────────────────────────────────────────────────────────────────────────
    function test_I15_breakVerification() public {
        handler.helper_setupActive_forTest();
        PoolContract p = handler.pool();
        assertTrue(_i15Ok(), "I15 should hold in clean Active state");
        require(p.yieldOwed() > 0, "I15 break needs nonzero yieldOwed (8% APR pool)");
        // Inject protocolFees while collectedYield == 0 < yieldOwed
        handler.helper_corruptProtocolFees_forTest(1);
        assertFalse(_i15Ok(), "I15 should fire: protocolFees=1 but collectedYield=0 < yieldOwed");
    }

    // ── I16: default yield advance requires principal whole ──────────────────
    //
    // settleDefaultYield has require(collectedPrincipal >= principal) at the call site.
    // This standing invariant locks the ordering guarantee: if collectedYield advanced
    // beyond its value at the moment of declareDefault (all such advances came from
    // settleDefaultYield), then collectedPrincipal must already be >= principal.
    //
    // Ghost: ghost_collectedYieldAtDefault captures collectedYield the instant
    // declareDefault fires (before any further settlement). Any later increase
    // in Default status is traceable to settleDefaultYield.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I16_defaultYieldAfterPrincipal() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Default) return;
        if (!handler.ghost_defaultDeclared()) return;
        if (p.collectedYield() > handler.ghost_collectedYieldAtDefault()) {
            assertGe(p.collectedPrincipal(), p.principal(),
                "I16: collectedYield advanced in Default but collectedPrincipal < principal");
        }
    }

    function _i16Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Default) return true;
        if (!handler.ghost_defaultDeclared()) return true;
        if (p.collectedYield() > handler.ghost_collectedYieldAtDefault()) {
            return p.collectedPrincipal() >= p.principal();
        }
        return true;
    }

    // ── I16 break ─────────────────────────────────────────────────────────────
    //
    // Drive to Default (outstanding=1*SCALE; collectedPrincipal=3*SCALE < principal=4*SCALE).
    // ghost_collectedYieldAtDefault is captured by helper_setupDefault_forTest.
    // Inject collectedYield = ghost_collectedYieldAtDefault + 1 via vm.store.
    // I16 fires: collectedYield advanced in Default but collectedPrincipal < principal.
    // ─────────────────────────────────────────────────────────────────────────
    function test_I16_breakVerification() public {
        handler.helper_setupActive_forTest();
        handler.helper_setupDefault_forTest();
        PoolContract p = handler.pool();
        assertTrue(_i16Ok(), "I16 should hold at clean Default entry");
        require(p.collectedPrincipal() < p.principal(), "I16 break needs collectedPrincipal < principal");
        // Inject collectedYield above the at-default snapshot
        handler.helper_corruptCollectedYield_forTest(handler.ghost_collectedYieldAtDefault() + 1);
        assertFalse(_i16Ok(), "I16 should fire: collectedYield advanced but principal not whole");
    }

    // ── I17: Default→Closed pools have no LP bonus ────────────────────────────
    //
    // _settleTerminalSplit (which sets collectedBonus) is called only from
    // _checkFinality, which is reached only from _mature(), which in turn is
    // called only from Active-state functions (repay, payAccruedIdleFees,
    // claimYield, claimPrincipal). Once in Default, none of these can run.
    // The two Default→Closed close paths (settleDefaultPrincipal line 714+
    // and settleDefaultYield line 767+, plus the inline-close in declareDefault
    // line 677+) therefore never invoke _settleTerminalSplit — collectedBonus
    // stays 0 throughout.
    //
    // Regression lock: a future change that added a bonus split to the default
    // recovery path without updating this invariant would be caught immediately.
    // ─────────────────────────────────────────────────────────────────────────
    function invariant_I17_defaultClosedNoBonusCarve() public view {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return;
        if (!handler.ghost_defaultDeclared()) return;
        assertEq(p.collectedBonus(), 0,
            "I17: pool closed via default path but collectedBonus != 0");
    }

    function _i17Ok() internal view returns (bool) {
        PoolContract p = _pool();
        if (p.status() != PoolContract.Status.Closed) return true;
        if (!handler.ghost_defaultDeclared()) return true;
        return p.collectedBonus() == 0;
    }

    // ── I17 break ─────────────────────────────────────────────────────────────
    //
    // Start from a normal Closed pool (collectedBonus=0 from _settleTerminalSplit
    // with lpBonusShare=0 in test setup). Artificially set ghost_defaultDeclared=true
    // then inject collectedBonus=1. I17 fires: Default→Closed pool has bonus carve.
    // ─────────────────────────────────────────────────────────────────────────
    function test_I17_breakVerification() public {
        handler.helper_setupClosed_forTest();
        PoolContract p = handler.pool();
        require(p.status() == PoolContract.Status.Closed, "I17 break: pool not Closed");
        assertTrue(_i17Ok(), "I17 should hold: ghost_defaultDeclared=false skips check");
        // Artificially mark pool as having gone through Default
        handler.helper_corruptGhostDefault_forTest();
        assertTrue(_i17Ok(), "I17 still holds: collectedBonus==0 even with ghost set");
        // Now inject a spurious bonus carve
        handler.helper_corruptCollectedBonus_forTest(1);
        assertFalse(_i17Ok(), "I17 should fire: Default-Closed pool with collectedBonus=1");
    }
}
