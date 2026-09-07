// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Differential harness ported from suite_differential.py.
///
/// 500 deterministic seeds — even seeds run no-churn event streams, odd seeds force
/// a same-day repay+draw (churn) somewhere in the sequence.
///
/// Four predicates that must hold for every seed:
///   P1: contract_idle == ref_idle     (independent lazy-batch replay)
///   P2: contract_idle <= ref_idle_c   (day-scan ref always ≥ oracle)
///   P3: contract_idle == ref_idle_c   (equality on no-churn seeds)
///   P4: churn_cases >= 250            (non-vacuous: at least half the seeds churn)
///
/// ref (P1): an independent replay of the contract's lazy-batch accrual formula
///   tracking (avail, exempt, exemptUntilTs, lastIdleDay, accIdle) externally.
///   A bug in state management will cause P1 to fail.
///
/// ref_c (P2/P3): the original team day-scan formula from ref_daily_c.py —
///   daily = max(facility - outstanding_at_start_of_day - max(drawn_today - repaid_today, 0), 0)
///   This equals oracle on non-churn days and over-bills on same-day draw+repay churn.
contract DifferentialV2 is Test {

    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 constant D        = 86_400;
    uint256 constant SCALE    = 1e12;
    uint256 constant WAD      = 1e18;
    uint256 constant SEEDS    = 500;
    uint256 constant TENURE   = 14;   // pool tenure in days

    // ── Actors ────────────────────────────────────────────────────────────────

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant LP1      = address(0xAA01);

    // ── Infrastructure ────────────────────────────────────────────────────────

    MockStablecoin  usdc;
    TreasuryReserve treasury;
    PoolFactory     factory;
    PoolContract    impl;

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
            25e16,   // fundingExecBufferDays (0.25 days)
            3,       // maxGracePeriodDays
            1,       // minDdDays
            7       // maxDdDays
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);
    }

    // ── Reference structures ──────────────────────────────────────────────────

    /// @dev Lazy-batch accrual replay (mirrors contract _accrueIdleFees exactly).
    struct RefState {
        uint256 lastIdleDay;
        uint256 startDay;
        uint256 lastBillable;
        uint256 avail;
        uint256 exempt;
        uint256 exemptUntilTs;
        uint256 accIdle;
    }

    /// @dev Per-day draw/repay volume (for ref_c day-scan).
    struct DayRecord {
        uint256 drawn;
        uint256 repaid;
    }

    // ── Lazy-batch reference (ref) ────────────────────────────────────────────

    function _refAccrue(RefState memory s, uint256 nowTs, uint256 rateDaily) internal pure {
        uint256 currentDay = nowTs / D;
        if (currentDay > s.lastBillable + 1) currentDay = s.lastBillable + 1;

        uint256 frm = s.lastIdleDay > s.startDay ? s.lastIdleDay : s.startDay;
        uint256 to  = currentDay;

        if (to > frm) {
            uint256 N = to - frm;

            uint256 nExempt = 0;
            if (s.exempt > 0 && s.exemptUntilTs > 0) {
                uint256 euDay = s.exemptUntilTs / D;
                if (euDay > frm) {
                    nExempt = euDay > to ? N : euDay - frm;
                }
            }
            uint256 nFull = N - nExempt;
            if (nExempt > 0) {
                uint256 base = s.avail > s.exempt ? s.avail - s.exempt : 0;
                s.accIdle += MathLib.mulDiv(base * nExempt, rateDaily, WAD);
            }
            if (nFull > 0) {
                s.accIdle += MathLib.mulDiv(s.avail * nFull, rateDaily, WAD);
            }
            s.lastIdleDay = to;
        }
        if (s.exemptUntilTs > 0 && s.lastIdleDay >= s.exemptUntilTs / D) {
            s.exempt        = 0;
            s.exemptUntilTs = 0;
        }
    }

    function _refDraw(RefState memory s, uint256 nowTs, uint256 rateDaily, uint256 amount) internal pure {
        _refAccrue(s, nowTs, rateDaily);
        if (amount >= s.exempt) {
            s.exempt        = 0;
            s.exemptUntilTs = 0;
        } else {
            s.exempt -= amount;
        }
        s.avail -= amount;
    }

    function _refRepay(RefState memory s, uint256 nowTs, uint256 rateDaily, uint256 amount) internal pure {
        _refAccrue(s, nowTs, rateDaily);
        s.avail         += amount;
        s.exempt        += amount;
        s.exemptUntilTs  = (nowTs / D + 1) * D;
    }

    // ── Day-scan reference (ref_c, from ref_daily_c.py) ──────────────────────

    /// @dev day-scan:
    ///   for D in [startDay, lastBillable]:
    ///     sod = outstanding_at_start_of_day_D
    ///     start_idle = facility - sod
    ///     net = max(drawn[D] - repaid[D], 0)
    ///     daily = max(start_idle - net, 0)
    ///     total += daily * rate
    ///     outstanding += drawn[D] - repaid[D]
    function _computeRefC(
        uint256 facility,
        uint256 numDays,
        uint256 rateDaily,
        DayRecord[] memory dayRecs
    ) internal pure returns (uint256 total) {
        uint256 outstanding = 0;
        for (uint256 i = 0; i < numDays; i++) {
            uint256 sod       = outstanding;
            uint256 startIdle = facility > sod ? facility - sod : 0;
            uint256 drawnD    = dayRecs[i].drawn;
            uint256 repaidD   = dayRecs[i].repaid;
            uint256 net       = drawnD > repaidD ? drawnD - repaidD : 0;
            uint256 daily     = startIdle > net ? startIdle - net : 0;
            total += MathLib.mulDiv(daily, rateDaily, WAD);
            // Update outstanding (valid lifecycle: always >= 0)
            outstanding = outstanding + drawnD;
            outstanding = outstanding >= repaidD ? outstanding - repaidD : 0;
        }
    }

    /// @dev True if any billing day has both a draw and a repay (= churn).
    function _hasChurn(DayRecord[] memory dayRecs) internal pure returns (bool) {
        for (uint256 i = 0; i < dayRecs.length; i++) {
            if (dayRecs[i].drawn > 0 && dayRecs[i].repaid > 0) return true;
        }
        return false;
    }

    // ── PRNG ─────────────────────────────────────────────────────────────────

    function _rand(uint256 x) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(x)));
    }

    // ── Pool helpers ──────────────────────────────────────────────────────────

    function _deposit(PoolContract p, address lp, uint256 pyAmt) internal {
        uint256 amt = pyAmt * SCALE;
        usdc.mint(lp, amt);
        vm.startPrank(lp);
        usdc.approve(address(p), amt);
        p.deposit(amt);
        vm.stopPrank();
    }

    function _doRepay(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.startPrank(PSP);
        usdc.approve(address(p), total);
        p.repay(ref);
        vm.stopPrank();
    }

    // ── Main test ─────────────────────────────────────────────────────────────

    function test_differential_500seeds() public {
        uint256 mismatches = 0;
        uint256 churnCases = 0;

        for (uint256 seed = 0; seed < SEEDS; seed++) {
            bool isForcedChurn = (seed % 2 == 1);

            (uint256 contractIdle, uint256 refIdle, uint256 refIdleC, bool actualChurn) =
                _runSeed(seed, isForcedChurn);

            if (actualChurn) churnCases++;

            // P1: oracle == independent lazy-batch ref
            if (contractIdle != refIdle) {
                emit log_named_uint("P1 MISMATCH seed",   seed);
                emit log_named_uint("  contract_idle",    contractIdle);
                emit log_named_uint("  ref_idle",         refIdle);
                mismatches++;
            }

            // P2: oracle <= ref_c always
            assertLe(contractIdle, refIdleC,
                string.concat("P2 violated: contract > ref_c at seed ", vm.toString(seed)));

            // P3: oracle == ref_c on no-churn
            if (!actualChurn) {
                assertEq(contractIdle, refIdleC,
                    string.concat("P3 violated: oracle != ref_c on non-churn at seed ", vm.toString(seed)));
            }
        }

        assertEq(mismatches, 0, "P1 violated: contract_idle != ref_idle on one or more seeds");

        // P4: ≥250 churn cases (non-vacuous)
        assertGe(churnCases, 250, "P4 violated: fewer than 250 churn cases");
        emit log_named_uint("Differential churn cases", churnCases);
        emit log_named_uint("Differential seeds run",   SEEDS);
    }

    // ── Per-seed lifecycle ────────────────────────────────────────────────────

    /// @dev Lifecycle: 14-day pool, 1M facility, 8 events (4 draw/repay rounds).
    ///
    ///      No-churn  (even seeds): round-2 repay at day 6, round-3 draw at day 7.
    ///      Churn     (odd  seeds): round-2 repay and round-3 draw both at day 5
    ///                              (same calendar day → actual churn).
    function _runSeed(uint256 seed, bool isForcedChurn)
        internal
        returns (uint256 contractIdle, uint256 refIdle, uint256 refIdleC, bool actualChurn)
    {
        uint256 snap     = vm.snapshot();
        uint256 r        = _rand(seed);
        uint256 idleRate = 5e14;
        uint256 FACILITY = 1_000_000 * SCALE;

        // Vary draw amounts per seed
        uint256[4] memory drawAmts;
        r = _rand(r); drawAmts[0] = (100_000 + (r % 5) * 50_000) * SCALE;
        r = _rand(r); drawAmts[1] = (100_000 + (r % 4) * 50_000) * SCALE;
        r = _rand(r); drawAmts[2] = (100_000 + (r % 5) * 50_000) * SCALE;
        r = _rand(r); drawAmts[3] = ( 50_000 + (r % 3) * 50_000) * SCALE;

        // Create pool at t=0; fMaturityTs = 5D (fundingDays=5, create at 0)
        vm.warp(0);
        PoolContract p;
        {
            vm.prank(DEPLOYER);
            address addr = factory.createPool(PoolFactory.CreatePoolParams({
                pspWallet:         PSP,
                fundingDurationSecs: 5 * 86400,
                softCap:           100 * SCALE,
                hardCap:           FACILITY,
                tenure:            TENURE,
                idleRateDaily:     idleRate,
                utilizedRateDaily: 1e15,
                penaltyRateDaily:  2e15,
                penaltyGraceDays:  0,
                minDeposit:        0,
                aprAnnual:         5e16,
                agent1:            AGENT1,
                agent2:            AGENT2,
                multisig:          MULTISIG
            }));
            p = PoolContract(addr);
        }
        _deposit(p, LP1, 1_000_000);
        vm.warp(p.fMaturityTs() + 60);
        p.finalizeFunding();

        uint256 startTs    = p.poolStartTs();
        uint256 finalityTs = p.poolFinalityTs();
        uint256 startDay   = startTs / D;

        // Initialise lazy-batch ref state
        RefState memory s;
        s.startDay      = startDay;
        s.lastBillable  = finalityTs / D - 1;
        s.lastIdleDay   = startDay;
        s.avail         = FACILITY;
        s.exempt        = 0;
        s.exemptUntilTs = 0;
        s.accIdle       = 0;

        // Day-records for ref_c (TENURE slots, indexed by day-offset from startDay)
        DayRecord[] memory dayRecs = new DayRecord[](TENURE);

        // ── Event helper lambdas (inline via local functions) ─────────────────

        // Round 0: draw at tenure day 1, repay at tenure day 2
        {
            bytes32 ref0 = keccak256(abi.encodePacked(seed, uint256(0)));
            uint256 amt0 = drawAmts[0];
            uint256 drawTs0 = startTs + D;
            vm.warp(drawTs0);
            vm.prank(AGENT2); p.executeDrawdown(ref0, PSP, amt0, 2);
            _refDraw(s, drawTs0, idleRate, amt0);
            dayRecs[drawTs0 / D - startDay].drawn += amt0;

            uint256 repayTs0 = startTs + 2 * D;
            vm.warp(repayTs0);
            _doRepay(p, ref0);
            _refRepay(s, repayTs0, idleRate, amt0);
            dayRecs[repayTs0 / D - startDay].repaid += amt0;
        }

        // Round 1: draw at tenure day 3, repay at tenure day 4
        {
            bytes32 ref1 = keccak256(abi.encodePacked(seed, uint256(1)));
            uint256 amt1 = drawAmts[1];
            uint256 drawTs1 = startTs + 3 * D;
            vm.warp(drawTs1);
            vm.prank(AGENT2); p.executeDrawdown(ref1, PSP, amt1, 2);
            _refDraw(s, drawTs1, idleRate, amt1);
            dayRecs[drawTs1 / D - startDay].drawn += amt1;

            uint256 repayTs1 = startTs + 4 * D;
            vm.warp(repayTs1);
            _doRepay(p, ref1);
            _refRepay(s, repayTs1, idleRate, amt1);
            dayRecs[repayTs1 / D - startDay].repaid += amt1;
        }

        // Round 2: draw at tenure day 5
        {
            bytes32 ref2 = keccak256(abi.encodePacked(seed, uint256(2)));
            uint256 amt2 = drawAmts[2];
            uint256 drawTs2 = startTs + 5 * D;
            vm.warp(drawTs2);
            vm.prank(AGENT2); p.executeDrawdown(ref2, PSP, amt2, 2);
            _refDraw(s, drawTs2, idleRate, amt2);
            dayRecs[drawTs2 / D - startDay].drawn += amt2;

            // Repay: churn (same day 5) or no-churn (day 6, noon)
            uint256 repayTs2 = isForcedChurn
                ? startTs + 5 * D + 3 * 3600    // 03:00 on day 5 (same day as draw)
                : startTs + 6 * D + 12 * 3600;  // 12:00 on day 6 (different day)
            vm.warp(repayTs2);
            _doRepay(p, ref2);
            _refRepay(s, repayTs2, idleRate, amt2);
            dayRecs[repayTs2 / D - startDay].repaid += amt2;
        }

        // Round 3: draw — churn (also day 5) or no-churn (day 7)
        {
            bytes32 ref3 = keccak256(abi.encodePacked(seed, uint256(3)));
            uint256 amt3 = drawAmts[3];
            uint256 drawTs3 = isForcedChurn
                ? startTs + 5 * D + 7 * 3600   // 07:00 on day 5 (after repay at 03:00)
                : startTs + 7 * D;              // midnight of day 7 (different from repay day 6)
            vm.warp(drawTs3);
            vm.prank(AGENT2); p.executeDrawdown(ref3, PSP, amt3, 2);
            _refDraw(s, drawTs3, idleRate, amt3);
            dayRecs[drawTs3 / D - startDay].drawn += amt3;

            // Repay round 3 at day 8
            uint256 repayTs3 = startTs + 8 * D;
            vm.warp(repayTs3);
            _doRepay(p, ref3);
            _refRepay(s, repayTs3, idleRate, amt3);
            dayRecs[repayTs3 / D - startDay].repaid += amt3;
        }

        // ── Accrue to finality ────────────────────────────────────────────────
        _refAccrue(s, finalityTs, idleRate);

        // Read contract view at finality
        vm.warp(finalityTs);
        (uint256 idleFees, , ) = p.getIdleFeesBreakdown();

        contractIdle = idleFees;
        refIdle      = s.accIdle;
        refIdleC     = _computeRefC(FACILITY, TENURE, idleRate, dayRecs);
        actualChurn  = _hasChurn(dayRecs);

        vm.revertTo(snap);
    }
}
