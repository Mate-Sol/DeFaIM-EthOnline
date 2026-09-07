// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Shared base — same parameters as AuditCleanup / GoldenVectors.
// All amounts use SCALE = 1e12 as per the golden-vector convention.
// ─────────────────────────────────────────────────────────────────────────────

contract VCBase is Test {
    uint256 constant SCALE = 1e12;
    uint256 constant WAD   = 1e18;
    uint256 constant D     = 86400;
    uint256 constant TENOR = 30;
    uint256 constant LOCK  = 5 * D;
    uint256 constant MAT   = LOCK + TENOR * D;   // 35 * D

    // Pool rates (WAD)
    uint256 constant IDLE_RATE = 5e14;   // 0.05% per day
    uint256 constant UTIL_RATE = 5e14;   // 0.05% per day
    uint256 constant PEN_RATE  = 1e15;   // 0.10% per day
    uint256 constant APR       = 1e17;   // 10% annual
    uint256 constant PGD       = 2;      // penaltyGraceDays
    uint256 constant MIN_DD    = 1;
    uint256 constant MAX_DD    = 7;

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant LP_A     = address(0xAAAA);

    MockStablecoin  usdc;
    TreasuryReserve treasury;
    PoolFactory     factory;

    function _deployInfra() internal {
        vm.warp(0);
        usdc     = new MockStablecoin();
        PoolContract impl = new PoolContract();
        treasury = new TreasuryReserve(
            address(usdc), MULTISIG, 1e17, 1_000_000 * SCALE, WAD, 0
        );
        factory = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl), address(treasury), address(usdc),
            30 * 86400, 25e16, 3, MIN_DD, MAX_DD
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);
    }

    function _createPool() internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           9_000_000 * SCALE,
            tenure:            TENOR,
            idleRateDaily:     IDLE_RATE,
            utilizedRateDaily: UTIL_RATE,
            penaltyRateDaily:  PEN_RATE,
            penaltyGraceDays:  PGD,
            minDeposit:        0,
            aprAnnual:         APR,
            agent1:            AGENT1,
            agent2:            AGENT2,
            multisig:          MULTISIG
        }));
        p = PoolContract(addr);
    }

    // Lock with 1M SCALE from LP_A deposited at t=0.
    // poolStartTs = LOCK, poolFinalityTs = MAT.
    // dollarSeconds = 1M * (5D fundingCredit + 30D span) = 1M * 35D
    function _lock(PoolContract p) internal {
        usdc.mint(LP_A, 1_000_000 * SCALE);
        vm.prank(LP_A); usdc.approve(address(p), type(uint256).max);
        vm.prank(LP_A); p.deposit(1_000_000 * SCALE);
        vm.warp(LOCK); p.finalizeFunding();
    }

    function _draw(PoolContract p, bytes32 ref, uint256 amt, uint256 settleDays) internal {
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, amt, settleDays);
    }

    function _repay(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.prank(PSP); usdc.approve(address(p), total);
        vm.prank(PSP); p.repay(ref);
    }

    // ── Oracle helpers (independent of the view functions) ────────────────────

    // Reference repayment finance charge — matches Python oracle day math.
    function _oracleFinanceCharge(
        uint256 principal_,
        uint256 startTs,
        uint256 expiryTs,
        uint256 nowTs
    ) internal pure returns (uint256 charge, uint256 daysTotal_, uint256 stdDays_, uint256 penDays_) {
        uint256 dueDayOffset   = (expiryTs - startTs) / D;
        uint256 rawElapsed     = MathLib.dayOf(nowTs) - MathLib.dayOf(startTs);
        uint256 pStart         = dueDayOffset + 1 + PGD;
        if (pStart > MAX_DD) pStart = MAX_DD;
        daysTotal_ = rawElapsed + 1;
        stdDays_   = daysTotal_ < pStart ? daysTotal_ : pStart;
        if (stdDays_ < MIN_DD) stdDays_ = MIN_DD;
        penDays_   = daysTotal_ > pStart ? daysTotal_ - pStart : 0;
        charge     = MathLib.mulDiv(
            principal_,
            stdDays_ * UTIL_RATE + penDays_ * PEN_RATE,
            WAD
        );
    }

    // Reference idle fees — mirrors the getIdleFeesBreakdown view formula.
    function _oracleIdleFees(
        uint256 avail,
        uint256 accrued,
        uint256 lastUpdate_,
        uint256 maturity_,
        uint256 nowTs
    ) internal pure returns (uint256 fees, uint256 penalty) {
        uint256 cutoff = nowTs < maturity_ ? nowTs : maturity_;
        fees = accrued;
        if (cutoff > lastUpdate_) {
            fees += MathLib.mulDiv(
                avail * (cutoff - lastUpdate_),
                IDLE_RATE,
                WAD * D
            );
        }
        penalty = 0;
        if (nowTs > maturity_ && fees > 0) {
            uint256 graceSecs       = PGD * D;
            uint256 updateAfterBase = cutoff > lastUpdate_ ? cutoff : lastUpdate_;
            uint256 start           = updateAfterBase > maturity_ + graceSecs
                ? updateAfterBase
                : maturity_ + graceSecs;
            if (nowTs > start) {
                penalty = MathLib.mulDiv(
                    fees * (nowTs - start),
                    PEN_RATE,
                    WAD * D
                );
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Repayment view tests
// ─────────────────────────────────────────────────────────────────────────────

contract RepaymentViewTest is VCBase {
    PoolContract p;
    bytes32 constant R1 = keccak256("r1");
    uint256 constant DRAW_AMT  = 100_000 * SCALE;
    uint256 constant SETTLE    = 4;  // days (inclusive count); expiryTs = LOCK+(SETTLE-1)*D

    function setUp() public {
        _deployInfra();
        p = _createPool();
        _lock(p);
        // Draw at LOCK with 4-day count (settlement_days=4); expiryTs = LOCK+3D
        _draw(p, R1, DRAW_AMT, SETTLE);
    }

    // getRepaymentOwed returns an independently-expected value at LOCK+3D.
    function test_repaymentOwed_midTenure_computation() public {
        vm.warp(LOCK + 3 * D);
        (uint256 principal_, uint256 fc, uint256 total) = p.getRepaymentOwed(R1);

        (uint256 expFc, uint256 expDays, uint256 expStd, uint256 expPen) =
            _oracleFinanceCharge(DRAW_AMT, LOCK, LOCK + (SETTLE - 1) * D, block.timestamp);

        assertEq(principal_, DRAW_AMT,  "principal");
        assertEq(fc,         expFc,     "financeCharge");
        assertEq(total,      DRAW_AMT + expFc, "total");

        // Expected: daysTotal=4, stdDays=4, penDays=0 (pStart=6 not reached yet)
        assertEq(expDays, 4, "oracle daysTotal");
        assertEq(expStd,  4, "oracle stdDays");
        assertEq(expPen,  0, "oracle penDays");

        // Verify the formula directly: 4 std days, no penalty
        uint256 directFc = MathLib.mulDiv(DRAW_AMT, 4 * UTIL_RATE, WAD);
        assertEq(fc, directFc, "finance charge matches direct formula");
    }

    // getRepaymentOwed tracks block.timestamp (not stale stored values).
    // Calling at LOCK+4D should be 1 extra stdDay vs LOCK+3D.
    function test_repaymentOwed_liveAccrual_warps() public {
        vm.warp(LOCK + 3 * D);
        (, uint256 fc1, ) = p.getRepaymentOwed(R1);

        vm.warp(LOCK + 4 * D);
        (, uint256 fc2, ) = p.getRepaymentOwed(R1);

        // One extra stdDay = +1 * UTIL_RATE * principal / WAD
        uint256 oneDayFc = MathLib.mulDiv(DRAW_AMT, UTIL_RATE, WAD);
        assertEq(fc2 - fc1, oneDayFc, "live accrual delta per day");
    }

    // getRepaymentOwed value must equal the penalty computation at LOCK+8D (2 penDays).
    function test_repaymentOwed_penaltyDays_computation() public {
        vm.warp(LOCK + 8 * D);
        (, uint256 fc, ) = p.getRepaymentOwed(R1);

        // At LOCK+8D: rawElapsed=8, daysTotal=9, pStart=6, stdDays=6, penDays=3
        uint256 directFc = MathLib.mulDiv(DRAW_AMT, 6 * UTIL_RATE + 3 * PEN_RATE, WAD);
        assertEq(fc, directFc, "penalty days computation");
    }

    // getRepaymentBreakdown totals match getRepaymentOwed exactly.
    function test_repaymentBreakdown_matchesRepaymentOwed() public {
        vm.warp(LOCK + 3 * D);

        (uint256 p1, uint256 fc1, uint256 t1) = p.getRepaymentOwed(R1);
        (uint256 p2, uint256 fc2, uint256 t2, , , ) = p.getRepaymentBreakdown(R1);

        assertEq(p2,  p1,  "principalOwed");
        assertEq(fc2, fc1, "financeCharge");
        assertEq(t2,  t1,  "total");
    }

    // getRepaymentBreakdown returns correct day components.
    function test_repaymentBreakdown_dayComponents() public {
        vm.warp(LOCK + 3 * D);
        (, , , uint256 elapsed, uint256 std, uint256 pen) = p.getRepaymentBreakdown(R1);
        // daysTotal=4, stdDays=4, penDays=0
        assertEq(elapsed, 4, "elapsedDays (Day-0-inclusive)");
        assertEq(std,     4, "stdDays");
        assertEq(pen,     0, "penDays");

        vm.warp(LOCK + 8 * D);
        (, , , uint256 elapsed2, uint256 std2, uint256 pen2) = p.getRepaymentBreakdown(R1);
        // daysTotal=9, pStart=6, stdDays=6, penDays=3
        assertEq(elapsed2, 9, "elapsedDays post-penalty");
        assertEq(std2,     6, "stdDays capped at pStart");
        assertEq(pen2,     3, "penDays");
    }

    // getRepaymentBreakdown.total == what repay() actually charges.
    function test_repaymentBreakdown_matchesRepayTransaction() public {
        vm.warp(LOCK + 3 * D);

        (, , uint256 viewTotal, , , ) = p.getRepaymentBreakdown(R1);

        // Mint viewTotal so PSP can cover principal + financeCharge.
        usdc.mint(PSP, viewTotal);
        uint256 pspBefore = usdc.balanceOf(PSP);  // draw proceeds + minted viewTotal
        vm.prank(PSP); usdc.approve(address(p), viewTotal);
        vm.prank(PSP); p.repay(R1);

        uint256 charged = pspBefore - usdc.balanceOf(PSP);
        assertEq(charged, viewTotal, "repay charge == breakdown total");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Idle-fees view tests
// ─────────────────────────────────────────────────────────────────────────────

contract IdleFeesViewTest is VCBase {
    PoolContract p;

    function setUp() public {
        _deployInfra();
        p = _createPool();
        _lock(p);
        // No drawdown: all 1M SCALE is idle throughout.
        // After lock: availableToDd=1M, lastUpdate=LOCK, accIdleFees=0, accPenalty=0.
    }

    // getIdleFeesBreakdown returns an independently-expected value at mid-tenure.
    function test_idleFeesOwed_baseFees_computation() public {
        vm.warp(LOCK + 10 * D);

        (uint256 fees, uint256 pen, uint256 total) = p.getIdleFeesBreakdown();

        // Oracle: avail=1M, delta=10D, idleFees = 1M * 10 * IDLE_RATE / WAD
        uint256 expFees = MathLib.mulDiv(1_000_000 * SCALE * 10 * D, IDLE_RATE, WAD * D);
        assertEq(fees,  expFees,        "base idle fees at +10D");
        assertEq(pen,   0,              "no penalty before maturity");
        assertEq(total, expFees,        "total == fees before maturity");
    }

    // Base idle must stop growing after maturity (capped at min(now, maturity)).
    function test_idleFeesOwed_capsAtMaturity() public {
        vm.warp(MAT);
        (, , uint256 totalAtMat) = p.getIdleFeesBreakdown();

        // 1 day past maturity — base idle must be the same
        vm.warp(MAT + 1 * D);
        (uint256 fees2, , uint256 total2) = p.getIdleFeesBreakdown();

        assertEq(fees2, MathLib.mulDiv(1_000_000 * SCALE * 30 * D, IDLE_RATE, WAD * D),
            "base idle == 30D of accrual");
        assertEq(total2, totalAtMat, "base idle does not grow past maturity");
    }

    // Penalty branch starts after maturity + grace, not before.
    function test_idleFeesOwed_penaltyBranch_startTime() public {
        // At MAT + pgd*D (grace end) — no penalty yet
        vm.warp(MAT + PGD * D);
        (, uint256 penAtGraceEnd, ) = p.getIdleFeesBreakdown();
        assertEq(penAtGraceEnd, 0, "no penalty at exact grace end");

        // Per-day model: penalty only billed on the NEXT complete calendar day after grace.
        vm.warp(MAT + (PGD + 1) * D);
        (, uint256 penAfterGrace, ) = p.getIdleFeesBreakdown();
        assertGt(penAfterGrace, 0, "penalty billed one full day past grace end");
    }

    // Penalty value at MAT + pgd*D + 1D matches independent computation.
    function test_idleFeesOwed_penaltyValue_computation() public {
        vm.warp(MAT + PGD * D + 1 * D);

        (uint256 fees, uint256 pen, uint256 total) = p.getIdleFeesBreakdown();

        uint256 baseFees = MathLib.mulDiv(1_000_000 * SCALE * 30 * D, IDLE_RATE, WAD * D);
        // penalty: baseFees accrued for 1D past grace end
        uint256 expPen   = MathLib.mulDiv(baseFees * D, PEN_RATE, WAD * D);

        assertEq(fees,  baseFees,          "base fees unchanged");
        assertEq(pen,   expPen,            "penalty for 1D post-grace");
        assertEq(total, baseFees + expPen, "total");
    }

    // getIdleFeesBreakdown tracks block.timestamp (not stale).
    // Calling at T then T+ΔT must change by the correct continuous-time delta.
    function test_idleFeesOwed_liveAccrual_warps() public {
        vm.warp(LOCK + 10 * D);
        (, , uint256 total1) = p.getIdleFeesBreakdown();

        uint256 deltaT = 7 * D; // warp by 7 days
        vm.warp(LOCK + 10 * D + deltaT);
        (, , uint256 total2) = p.getIdleFeesBreakdown();

        // Expected delta = 1M * deltaT * IDLE_RATE / (WAD * D)
        uint256 expectedDelta = MathLib.mulDiv(1_000_000 * SCALE * deltaT, IDLE_RATE, WAD * D);
        assertEq(total2 - total1, expectedDelta, "live accrual delta");
    }


    // getIdleFeesBreakdown.total == what payAccruedIdleFees actually charges.
    function test_idleFeesBreakdown_matchesPayTransaction() public {
        vm.warp(LOCK + 10 * D);

        (, , uint256 viewTotal) = p.getIdleFeesBreakdown();
        assertGt(viewTotal, 0, "must have fees to pay");

        usdc.mint(PSP, viewTotal);
        vm.prank(PSP); usdc.approve(address(p), viewTotal);

        uint256 pspBefore = usdc.balanceOf(PSP);
        vm.prank(PSP); p.payAccruedIdleFees(viewTotal);
        uint256 charged = pspBefore - usdc.balanceOf(PSP);

        assertEq(charged, viewTotal, "payAccruedIdleFees charges exactly breakdown total");
    }

    // Base idle is BORROWER-SIDE only. Overrun (extension yield) must NOT appear in idle fees.
    // Verify: at maturity+pgd+2D, getIdleFeesBreakdown equals the pure idle+penalty formula
    // (idle on availableToDd only, no overrun contribution).
    function test_idleFeesOwed_containsNoOverrunTerm() public {
        vm.warp(MAT + PGD * D + 2 * D);

        (uint256 fees, uint256 pen, uint256 total) = p.getIdleFeesBreakdown();

        // Pure idle: 30D of idle on 1M SCALE (no drawdown, so overrunYield=0 anyway)
        uint256 pureFees = MathLib.mulDiv(1_000_000 * SCALE * 30 * D, IDLE_RATE, WAD * D);
        // Penalty: pureFees accrued for 2D past grace end
        uint256 purePen  = MathLib.mulDiv(pureFees * 2 * D, PEN_RATE, WAD * D);

        assertEq(fees,  pureFees,           "idle fees = pure idle formula");
        assertEq(pen,   purePen,            "penalty = pure penalty formula");
        assertEq(total, pureFees + purePen, "total has no overrun term");

        // Confirm overrunYield (LP-side) is zero — it's only non-zero when there is
        // outstanding principal past maturity, which is not the case here.
        assertEq(p.overrunYield(), 0, "overrunYield=0 when no outstanding post-maturity");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Claimable-yield breakdown tests
// ─────────────────────────────────────────────────────────────────────────────

contract ClaimableYieldBreakdownTest is VCBase {
    PoolContract p;
    bytes32 constant R1 = keccak256("r1");
    uint256 constant DRAW_AMT = 100_000 * SCALE;
    uint256 constant SETTLE   = 3;

    function setUp() public {
        _deployInfra();
        p = _createPool();
        _lock(p);
        _draw(p, R1, DRAW_AMT, SETTLE);
        vm.warp(LOCK + 3 * D);
        _repay(p, R1); // collectedYield > 0 after repayment
    }

    // totalYield must equal what claimYield() actually transfers.
    function test_claimableYieldBreakdown_totalMatchesClaimYield() public {
        (uint256 base, , , uint256 total) = p.getClaimableYieldBreakdown(LP_A);
        assertGt(total, 0, "must have claimable yield after repayment");

        // base == total (only base yield in pre-maturity repayment, no overrun, no bonus)
        assertEq(base, total, "pre-maturity: only base yield");

        uint256 lpBefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.claimYield();
        uint256 transferred = usdc.balanceOf(LP_A) - lpBefore;

        assertEq(transferred, total, "claimYield transfers exactly breakdown total");
    }

    // getLpPosition.claimableYield_ matches getClaimableYieldBreakdown.baseYield
    // (both delegate to _computeBreakdown, so they are guaranteed bit-identical).
    function test_getLpPosition_claimableYield_matchesBreakdown() public {
        // Generate collectedYield via a second repayment
        _draw(p, keccak256("r2"), DRAW_AMT, SETTLE);
        vm.warp(LOCK + 7 * D);
        _repay(p, keccak256("r2"));

        (, , uint256 posYield, , , ) = p.getLpPosition(LP_A);
        (uint256 bdBase, , , ) = p.getClaimableYieldBreakdown(LP_A);

        assertEq(posYield, bdBase, "getLpPosition.claimableYield_ == breakdown.baseYield");
    }

    // Before finalization (no prior claimYield call), breakdown computes correct LP share.
    // LP_A has 100% of the pool so baseYield == collectedYield.
    function test_claimableYieldBreakdown_singleLp_fullShare() public {
        uint256 collYield = p.collectedYield();
        (uint256 base, uint256 ov, uint256 bon, uint256 total) = p.getClaimableYieldBreakdown(LP_A);

        // Single LP = 100% share; no overrun/bonus (pre-maturity repayment)
        assertEq(base,  collYield, "100% base yield share");
        assertEq(ov,    0,         "no overrun");
        assertEq(bon,   0,         "no bonus");
        assertEq(total, collYield, "total == collectedYield");
    }

    // Pool-level caps are applied: if pool has nothing left to pay, breakdown returns 0.
    function test_claimableYieldBreakdown_poolCap_zeroAfterClaim() public {
        vm.prank(LP_A); p.claimYield(); // claim everything

        (, , , uint256 totalAfter) = p.getClaimableYieldBreakdown(LP_A);
        assertEq(totalAfter, 0, "nothing left after full claim");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// getPoolMetrics timestamps test
// ─────────────────────────────────────────────────────────────────────────────

contract PoolMetricsTest is VCBase {
    PoolContract p;

    function setUp() public {
        _deployInfra();
        p = _createPool();
    }

    function test_poolMetrics_midFunding_timestamps() public {
        vm.warp(2 * D);

        (
            PoolContract.Status status_,
            , , , , , , , ,
            ,
            ,
            uint256 fundingStart,
            uint256 fMaturity,
            uint256 poolStart,
            uint256 poolFinality
        ) = p.getPoolMetrics();

        assertEq(uint8(status_), uint8(PoolContract.Status.Funding), "status=Funding");
        assertEq(fundingStart,   0,          "fundingStartTs = deploy time = 0");
        assertEq(fMaturity,      5 * D,      "fMaturityTs = 5 days");
        assertEq(poolStart,      0,          "poolStartTs = 0 before lock");
        assertEq(poolFinality,   0,          "poolFinalityTs = 0 before lock");
        assertEq(p.currentDay(), MathLib.dayOf(2 * D), "currentDay");
    }

    function test_poolMetrics_afterLock_timestamps() public {
        _lock(p);

        (
            PoolContract.Status status_,
            , , , , , , , ,
            ,
            ,
            ,
            ,
            uint256 poolStart,
            uint256 poolFinality
        ) = p.getPoolMetrics();

        assertEq(uint8(status_), uint8(PoolContract.Status.Active), "status=Active");
        assertEq(poolStart,   LOCK, "poolStartTs = LOCK");
        assertEq(poolFinality, MAT, "poolFinalityTs = MAT");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Treasury view tests
// ─────────────────────────────────────────────────────────────────────────────

contract TreasuryViewTest is VCBase {
    function setUp() public { _deployInfra(); }

    function test_reserveShortfallToTarget() public {
        // Initially no reserve balance, target = 1M SCALE
        uint256 shortfall = treasury.reserveShortfallToTarget();
        assertEq(shortfall, 1_000_000 * SCALE, "shortfall == target when balance=0");

        // Seed some reserve
        uint256 seed = 200_000 * SCALE;
        vm.store(address(treasury), bytes32(uint256(1)), bytes32(seed));
        uint256 shortfall2 = treasury.reserveShortfallToTarget();
        assertEq(shortfall2, 800_000 * SCALE, "shortfall reduced");
    }

    function test_getReserveStatus() public {
        (uint256 bal, uint256 target, uint256 imFees) = treasury.getReserveStatus();
        assertEq(bal,    0,                "initial balance=0");
        assertEq(target, 1_000_000 * SCALE, "target");
        assertEq(imFees, 0,                "imFees=0");
    }

    function test_riskParams() public {
        (uint256 rate, uint256 target, uint256 hurdle, uint256 lpShare) = treasury.riskParams();
        assertEq(rate,    1e17, "reserveRate");
        assertEq(target,  1_000_000 * SCALE, "reserveTarget");
        assertEq(hurdle,  WAD,  "hurdleFrac=1.0");
        assertEq(lpShare, 0,    "lpBonusShare=0");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit-breaker event tests (Task 3 verification)
// ─────────────────────────────────────────────────────────────────────────────

contract CircuitBreakerEventTest is VCBase {
    PoolContract p;

    function setUp() public {
        _deployInfra();
        p = _createPool();
        _lock(p);
    }

    function test_setPaused_emitsPoolPaused() public {
        // Disable scOverdueCheck first so setPaused is callable
        vm.prank(AGENT1); p.setScOverdue(false);

        vm.expectEmit(false, false, false, true);
        emit PoolContract.PoolPaused(true);
        vm.prank(AGENT1); p.setPaused(true);

        vm.expectEmit(false, false, false, true);
        emit PoolContract.PoolPaused(false);
        vm.prank(AGENT1); p.setPaused(false);
    }

    function test_setScOverdue_emitsScOverdueSet() public {
        vm.expectEmit(false, false, false, true);
        emit PoolContract.ScOverdueSet(false);
        vm.prank(AGENT1); p.setScOverdue(false);

        vm.expectEmit(false, false, false, true);
        emit PoolContract.ScOverdueSet(true);
        vm.prank(AGENT1); p.setScOverdue(true);
    }

    // setScOverdue(false) also emits PoolPaused with the computed paused state.
    function test_setScOverdue_false_emitsPoolPaused_noOverdue() public {
        // No overdue drawdowns -> paused=false
        vm.expectEmit(false, false, false, true);
        emit PoolContract.PoolPaused(false);
        vm.prank(AGENT1); p.setScOverdue(false);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Governance event field tests (BoundsUpdated, EnvelopeUpdated)
// ─────────────────────────────────────────────────────────────────────────────

contract GovernanceEventTest is VCBase {
    function setUp() public { _deployInfra(); }

    function test_boundsUpdated_emitsAllFields() public {
        vm.expectEmit(false, false, false, true);
        emit PoolFactory.BoundsUpdated(10 * 86400, 25e16, 5, 2, 14);
        vm.prank(MULTISIG); factory.setBounds(10 * 86400, 25e16, 5, 2, 14);

        assertEq(factory.maxFundingDurationSecs(), 10 * 86400, "maxFundingDurationSecs");
        assertEq(factory.fundingExecBufferDays(), 25e16, "bufferDays");
        assertEq(factory.maxGracePeriodDays(),    5,     "maxGrace");
        assertEq(factory.minDdDays(),             2,     "minDd");
        assertEq(factory.maxDdDays(),             14,    "maxDd");
    }

    function test_envelopeUpdated_emitsAllFields() public {
        PoolFactory.Envelope memory e = PoolFactory.Envelope({
            minApr:         1e16,
            maxApr:         5e17,
            minTenure:      7,
            maxTenure:      365,
            minPgd:         1,
            maxPgd:         7,
            minIdleRate:    1e14,
            maxIdleRate:    2e15,
            minUtilRate:    1e14,
            maxUtilRate:    2e15,
            minPenRate:     5e14,
            maxPenRate:     5e15,
            hardCapCeiling: 100_000_000 * SCALE
        });

        vm.expectEmit(false, false, false, true);
        emit PoolFactory.EnvelopeUpdated(
            e.minApr, e.maxApr,
            e.minTenure, e.maxTenure,
            e.minPgd, e.maxPgd,
            e.minIdleRate, e.maxIdleRate,
            e.minUtilRate, e.maxUtilRate,
            e.minPenRate, e.maxPenRate,
            e.hardCapCeiling
        );
        vm.prank(MULTISIG); factory.setEnvelope(e);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement event field tests (DefaultSettledPrincipal / DefaultSettledYield)
// fromDirect + fromReserve == paid for both events.
// ─────────────────────────────────────────────────────────────────────────────

contract SettlementEventTest is VCBase {
    PoolContract p;
    bytes32 constant REF = keccak256("dd");
    uint256 constant DRAW_AMT = 300_000 * SCALE;

    function setUp() public {
        _deployInfra();
        p = _createPool();
        _lock(p);
        _draw(p, REF, DRAW_AMT, 3);
        // Advance past maturity so declareDefault is valid (drawdown is overdue).
        vm.warp(MAT + 1 * D);
        vm.prank(AGENT2); p.declareDefault();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default), "must be Default");
    }

    // settleDefaultPrincipal: fromDirect + fromReserve == paid.
    // Direct-only path: multisig provides full owed amount, reserve contributes 0.
    function test_defaultSettledPrincipal_fromDirect_plus_fromReserve_eq_paid() public {
        uint256 owed = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        assertGt(owed, 0, "must have outstanding principal");

        usdc.mint(MULTISIG, owed);
        vm.prank(MULTISIG); usdc.approve(address(p), owed);

        vm.recordLogs();
        vm.prank(MULTISIG); p.settleDefaultPrincipal(owed);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("DefaultSettledPrincipal(uint256,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == sig) {
                (uint256 paid, uint256 fromDirect, uint256 fromReserve) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256));
                assertEq(fromDirect + fromReserve, paid, "fromDirect + fromReserve == paid");
                assertEq(fromDirect,  owed, "direct = owed (no reserve)");
                assertEq(fromReserve, 0,    "reserve = 0 (empty treasury)");
                found = true;
            }
        }
        assertTrue(found, "DefaultSettledPrincipal event must fire");
    }

    // settleDefaultYield: fromDirect + fromReserve == paid.
    // Direct-only path: settle principal first, then yield.
    function test_defaultSettledYield_fromDirect_plus_fromReserve_eq_paid() public {
        // Settle principal first (required gating condition).
        uint256 pOwed = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        if (pOwed > 0) {
            usdc.mint(MULTISIG, pOwed);
            vm.prank(MULTISIG); usdc.approve(address(p), pOwed);
            vm.prank(MULTISIG); p.settleDefaultPrincipal(pOwed);
        }

        uint256 yShort  = p.yieldOwed()   > p.collectedYield()        ? p.yieldOwed()   - p.collectedYield()        : 0;
        uint256 ovShort = p.overrunYield() > p.collectedOverrunYield() ? p.overrunYield() - p.collectedOverrunYield() : 0;
        uint256 yOwed   = yShort + ovShort;
        if (yOwed == 0) return; // nothing to settle — test degenerates to passing vacuously

        usdc.mint(MULTISIG, yOwed);
        vm.prank(MULTISIG); usdc.approve(address(p), yOwed);

        vm.recordLogs();
        vm.prank(MULTISIG); p.settleDefaultYield(yOwed);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("DefaultSettledYield(uint256,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == sig) {
                (uint256 paid, uint256 fromDirect, uint256 fromReserve) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256));
                assertEq(fromDirect + fromReserve, paid, "fromDirect + fromReserve == paid");
                assertEq(fromDirect,  yOwed, "direct = yOwed (no reserve)");
                assertEq(fromReserve, 0,     "reserve = 0 (empty treasury)");
                found = true;
            }
        }
        assertTrue(found, "DefaultSettledYield event must fire");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fractional funding-duration snap tests
// Verifies that fundingDurationSecs (in seconds) snaps fMaturityTs to the next
// UTC midnight regardless of pool creation time.
// ─────────────────────────────────────────────────────────────────────────────

contract FundingDurationSnapTest is VCBase {
    uint256 constant SCALE2 = 1e12;
    uint256 constant WAD2   = 1e18;

    // Deploy a fresh factory with maxFundingDurationSecs ceiling and return it.
    function _factoryWith(uint256 maxFundingDurationSecs_) internal returns (PoolFactory f) {
        PoolContract impl2 = new PoolContract();
        TreasuryReserve tr2 = new TreasuryReserve(
            address(usdc), MULTISIG, 1e17, 1_000_000 * SCALE2, WAD2, 0
        );
        f = new PoolFactory(
            MULTISIG, DEPLOYER, address(impl2), address(tr2), address(usdc),
            maxFundingDurationSecs_, 25e16, 3, 1, 7
        );
        vm.prank(MULTISIG); tr2.setFactory(address(f));
        vm.prank(MULTISIG); f.approvePsp(PSP);
    }

    function _deployPool(PoolFactory f, uint256 fundingDurationSecs_) internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = f.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: fundingDurationSecs_,
            softCap:             1 * SCALE2,
            hardCap:             9_000_000 * SCALE2,
            tenure:              7,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    0,
            minDeposit:          0,
            aprAnnual:           5e16,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
        p = PoolContract(addr);
    }

    // Deploy at 23:50:00 UTC (85800 s) with 600-second funding window.
    // fMaturityRaw = 85800 + 600 = 86400 — exactly midnight, snap == 0.
    function test_snap_10min_window_at_2350() public {
        uint256 createTs = 23 * 3600 + 50 * 60;  // 85800 s = 23:50:00 UTC
        vm.warp(createTs);
        usdc = new MockStablecoin();
        PoolFactory f = _factoryWith(600);
        PoolContract p = _deployPool(f, 600);

        assertEq(p.fMaturityTs() % D, 0, "fMaturityTs must be midnight-aligned");
        assertEq(p.fMaturityTs(), 86400,  "fMaturityTs = 86400 (next midnight)");

        // Finalize at fMaturityTs (no latency) — poolFinalityTs must also be midnight.
        usdc.mint(LP_A, 1_000_000 * SCALE2);
        vm.prank(LP_A); usdc.approve(address(p), type(uint256).max);
        vm.prank(LP_A); p.deposit(1_000_000 * SCALE2);
        vm.warp(p.fMaturityTs());
        p.finalizeFunding();
        assertEq(p.poolFinalityTs() % D, 0, "poolFinalityTs must be midnight-aligned");
    }

    // Deploy at 12:00:00 UTC with 600-second funding window.
    // fMaturityRaw = 43200 + 600 = 43800 — mid-day, snapped to 86400.
    function test_snap_10min_window_midday() public {
        uint256 createTs = 12 * 3600;  // 43200 s = noon
        vm.warp(createTs);
        usdc = new MockStablecoin();
        PoolFactory f = _factoryWith(600);
        PoolContract p = _deployPool(f, 600);

        assertEq(p.fMaturityTs() % D, 0, "fMaturityTs must be midnight-aligned");
        assertEq(p.fMaturityTs(), 86400,  "fMaturityTs = next midnight = 86400");
    }

    // Deploy at midnight with exactly 5-day funding (legacy integer-day case).
    // fMaturityRaw = 0 + 5*D — already midnight, snap == 0.
    function test_snap_5day_window_at_midnight() public {
        vm.warp(0);
        usdc = new MockStablecoin();
        PoolFactory f = _factoryWith(5 * D);
        PoolContract p = _deployPool(f, 5 * D);

        assertEq(p.fMaturityTs() % D, 0,    "fMaturityTs must be midnight-aligned");
        assertEq(p.fMaturityTs(),     5 * D, "fMaturityTs = 5 days");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-pool fundingDurationSecs: independence, ceiling validation, maxTenure
// ─────────────────────────────────────────────────────────────────────────────

contract PerPoolFundingDurationTest is VCBase {

    // Two pools with different funding durations share the same factory but get
    // independent fMaturityTs values — no cross-contamination.
    function test_two_pools_independent_funding_windows() public {
        _deployInfra();
        vm.warp(0);

        // Pool A: 1-day funding window
        vm.prank(DEPLOYER);
        address addrA = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 1 * D,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              30,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    0,
            minDeposit:          0,
            aprAnnual:           APR,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
        PoolContract poolA = PoolContract(addrA);

        // Advance time — pool B is deployed later with a 10-day funding window
        vm.warp(2 * D);  // noon, day 2

        address psp2 = address(0x6666);
        vm.prank(MULTISIG); factory.approvePsp(psp2);
        vm.prank(DEPLOYER);
        address addrB = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           psp2,
            fundingDurationSecs: 10 * D,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              30,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    0,
            minDeposit:          0,
            aprAnnual:           APR,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
        PoolContract poolB = PoolContract(addrB);

        // Pool A: created at t=0 with 1D → fMaturityTs = 1*D (midnight-aligned, no snap needed)
        assertEq(poolA.fMaturityTs(), 1 * D, "poolA: fMaturityTs = 1 day");
        assertEq(poolA.fundingDurationSecs(), 1 * D, "poolA: stored fundingDurationSecs");

        // Pool B: created at t=2D with 10D → fMaturityTs = 12D (midnight-aligned)
        assertEq(poolB.fMaturityTs(), 12 * D, "poolB: fMaturityTs = 12 days");
        assertEq(poolB.fundingDurationSecs(), 10 * D, "poolB: stored fundingDurationSecs");
    }

    // fundingDurationSecs = 0 is rejected.
    function test_createPool_zeroDuration_reverts() public {
        _deployInfra();
        vm.prank(DEPLOYER);
        vm.expectRevert("Factory: bad fundingDuration");
        factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 0,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              30,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    0,
            minDeposit:          0,
            aprAnnual:           APR,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
    }

    // fundingDurationSecs = maxFundingDurationSecs + 1 is rejected.
    function test_createPool_overCeiling_reverts() public {
        _deployInfra();
        vm.prank(DEPLOYER);
        vm.expectRevert("Factory: bad fundingDuration");
        factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 30 * D + 1,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              30,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    0,
            minDeposit:          0,
            aprAnnual:           APR,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
    }

    // fundingDurationSecs = maxFundingDurationSecs exactly is accepted.
    function test_createPool_atCeiling_accepted() public {
        _deployInfra();
        // maxTenureSecs ≈ 30D + buffer + 30D ≈ 60.25D; APR constraint requires ≤ ~9.09%.
        // Use 8% (8e16) so the APR guard passes and the test isolates only the ceiling bound.
        vm.warp(0);  // ensure exact midnight so snap = 0
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 30 * D,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              30,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    0,
            minDeposit:          0,
            aprAnnual:           8e16,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
        assertFalse(addr == address(0), "at-ceiling pool must be created");
    }

    // At the funding ceiling, an APR that the utilized rate cannot cover is rejected by
    // the solvency guard — locking the coverability interaction at the ceiling boundary.
    function test_createPool_atCeiling_uncoverableAPR_rejected() public {
        _deployInfra();
        // With fundingDurationSecs = 30D and tenure = 30:
        //   maxTenureSecs = 30D + 0 + bufferSecs + 30D + 0 ≈ 60.25D
        //   APR guard: aprAnnual * maxTenureSecs <= utilizedRateDaily * 365 * tenure * D
        //   10% annual (1e17) exceeds the ~9.09% threshold at these parameters.
        vm.warp(0);
        vm.prank(DEPLOYER);
        vm.expectRevert("Factory: APR not coverable by util rate");
        factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 30 * D,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              30,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    0,
            minDeposit:          0,
            aprAnnual:           APR,   // 10% — not coverable at 30-day funding ceiling
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));
    }

    // maxTenureSecs reflects the per-pool funding duration.
    // Pool with 10-day funding has a larger maxTenureSecs than one with 1-day funding.
    function test_maxTenureSecs_uses_perPool_fundingDuration() public {
        _deployInfra();
        vm.warp(0);  // deploy at midnight so snap = 0 for clean arithmetic

        vm.prank(DEPLOYER);
        address addrShort = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           PSP,
            fundingDurationSecs: 1 * D,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              30,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    2,
            minDeposit:          0,
            aprAnnual:           5e16,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));

        address psp2 = address(0x7777);
        vm.prank(MULTISIG); factory.approvePsp(psp2);
        vm.prank(DEPLOYER);
        address addrLong = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           psp2,
            fundingDurationSecs: 10 * D,
            softCap:             1 * SCALE,
            hardCap:             9_000_000 * SCALE,
            tenure:              30,
            idleRateDaily:       IDLE_RATE,
            utilizedRateDaily:   UTIL_RATE,
            penaltyRateDaily:    PEN_RATE,
            penaltyGraceDays:    2,
            minDeposit:          0,
            aprAnnual:           5e16,
            agent1:              AGENT1,
            agent2:              AGENT2,
            multisig:            MULTISIG
        }));

        PoolContract short_ = PoolContract(addrShort);
        PoolContract long_  = PoolContract(addrLong);

        // Both at midnight, snap = 0.
        // short: maxTenure = 1D + 0 + 0.25D + 30D + 2D = 33.25D
        // long:  maxTenure = 10D + 0 + 0.25D + 30D + 2D = 42.25D
        uint256 bufferSecs = 25e16 * D / 1e18;   // 0.25 * D = 21600
        assertEq(short_.maxTenureSecs(), 1 * D + bufferSecs + 30 * D + 2 * D, "short maxTenureSecs");
        assertEq(long_.maxTenureSecs(),  10 * D + bufferSecs + 30 * D + 2 * D, "long maxTenureSecs");
        assertGt(long_.maxTenureSecs(), short_.maxTenureSecs(), "longer funding -> larger maxTenureSecs");
    }
}
