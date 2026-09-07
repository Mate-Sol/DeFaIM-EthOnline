// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";
import "../src/MathLib.sol";

/// @dev Second adversarial round: economic-attack testing on terminal/default/failure paths.
///
/// Investigation only — no contract changes.  A test FAILING means the attack succeeded
/// (invariant broken) — that is the valuable finding; stop and report.
///
/// Attack categories:
///   C1  Conservation under adversarial sequencing on terminal paths
///   C2  Cross-actor yield/principal extraction around pre-maturity rebase
///   C3  Waterfall boundary: just-under / at / just-over total obligation
///   C4  Reserve interactions (empty reserve, partial draw)
///   C5  Overrun + idle penalty simultaneously (two-clock consistency)
///   C6  Idempotency / replay of terminal functions
contract AdversarialRound2Test is Test {
    uint256 constant SCALE = 1e12;
    uint256 constant WAD   = 1e18;
    uint256 constant D     = 86400;
    uint256 constant YEAR  = 365 * D;

    uint256 constant APR       = 1e17;   // 10%/yr
    uint256 constant IDLE_RATE = 5e14;   // 0.05%/day
    uint256 constant UTIL_RATE = 5e14;   // 0.05%/day
    uint256 constant PEN_RATE  = 1e15;   // 0.1%/day
    uint256 constant PGD       = 2;      // penaltyGraceDays
    uint256 constant TENURE    = 30;
    uint256 constant RESERVE_RATE   = 1e17;
    uint256 constant RESERVE_TARGET = 1_000_000 * SCALE;
    uint256 constant HURDLE_FRAC    = 1e18;  // 100% hurdle => LP bonus = 0
    uint256 constant LP_BONUS       = 0;

    uint256 constant LOCK_TS  = 5 * D;
    uint256 constant MATURITY = LOCK_TS + TENURE * D;

    address constant MULTISIG = address(0x1111);
    address constant DEPLOYER = address(0x2222);
    address constant AGENT1   = address(0x3333);
    address constant AGENT2   = address(0x4444);
    address constant PSP      = address(0x5555);
    address constant LP_A     = address(0xAAAA);
    address constant LP_B     = address(0xBBBB);

    MockStablecoin usdc;
    TreasuryReserve treasury;
    PoolFactory    factory;
    PoolContract   impl;

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
            30 * 86400, 25e16, 3, 1, 7  // fundingDurationSecs, bufferWAD, maxGrace, minDd, maxDd
        );
        vm.prank(MULTISIG); treasury.setFactory(address(factory));
        vm.prank(MULTISIG); factory.approvePsp(PSP);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _newPool() internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           1 * SCALE,
            hardCap:           9_000_000 * SCALE,
            tenure:            TENURE,
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

    function _deposit(PoolContract p, address lp, uint256 rawAmt) internal {
        uint256 amt = rawAmt * SCALE;
        usdc.mint(lp, amt);
        vm.prank(lp); usdc.approve(address(p), amt);
        vm.prank(lp); p.deposit(amt);
    }

    function _lock(PoolContract p) internal {
        vm.warp(LOCK_TS);
        p.finalizeFunding();
    }

    function _lockAt(PoolContract p, uint256 ts) internal {
        vm.warp(ts);
        p.finalizeFunding();
    }

    function _draw(PoolContract p, bytes32 ref, uint256 rawAmt, uint256 settle) internal {
        uint256 amt = rawAmt * SCALE;
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, amt, settle);
    }

    // Draw an exact amount in raw token units (not scaled) — used for ±1-unit boundary tests.
    function _drawRaw(PoolContract p, bytes32 ref, uint256 exactAmt, uint256 settle) internal {
        vm.prank(AGENT2); p.executeDrawdown(ref, PSP, exactAmt, settle);
    }

    function _repay(PoolContract p, bytes32 ref) internal {
        (, , uint256 total) = p.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.prank(PSP); usdc.approve(address(p), total);
        vm.prank(PSP); p.repay(ref);
    }

    function _payIdle(PoolContract p) internal {
        (, , uint256 total) = p.getIdleFeesBreakdown();
        if (total == 0) return;
        usdc.mint(PSP, total);
        vm.prank(PSP); usdc.approve(address(p), total);
        vm.prank(PSP); p.payAccruedIdleFees(total);
    }

    function _assertI1(PoolContract p, string memory label) internal view {
        uint256 poolBal  = usdc.balanceOf(address(p));
        uint256 expected =
            (p.principal() - p.outstanding() - p.claimedPrincipal())
            + (p.collectedYield()        - p.claimedYield())
            + p.reservedYield()
            + (p.collectedOverrunYield() - p.claimedOverrunYield())
            + (p.collectedBonus()        - p.claimedBonus())
            + p.protocolFees();
        assertEq(poolBal, expected, label);
    }

    // ── C1a: Conservation — claim in Active, pool closes, claim again ─────────
    //
    // Attack: LP claims all available yield while Active, pool closes normally,
    // LP claims again.  Can the second claim extract more than zero?
    // Can total claimed ever exceed collectedYield?

    function testC1a_doubleClaimAcrossClose_noExcess() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 200_000);
        _lock(p);
        _draw(p, keccak256("d1"), 100_000, 7);

        // Repay at day 10 (pre-maturity) — generates collectedYield
        vm.warp(LOCK_TS + 10 * D);
        _repay(p, keccak256("d1"));
        assertGt(p.collectedYield(), 0, "collectedYield must be positive after repay");
        _assertI1(p, "I1 after repay");

        // First claim: LP takes their full share
        uint256 lpBefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.claimYield();
        uint256 firstClaim = usdc.balanceOf(LP_A) - lpBefore;
        assertGt(firstClaim, 0, "first claim must be positive");
        _assertI1(p, "I1 after first claim");

        // Warp to maturity; idle fees paid; pool closes
        vm.warp(MATURITY);
        _payIdle(p);
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "pool must close at maturity");
        _assertI1(p, "I1 at close");

        // Second claim attempt: claimable must be zero or minimal (just rounding)
        uint256 lpBefore2 = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.claimYield();
        uint256 secondClaim = usdc.balanceOf(LP_A) - lpBefore2;
        // LP is the sole depositor; they claimed their full share in the first call.
        // After any additional yield from terminal split (none here: LP_BONUS=0), collectedBonus=0.
        // Total claimed must not exceed total collected.
        assertEq(p.claimedYield(), p.collectedYield(), "claimedYield must equal collectedYield for sole LP");
        assertEq(p.claimedBonus(), 0, "no bonus with hurdle=100%");
        _assertI1(p, "I1 after second claim");

        // Conservation: total claimed by LP = collectedYield (sole depositor)
        assertEq(firstClaim + secondClaim, p.collectedYield(), "total LP receipts must equal collectedYield");
    }

    // ── C1b: Conservation — interleaved partial settles and claims in Default ──
    //
    // Attack: Multisig settles 50% of principal shortfall; LP claims immediately;
    // multisig settles remaining 50%; LP claims again.  Can claimed principal
    // exceed collectedPrincipal?  Can I1 break?

    function testC1b_interleavedSettle_claimPrincipal_noExcess() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);
        _draw(p, keccak256("d1"), 80_000, 1);

        // Warp to maturity+1D; declare default (80k outstanding)
        vm.warp(MATURITY + 1 * D);
        vm.prank(AGENT2); p.declareDefault();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default));
        _assertI1(p, "I1 at Default entry");

        // Settle 50% of principal shortfall
        uint256 pShort = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        uint256 half = pShort / 2;
        usdc.mint(MULTISIG, half);
        vm.prank(MULTISIG); usdc.approve(address(p), half);
        vm.prank(MULTISIG); p.settleDefaultPrincipal(half);
        _assertI1(p, "I1 after partial principal settle");

        // LP claims principal mid-sequence
        uint256 lpBefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.claimPrincipal();
        uint256 firstClaim = usdc.balanceOf(LP_A) - lpBefore;
        _assertI1(p, "I1 after first principal claim");

        // Settle remaining principal
        uint256 pShort2 = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        if (pShort2 > 0) {
            usdc.mint(MULTISIG, pShort2);
            vm.prank(MULTISIG); usdc.approve(address(p), pShort2);
            vm.prank(MULTISIG); p.settleDefaultPrincipal(pShort2);
        }
        _assertI1(p, "I1 after full principal settle");

        // Settle yield shortfall (required before pool can close)
        uint256 yShort  = p.yieldOwed() > p.collectedYield()
            ? p.yieldOwed() - p.collectedYield() : 0;
        uint256 ovShort = p.overrunYield() > p.collectedOverrunYield()
            ? p.overrunYield() - p.collectedOverrunYield() : 0;
        uint256 totalY  = yShort + ovShort;
        if (totalY > 0) {
            usdc.mint(MULTISIG, totalY);
            vm.prank(MULTISIG); usdc.approve(address(p), totalY);
            vm.prank(MULTISIG); p.settleDefaultYield(totalY);
        }
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "must close after full settlement");
        _assertI1(p, "I1 at close after settlement");

        // LP claims the second half of principal (plus any yield)
        vm.prank(LP_A); p.claimPrincipal();
        uint256 secondClaim = usdc.balanceOf(LP_A) - lpBefore - firstClaim;
        _assertI1(p, "I1 after second principal claim");

        // Conservation: total principal claimed <= collectedPrincipal (= principal for sole LP)
        assertEq(p.claimedPrincipal(), p.collectedPrincipal(),
            "sole LP must claim all collected principal");
        assertLe(firstClaim + secondClaim, p.collectedPrincipal(),
            "total principal claims must not exceed collected");
    }

    // ── C1c: Claim yield in Default, then settleDefaultYield, claim again ─────
    //
    // Attack: In Default state LP claims yield when collectedYield < yieldOwed
    // (nothing claimable yet), then multisig settles, then LP claims.
    // Can total claimed yield exceed collectedYield?

    function testC1c_claimInDefault_thenSettle_thenClaim_noExcess() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _deposit(p, LP_B, 100_000);
        _lock(p);
        _draw(p, keccak256("d1"), 80_000, 1);

        vm.warp(MATURITY + 1 * D);
        vm.prank(AGENT2); p.declareDefault();
        _assertI1(p, "I1 at Default");

        // Settle principal first (required before settleDefaultYield)
        uint256 pShort = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        if (pShort > 0) {
            usdc.mint(MULTISIG, pShort);
            vm.prank(MULTISIG); usdc.approve(address(p), pShort);
            vm.prank(MULTISIG); p.settleDefaultPrincipal(pShort);
        }
        _assertI1(p, "I1 after principal settled");

        // LP_A claims yield BEFORE settleDefaultYield: must get 0 (or near-0)
        // because collectedYield may already cover some via waterfall
        uint256 lpABefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.claimYield();
        uint256 lpAFirst = usdc.balanceOf(LP_A) - lpABefore;
        _assertI1(p, "I1 after LP_A pre-settle claim");

        // Settle yield
        uint256 yShort  = p.yieldOwed() > p.collectedYield()
            ? p.yieldOwed() - p.collectedYield() : 0;
        uint256 ovShort = p.overrunYield() > p.collectedOverrunYield()
            ? p.overrunYield() - p.collectedOverrunYield() : 0;
        uint256 totalY  = yShort + ovShort;
        if (totalY > 0) {
            usdc.mint(MULTISIG, totalY);
            vm.prank(MULTISIG); usdc.approve(address(p), totalY);
            vm.prank(MULTISIG); p.settleDefaultYield(totalY);
        }
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "must close");
        _assertI1(p, "I1 at close");

        // LP_A claims remaining yield after settle
        vm.prank(LP_A); p.claimYield();
        uint256 lpATotal = usdc.balanceOf(LP_A) - lpABefore;
        _assertI1(p, "I1 after LP_A second yield claim");

        // LP_B claims (no prior claims)
        uint256 lpBBefore = usdc.balanceOf(LP_B);
        vm.prank(LP_B); p.claimYield();
        uint256 lpBTotal = usdc.balanceOf(LP_B) - lpBBefore;
        _assertI1(p, "I1 after LP_B yield claim");

        // Conservation: total claimed must not exceed total collected
        uint256 totalClaimed = p.claimedYield() + p.claimedOverrunYield();
        uint256 totalCollected = p.collectedYield() + p.collectedOverrunYield();
        assertEq(totalClaimed, totalCollected,
            "total claimed (sole 2-LP pool) must equal total collected yield");
        assertLe(lpATotal + lpBTotal, totalCollected,
            "sum of LP receipts must not exceed total collected yield");
    }

    // ── C2: Rebase fairness attack — late LP front-runs pre-maturity rebase ───
    //
    // Attack: LP_A deposits late (small fundingCredit, lower post-rebase share).
    //         LP_B deposits early (large fundingCredit, higher post-rebase share).
    //         LP_A calls claimYield BEFORE default is declared, claiming based on
    //         the old (larger) span which over-weights LP_A's share.
    //         Default is then declared, rebasing span downward.
    //         LP_B claims post-rebase with the corrected (smaller) span.
    //
    // Expected: I1 holds (conservation), but LP_B is squeezed below their
    //           post-rebase proportional entitlement.
    //
    // This test PASSES if conservation holds (I1 holds) even when fairness is
    // disturbed.  A FAIL here would mean conservation broke — which is the
    // actual security finding.

    function testC2_rebase_lateLp_frontrun_conservationHolds() public {
        PoolContract p = _newPool();

        // LP_B deposits early (day 0 of funding) — large fundingCredit
        vm.warp(0);
        _deposit(p, LP_B, 100_000);

        // LP_A deposits late (day 4 of funding) — small fundingCredit
        vm.warp(4 * D);
        _deposit(p, LP_A, 100_000);

        // Lock at day 5
        _lock(p);

        // Draw 100k (half the pool stays idle), so idle fees generate some collectedYield
        _draw(p, keccak256("d1"), 100_000, 7);

        // Warp to day 8 (3 days post-lock): idle fees have accrued on idle 100k
        vm.warp(LOCK_TS + 3 * D);
        _payIdle(p);  // pays idle fees → _allocate → some collectedYield

        uint256 cy0 = p.collectedYield();
        assertGt(cy0, 0, "collectedYield must be positive after idle fee payment");
        _assertI1(p, "I1 after idle fee payment");

        // LP_A front-runs: claims based on OLD span (large span, LP_A has ~47% share)
        uint256 lpABefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.claimYield();
        uint256 lpAClaim1 = usdc.balanceOf(LP_A) - lpABefore;
        _assertI1(p, "I1 after LP_A pre-rebase claim");

        // Default at day 10 (pre-maturity, elapsed=5D): rebase triggers
        // Rebase condition: earned = mulDiv(dsElapsed, APR, WAD*YEAR).
        // With small idle fees collected vs large LP coupon, earned > collectedYield.
        vm.warp(LOCK_TS + 5 * D);
        vm.prank(AGENT2); p.declareDefault();
        // The pool enters Default (outstanding 100k draw, yieldOwed likely > collected)
        // OR closes immediately if waterfall covers all. Either way, check I1.
        _assertI1(p, "I1 after declareDefault");

        bool poolClosed = (uint8(p.status()) == uint8(PoolContract.Status.Closed));

        if (!poolClosed) {
            // Need to settle to close; LP_B can only claim once pool is Closed/Default
            uint256 pShort = p.principal() > p.collectedPrincipal()
                ? p.principal() - p.collectedPrincipal() : 0;
            if (pShort > 0) {
                usdc.mint(MULTISIG, pShort);
                vm.prank(MULTISIG); usdc.approve(address(p), pShort);
                vm.prank(MULTISIG); p.settleDefaultPrincipal(pShort);
            }
            _assertI1(p, "I1 after principal settle");

            uint256 yShort  = p.yieldOwed() > p.collectedYield()
                ? p.yieldOwed() - p.collectedYield() : 0;
            uint256 ovShort = p.overrunYield() > p.collectedOverrunYield()
                ? p.overrunYield() - p.collectedOverrunYield() : 0;
            if (yShort + ovShort > 0) {
                usdc.mint(MULTISIG, yShort + ovShort);
                vm.prank(MULTISIG); usdc.approve(address(p), yShort + ovShort);
                vm.prank(MULTISIG); p.settleDefaultYield(yShort + ovShort);
            }
            _assertI1(p, "I1 after full settlement");
        }

        // LP_B claims post-rebase
        uint256 lpBBefore = usdc.balanceOf(LP_B);
        vm.prank(LP_B); p.claimYield();
        uint256 lpBClaim = usdc.balanceOf(LP_B) - lpBBefore;
        _assertI1(p, "I1 after LP_B post-rebase claim");

        // LP_A claims again (should get extra or zero depending on rebase direction)
        vm.prank(LP_A); p.claimYield();
        _assertI1(p, "I1 after LP_A post-rebase re-claim");

        uint256 totalYieldClaimed = p.claimedYield() + p.claimedOverrunYield();
        uint256 totalYieldCollected = p.collectedYield() + p.collectedOverrunYield();

        // KEY conservation invariant: total LP yield receipts must not exceed total collected
        assertLe(totalYieldClaimed, totalYieldCollected,
            "total claimed yield must not exceed collected yield [I1 violation if fails]");

        // Fairness observation: LP_A's first claim may have used pre-rebase dollarSeconds
        // (larger span => higher share for late depositors). Post-rebase, LP_A's share
        // shrinks; LP_B's grows. The pool-level cap protects I1 but LP_B may be shorted.
        // Report values for analysis (no assertion on fairness — only I1 is the safety check).
        emit log_named_uint("LP_A first claim",      lpAClaim1);
        emit log_named_uint("LP_B claim",            lpBClaim);
        emit log_named_uint("total yield collected", totalYieldCollected);
        emit log_named_uint("total yield claimed",   totalYieldClaimed);
    }

    // ── C3a: Waterfall covers exactly all obligations → immediate close ────────
    //
    // Attack: Engineer reservedYield + protocolFees to exactly cover outstanding
    // shortfall. Boundary: does the contract close cleanly and does I1 hold?

    function testC3a_waterfall_exactCoverage_immediateClose() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);

        // Draw 100k, repay on day 28 (23 penalty days).
        // Finance charge = 100k*(10*utilRate + 23*penRate)/WAD >> yieldOwed.
        // Excess above yieldOwed parks in reservedYield.
        _draw(p, keccak256("d1"), 100_000, 7);
        vm.warp(LOCK_TS + 28 * D);
        _repay(p, keccak256("d1"));

        uint256 rv = p.reservedYield();
        assertGt(rv, 0, "must have reservedYield after large-penalty repay");
        _assertI1(p, "I1 after first repay");

        // Second draw: small amount deliberately chosen to be less than reservedYield
        // so the waterfall can cover it and close immediately.
        _draw(p, keccak256("d2"), 1_000, 1);
        uint256 outstanding = p.outstanding();
        assertLe(outstanding, rv,
            "setup: reservedYield must exceed outstanding for immediate-close test");
        _assertI1(p, "I1 after second draw");

        // At maturity: waterfall has reservedYield >> outstanding → closes immediately
        vm.warp(MATURITY);
        vm.prank(AGENT2); p.declareDefault();
        _assertI1(p, "I1 after declareDefault");

        // Waterfall covered the small outstanding → Closed, no terminal split
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "waterfall must close pool immediately when float covers all obligations");
        assertEq(p.collectedBonus(), 0, "no bonus on default-path close");
        // Any leftover reservedYield ended up in protocolFees
        assertEq(p.reservedYield(), 0, "reservedYield must be zero after waterfall");
    }

    // ── C3b: Waterfall one unit short → Default; then exact top-up → close ────
    //
    // Verifies the off-by-one boundary: 1-unit shortfall must enter Default;
    // exact settlement closes; I1 holds throughout.

    function testC3b_waterfall_oneUnitShort_thenExactTopup() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);
        _draw(p, keccak256("d1"), 100_000, 1);  // full draw, 1 settlement day

        // No repayment → collectedYield=0 at default; waterfall has only idle fees
        // available (idle=0 since full draw). So waterfall is empty → Default guaranteed.
        vm.warp(MATURITY + 1 * D);
        vm.prank(AGENT2); p.declareDefault();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default),
            "must enter Default with zero float and full outstanding");
        _assertI1(p, "I1 entering Default");

        // Verify buckets: nothing was filled by waterfall
        assertEq(p.reservedYield(), 0, "reservedYield must be 0 after empty waterfall");
        // outstanding may be reduced only if there was waterfall amt > 0
        // With no reservedYield and no protocolFees, amt=0; outstanding unchanged.
        assertGt(p.outstanding(), 0, "outstanding must remain positive");
        assertEq(p.collectedBonus(), 0, "no bonus on default path");

        // Now settle: first principal, then yield. Verify I1 at each step.
        uint256 pShort = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        usdc.mint(MULTISIG, pShort);
        vm.prank(MULTISIG); usdc.approve(address(p), pShort);
        vm.prank(MULTISIG); p.settleDefaultPrincipal(pShort);
        _assertI1(p, "I1 after principal settle");
        assertLe(p.outstanding(), 0 + 1, "outstanding must be zero (or dust) after full settle");

        uint256 yShort  = p.yieldOwed() > p.collectedYield()
            ? p.yieldOwed() - p.collectedYield() : 0;
        uint256 ovShort = p.overrunYield() > p.collectedOverrunYield()
            ? p.overrunYield() - p.collectedOverrunYield() : 0;
        uint256 totalY  = yShort + ovShort;
        if (totalY > 0) {
            usdc.mint(MULTISIG, totalY);
            vm.prank(MULTISIG); usdc.approve(address(p), totalY);
            vm.prank(MULTISIG); p.settleDefaultYield(totalY);
        }
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "must close after full settlement");
        _assertI1(p, "I1 at Closed after settlement");
    }

    // ── C3c: Verify collectedPrincipal never exceeds principal via waterfall ───
    //
    // Attack: Can the waterfall's toPrincipal step push collectedPrincipal past
    // principal (over-crediting)?

    function testC3c_waterfall_cannotOvercreditPrincipal() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);

        // Partial draw: 50k outstanding, 50k idle
        _draw(p, keccak256("d1"), 50_000, 7);

        // Large repayment before maturity: fills yieldOwed, parks large surplus in reservedYield
        vm.warp(LOCK_TS + 25 * D);
        _repay(p, keccak256("d1"));
        // reservedYield should be very large (surplus finance charge)
        uint256 rv = p.reservedYield();
        assertGt(rv, 0, "must have reservedYield");
        _assertI1(p, "I1 after repay");

        // No outstanding draw now; declare default at maturity
        vm.warp(MATURITY);
        vm.prank(AGENT2); p.declareDefault();

        // KEY assertion: collectedPrincipal must never exceed principal
        assertLe(p.collectedPrincipal(), p.principal(),
            "collectedPrincipal must never exceed principal after waterfall");
        // outstanding must be >= 0 (underflow would revert in Solidity)
        assertLe(p.outstanding(), p.principal(),
            "outstanding must not underflow");
        _assertI1(p, "I1 after declareDefault: no over-credit");
    }

    // ── C4a: Reserve empty — settleDefaultPrincipal(0) is a no-op ────────────
    //
    // Attack: With empty reserve, calling settleDefaultPrincipal(0) (relying
    // entirely on reserve) must leave state unchanged.

    function testC4a_emptyReserve_settle_isNoop() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);
        _draw(p, keccak256("d1"), 80_000, 1);

        vm.warp(MATURITY + 1 * D);
        vm.prank(AGENT2); p.declareDefault();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default));

        // Reserve should be empty (no prior topUp)
        assertEq(treasury.reserveBalance(), 0, "reserve must start empty");

        uint256 cpBefore = p.collectedPrincipal();
        uint256 outBefore = p.outstanding();
        uint256 poolBal   = usdc.balanceOf(address(p));

        // settleDefaultPrincipal(0) with empty reserve: fromAmount=0, fromReserve=0, paid=0 → return
        vm.prank(MULTISIG); p.settleDefaultPrincipal(0);

        assertEq(p.collectedPrincipal(), cpBefore,   "collectedPrincipal must be unchanged");
        assertEq(p.outstanding(),        outBefore,  "outstanding must be unchanged");
        assertEq(usdc.balanceOf(address(p)), poolBal, "pool USDC must be unchanged");
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default), "still in Default");
        _assertI1(p, "I1 after no-op settle");
    }

    // ── C4b: Reserve draws without double-crediting ───────────────────────────
    //
    // Funds the reserve via a prior pool's normal close (the only way to topUp
    // in tests), then verifies that a default-pool draw from the reserve is
    // one-for-one: exactly drawn, no double-count.

    function testC4b_reserveDraw_singleCredit() public {
        // Fund the reserve: run a pool to normal close so _settleTerminalSplit topUps
        PoolContract pa = _newPool();
        _deposit(pa, LP_A, 500_000);
        _lock(pa);
        // Full draw, repay with large finance charge to generate protocolFees
        _draw(pa, keccak256("da"), 500_000, 7);
        vm.warp(LOCK_TS + 25 * D);  // large penalty charge
        _repay(pa, keccak256("da"));
        vm.warp(MATURITY);
        _payIdle(pa);
        // Pool should close; _settleTerminalSplit should topUp reserve
        assertEq(uint8(pa.status()), uint8(PoolContract.Status.Closed),
            "first pool must close for reserve to be funded");

        uint256 reserveBefore = treasury.reserveBalance();
        emit log_named_uint("reserve after first pool close", reserveBefore);

        // Second pool: goes to default; draw from reserve.
        // Create pb, deposit, let funding period expire, then lock and draw.
        uint256 pbCreateTs = block.timestamp;  // current time after first pool closed
        PoolContract pb = _newPool();
        _deposit(pb, LP_B, 100_000);

        // Finalize within the 6-hour buffer window (v2: must be <= fMaturityTs + bufferSecs).
        vm.warp(pb.fMaturityTs() + 60);   // 60s into buffer (buffer = 0.25d = 21600s)
        pb.finalizeFunding();  // locks pb now

        vm.prank(AGENT2); pb.executeDrawdown(keccak256("db"), PSP, 80_000 * SCALE, 1);

        uint256 pbMaturity = pb.poolFinalityTs();
        vm.warp(pbMaturity + 1 * D);
        vm.prank(AGENT2); pb.declareDefault();

        // Pool may or may not close immediately; settle and verify reserve draw
        uint256 pShort = pb.principal() > pb.collectedPrincipal()
            ? pb.principal() - pb.collectedPrincipal() : 0;

        if (pShort > 0 && treasury.reserveBalance() > 0) {
            uint256 reserveMid = treasury.reserveBalance();
            uint256 pbBalBefore = usdc.balanceOf(address(pb));

            // settleDefaultPrincipal(0): rely entirely on reserve
            vm.prank(MULTISIG); pb.settleDefaultPrincipal(0);

            uint256 drawn = reserveMid - treasury.reserveBalance();
            uint256 received = usdc.balanceOf(address(pb)) - pbBalBefore;

            // Reserve draw must be one-for-one: exactly what was drawn was received
            assertEq(drawn, received, "reserve draw must be one-for-one, no double-credit");
            assertLe(pb.collectedPrincipal(), pb.principal(),
                "collectedPrincipal must not exceed principal after reserve draw");
            _assertI1(pb, "I1 after reserve draw in default pool");
        }
    }

    // ── C5: Two-clock consistency — overrunYield and idle penalty simultaneously
    //
    // This is the case the prior adversarial pass explicitly did NOT exercise:
    // principal left outstanding through the penalty window so that
    //   overrunYield  (per-second, on outstanding, LP-side) and
    //   accIdleFees   (on availableToDd, PSP-side) and
    //   accPenalty    (on accIdleFees, PSP-side)
    // all accumulate at the same time.
    //
    // Invariants to verify:
    //   1. overrunYield accumulates ONLY on outstanding.
    //   2. accIdleFees accumulates ONLY on availableToDd (capped at maturity).
    //   3. accPenalty accumulates ONLY on accIdleFees (from maturity+grace).
    //   4. Neither corrupts the other.
    //   5. I1 holds throughout.
    //   6. After PSP pays idle+penalty and repays draw, pool closes correctly.

    function testC5_twoClock_overrunAndIdlePenalty_simultaneously() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 200_000);
        _lock(p);

        // Draw HALF the pool (100k outstanding, 100k idle)
        _draw(p, keccak256("d1"), 100_000, 1);

        assertEq(p.availableToDd(), 100_000 * SCALE, "100k idle");
        assertEq(p.outstanding(),   100_000 * SCALE, "100k outstanding");

        // Jump to maturity + grace + 10D: both clocks now running
        uint256 postPenaltyTs = MATURITY + PGD * D + 10 * D;
        vm.warp(postPenaltyTs);

        // Trigger accruals (any function with _accrueIdleFees + _accrueExtensionYield)
        // Use claimYield as trigger (it also calls _mature which moves idle to collectedPrincipal)
        vm.prank(LP_A); p.claimYield();

        // Both clocks must have fired
        assertGt(p.overrunYield(), 0,
            "overrunYield must be positive past maturity with outstanding draw");
        assertGt(p.accIdleFees(), 0,
            "accIdleFees must be positive (idle capital up to maturity)");
        assertGt(p.accPenalty(), 0,
            "accPenalty must be positive (past grace period)");
        _assertI1(p, "I1 with both clocks live");

        // Clock independence: overrunYield must NOT include idle capital rate
        // overrunYield = outstanding * elapsed_secs * APR / (WAD * YEAR)
        //   where elapsed = from poolFinalityTs (= MATURITY, set as lastOverrunTs at lock)
        //   to postPenaltyTs = MATURITY + PGD*D + 10*D = MATURITY + 12*D
        // accIdleFees  = availableToDd_pre * idle_days * idleRate / WAD  (capped at maturity)
        // These are on disjoint bases; any cross-contamination would break the ratio.
        // overrun accrues maturity→now, no penalty-grace term; test advanced PGD+10D past
        // maturity (= 12D total elapsed), so elapsed = (PGD+10)*D is correct.
        uint256 expectedOverrun = MathLib.mulDiv(
            100_000 * SCALE * ((PGD + 10) * D),  // outstanding * full elapsed since maturity
            APR,
            WAD * YEAR
        );
        assertApproxEqAbs(p.overrunYield(), expectedOverrun, 2,
            "overrunYield must track ONLY outstanding * elapsed at APR");

        // Pay idle fees (PSP discharges accIdleFees + accPenalty)
        _payIdle(p);
        _assertI1(p, "I1 after idle fee payment");
        assertEq(p.accIdleFees(), 0, "accIdleFees must clear after payment");
        assertEq(p.accPenalty(),  0, "accPenalty must clear after payment");

        // overrunYield must be unchanged by idle fee payment (independent clock)
        uint256 overrunAfterIdle = p.overrunYield();
        assertGt(overrunAfterIdle, 0,
            "overrunYield must persist after idle fee payment");
        _assertI1(p, "I1 after idle: overrun still live");

        // PSP repays draw (with finance charge)
        _repay(p, keccak256("d1"));
        _assertI1(p, "I1 after repay");

        // Pool should now close (accIdleFees=0, accPenalty=0, all obligations met)
        // _mature is called inside repay; check finality
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "pool must close after PSP repays and idle fees cleared");

        // Terminal: LP claims overrun yield
        vm.prank(LP_A); p.claimYield();
        _assertI1(p, "I1 after LP claims overrun yield at close");

        // Conservation: LP received everything
        assertEq(p.claimedYield() + p.claimedOverrunYield(), p.collectedYield() + p.collectedOverrunYield(),
            "sole LP must receive all collected yield+overrun");
    }

    // ── C6a: declareDefault twice — second call reverts ───────────────────────

    function testC6a_declareDefault_twice_reverts() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);
        _draw(p, keccak256("d1"), 80_000, 1);

        vm.warp(MATURITY + 1 * D);
        vm.prank(AGENT2); p.declareDefault();
        // Pool is now Default or Closed

        // Second declareDefault must revert regardless of which state
        vm.expectRevert("Pool: not active");
        vm.prank(AGENT2); p.declareDefault();
    }

    // ── C6b: sweepProtocolFees twice — second sweep is a no-op ───────────────

    function testC6b_sweepProtocolFees_twice_noDoublePayment() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 200_000);
        _lock(p);
        _draw(p, keccak256("d1"), 200_000, 7);
        vm.warp(LOCK_TS + 25 * D);
        _repay(p, keccak256("d1"));
        vm.warp(MATURITY);
        _payIdle(p);
        require(uint8(p.status()) == uint8(PoolContract.Status.Closed), "setup: need Closed pool");
        require(p.protocolFees() > 0, "setup: need positive protocolFees");

        uint256 pf = p.protocolFees();
        uint256 imBefore = treasury.imFeesBalance();

        vm.prank(MULTISIG); p.sweepProtocolFees();
        assertEq(p.protocolFees(), 0,           "fees must clear after first sweep");
        assertEq(treasury.imFeesBalance(), imBefore + pf, "treasury must receive fees");
        _assertI1(p, "I1 after first sweep");

        // Second sweep: protocolFees=0 → require(amount > 0) reverts "Pool: nothing to sweep".
        // Known intended difference from pseudocode (sweep_protocol_fees silently returns on
        // amount<=0); Solidity reverts instead — louder replay protection, economically identical.
        vm.expectRevert("Pool: nothing to sweep");
        vm.prank(MULTISIG); p.sweepProtocolFees();
    }

    // ── C6c: settleDefaultPrincipal with owed=0 → _resolveDefaultIfWhole ─────
    //
    // Attack: Call settleDefaultPrincipal(0) when principal is already fully
    // settled. This routes to _resolveDefaultIfWhole.  Verify it doesn't
    // spuriously close the pool if yield is still owed.

    function testC6c_settleDefaultPrincipal_owedZero_doesntSpuriouslyClose() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);
        _draw(p, keccak256("d1"), 80_000, 1);

        vm.warp(MATURITY + 1 * D);
        vm.prank(AGENT2); p.declareDefault();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default));

        // Settle principal exactly
        uint256 pShort = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        if (pShort > 0) {
            usdc.mint(MULTISIG, pShort);
            vm.prank(MULTISIG); usdc.approve(address(p), pShort);
            vm.prank(MULTISIG); p.settleDefaultPrincipal(pShort);
        }
        _assertI1(p, "I1 after principal settled");

        // Yield may still be short — pool must stay in Default
        bool yieldShort = p.yieldOwed() > p.collectedYield()
                         || p.overrunYield() > p.collectedOverrunYield();

        if (yieldShort) {
            assertEq(uint8(p.status()), uint8(PoolContract.Status.Default),
                "must stay Default while yield is short");

            // Now call settleDefaultPrincipal(0) again: owed=0 → _resolveDefaultIfWhole
            // Since yield still short, must NOT close
            vm.prank(MULTISIG); p.settleDefaultPrincipal(0);
            assertEq(uint8(p.status()), uint8(PoolContract.Status.Default),
                "_resolveDefaultIfWhole must not close when yield is still owed");
            _assertI1(p, "I1: _resolveDefaultIfWhole no-close");
        }
    }

    // ── C6d: finalizeFunding replay — second call is a safe no-op ────────────
    //
    // finalizeFunding() → _triggerFinalizeFunding() → if(status==Funding && ...) only.
    // On an Active pool status!=Funding so the call silently does nothing.
    // No revert, no state mutation — idempotent by construction.

    function testC6d_finalizeFunding_onActive_isNoop() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);  // first finalizeFunding → pool is Active

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Active));
        uint256 principal0 = p.principal();
        uint256 poolBal0   = usdc.balanceOf(address(p));

        // Second call: status!=Funding → inner if-guard skips → no state change
        p.finalizeFunding();

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Active), "status must stay Active");
        assertEq(p.principal(), principal0, "principal must be unchanged");
        assertEq(usdc.balanceOf(address(p)), poolBal0, "pool USDC must be unchanged");
        _assertI1(p, "I1: finalizeFunding replay is a no-op on Active pool");
    }

    // ── C6e: settleDefaultYield replay — owed=0 → _resolveDefaultIfWhole ─────
    //
    // After settling yield fully, calling settleDefaultYield again must not
    // double-credit or spuriously change state.

    function testC6e_settleDefaultYield_doubleCall_noop() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);
        _draw(p, keccak256("d1"), 80_000, 1);

        vm.warp(MATURITY + 1 * D);
        vm.prank(AGENT2); p.declareDefault();

        // Settle principal
        uint256 pShort = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        if (pShort > 0) {
            usdc.mint(MULTISIG, pShort);
            vm.prank(MULTISIG); usdc.approve(address(p), pShort);
            vm.prank(MULTISIG); p.settleDefaultPrincipal(pShort);
        }

        // Settle yield fully
        uint256 yShort  = p.yieldOwed() > p.collectedYield()
            ? p.yieldOwed() - p.collectedYield() : 0;
        uint256 ovShort = p.overrunYield() > p.collectedOverrunYield()
            ? p.overrunYield() - p.collectedOverrunYield() : 0;
        uint256 totalY  = yShort + ovShort;
        if (totalY > 0) {
            usdc.mint(MULTISIG, totalY);
            vm.prank(MULTISIG); usdc.approve(address(p), totalY);
            vm.prank(MULTISIG); p.settleDefaultYield(totalY);
        }
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed), "must be Closed");
        _assertI1(p, "I1 at close");

        // Attempt second settleDefaultYield: must revert (status != Default)
        vm.expectRevert("Pool: not default");
        vm.prank(MULTISIG); p.settleDefaultYield(0);
    }

    // ── C6f: Outstanding underflow guard — settleDefaultPrincipal cannot push
    //         outstanding below zero under any partial-payment sequence ─────────

    function testC6f_settleDefaultPrincipal_noOutstandingUnderflow() public {
        PoolContract p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);
        _draw(p, keccak256("d1"), 80_000, 1);

        vm.warp(MATURITY + 1 * D);
        vm.prank(AGENT2); p.declareDefault();

        // Record outstanding at default entry
        uint256 outAtDefault = p.outstanding();
        assertGt(outAtDefault, 0, "outstanding must be positive at default");

        // Settle in three arbitrary partial amounts
        uint256 owed = p.principal() > p.collectedPrincipal()
            ? p.principal() - p.collectedPrincipal() : 0;
        uint256 chunk1 = owed / 3;
        uint256 chunk2 = owed / 3;
        uint256 chunk3 = owed - chunk1 - chunk2;  // remainder (may be larger by 1)

        for (uint256 i = 0; i < 3; i++) {
            uint256 chunk = i == 0 ? chunk1 : (i == 1 ? chunk2 : chunk3);
            if (chunk == 0) continue;
            usdc.mint(MULTISIG, chunk);
            vm.prank(MULTISIG); usdc.approve(address(p), chunk);
            vm.prank(MULTISIG); p.settleDefaultPrincipal(chunk);
            // outstanding must never be > outAtDefault and must stay representable
            assertLe(p.outstanding(), outAtDefault, "outstanding must decrease monotonically");
            _assertI1(p, "I1 after partial settle");
        }

        // After three chunks: outstanding must be 0 (fully settled)
        assertEq(p.outstanding(), 0, "outstanding must be 0 after full multi-step settlement");
    }

    // ── C3d/e/f: Waterfall flip ±1-unit boundary ─────────────────────────────
    //
    // Common setup: deposit 100k, lock, draw 100k, repay at day 28.
    //
    // Finance charge (exact integer arithmetic):
    //   stdDays = max(minDdDays=1, min(daysTotal=29, penaltyStart=7)) = 7
    //   penDays = 29 - 7 = 22
    //   financeCharge = mulDiv(100k*SCALE, 7*UTIL_RATE + 22*PEN_RATE, WAD)
    //                 = mulDiv(1e17, 7*5e14 + 22*1e15, 1e18) = 2550000000000000
    //
    // yieldOwed (set at lock, unchanged at post-maturity default):
    //   dollarSeconds = 100k*SCALE * (LOCK_TS + TENURE*D) = 1e17 * 35 * D
    //   yieldOwed = mulDiv(dollarSeconds, APR, WAD*YEAR) = 958904109589041  (70/73 * 1e15, floor)
    //
    // _allocate(financeCharge) pre-maturity:
    //   toYield = min(2550000000000000, 958904109589041) = 958904109589041  (fills yield gap)
    //   reservedYield R = 2550000000000000 - 958904109589041 = 1591095890410959
    //
    // At declareDefault(MATURITY), overrunYield = 0 (t <= maturityTs, _accrueExtensionYield no-ops).
    // Waterfall: amt = R, toBase = 0, toOverrun = 0, toPrincipal = min(X, R).
    // collectedPrincipal = (principal - X) + min(X, R).
    //
    // Close condition — Solidity (src/PoolContract.sol:638-640):
    //   if (collectedYield >= yieldOwed && collectedOverrunYield >= overrunYield && collectedPrincipal >= principal)
    // Pseudocode (reference/tests/pool_calendar.py:661-662):
    //   if (pool["collected_yield"] >= pool["yield"] and pool["collected_overrun_yield"] >= pool["overrun_yield"]
    //       and pool["collected_principal"] >= pool["principal"]):
    // Both use >= (not >): exact equality (X == R) triggers close; X == R+1 misses by one unit.
    //
    // Three scenarios differ ONLY in the second draw amount (X = R, R+1, R-1):
    //   X == R:     (principal-R)+R    = principal  → close, protocolFees = 0
    //   X == R+1:   (principal-R-1)+R  = principal-1 → Default, outstanding = 1
    //   X == R-1:   (principal-R+1)+(R-1) = principal  → close, protocolFees = 1

    /// Shared base: deposit 100k, lock, draw 100k, repay at day 28.
    /// Returns pool and R = reservedYield (the waterfall float) after the repay.
    /// Caller issues the second draw then warps to MATURITY.
    function _setupBoundaryBase() internal returns (PoolContract p, uint256 R) {
        p = _newPool();
        _deposit(p, LP_A, 100_000);
        _lock(p);
        _draw(p, keccak256("d1"), 100_000, 7);
        vm.warp(LOCK_TS + 28 * D);
        _repay(p, keccak256("d1"));
        R = p.reservedYield();
        assertGt(R, 1,      "R must be >1 for unit boundary test");
        assertEq(p.collectedYield(), p.yieldOwed(), "collectedYield must equal yieldOwed: yield gap closed");
        _assertI1(p, "I1 at boundary base");
    }

    function _newPoolHighSoftCap() internal returns (PoolContract p) {
        vm.prank(DEPLOYER);
        address addr = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:         PSP,
            fundingDurationSecs: 5 * 86400,
            softCap:           10_000 * SCALE,
            hardCap:           9_000_000 * SCALE,
            tenure:            TENURE,
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

    // ── C7: Post-Unsuccessful funding-credit underflow regression ─────────────
    //
    // Bug: _lpCheckpoint accumulated pos.fundingCredit past the Unsuccessful
    // transition time T1, while pool-level fundingCredit was frozen at T1 by
    // _globalCheckpoint in _finalizeFunding().  Any LP whose pos.lastUpdate
    // predated T1 could produce forfeited > fundingCredit, causing
    // fundingCredit -= forfeited to Panic(0x11) on the next withdraw.
    //
    // Fix: _lpCheckpoint caps effectiveTs at lastUpdate when status == Unsuccessful.
    // This is lazy-sync: we cannot eagerly sync all LPs at finalize (mappings are
    // non-enumerable), so each LP is capped on their next access.
    //
    // Conservation proof: fundingCredit (global) was filled to principal*(T1-t0).
    // Each LP's credit is capped at pos.principal*(T1-pos.lastUpdate), so
    // sum(pos.fundingCredit) <= fundingCredit at all times.  After every LP
    // withdraws their full principal, both sides drain to exactly 0.

    // ── C7a: Partial-withdraw → Unsuccessful → warp → final withdraw ──────────
    //   Minimal 5-step reproducer for the panic path.  Assert no revert, full
    //   principal returned, cash-conservation (I1) holds throughout.

    function testC7a_unsuccessful_withdraw_post_transition_noUnderflow() public {
        PoolContract p = _newPoolHighSoftCap(); // softCap=10_000 SCALE >> deposit
        _deposit(p, LP_A, 100);                 // 100*SCALE at t=0
        assertEq(p.principal(), 100 * SCALE, "principal after deposit");

        // Partial withdraw at t=0 — pos_A.lastUpdate stays 0
        vm.prank(LP_A); p.withdraw(40 * SCALE);
        assertEq(p.principal(), 60 * SCALE, "principal after partial withdraw");
        _assertI1(p, "I1 after partial withdraw");

        // finalizeFunding at T1=LOCK_TS: _globalCheckpoint syncs fundingCredit to T1
        vm.warp(LOCK_TS);
        p.finalizeFunding();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Unsuccessful), "Unsuccessful");
        assertEq(p.lastUpdate(), LOCK_TS, "lastUpdate == fMaturityTs at transition");
        _assertI1(p, "I1 after Unsuccessful transition");

        // Warp well past T1 — without the fix, the next withdraw would panic
        vm.warp(MATURITY);

        // LP_A withdraws remaining 60*SCALE — must NOT revert
        uint256 lpBefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.withdraw(60 * SCALE);
        assertEq(usdc.balanceOf(LP_A) - lpBefore, 60 * SCALE, "LP_A recovered full remaining principal");

        assertEq(p.principal(),     0, "pool principal drained to 0");
        assertEq(p.fundingCredit(), 0, "fundingCredit drained to 0 (conservation)");
        assertEq(usdc.balanceOf(address(p)), 0, "pool USDC fully drained");
        _assertI1(p, "I1: Unsuccessful full recovery");
    }

    // ── C7b: Multi-LP — funding-credit conservation across staggered deposits ─
    //   LP_A deposits at t=0, LP_B at t=1D, LP_A partial-withdraws at t=2D.
    //   After Unsuccessful at T1=LOCK_TS, both LPs withdraw at MATURITY.
    //   Assert: fundingCredit reaches 0 when all principals are recovered, and
    //   I1 holds at every step.

    function testC7b_unsuccessful_multi_lp_funding_credit_conservation() public {
        PoolContract p = _newPoolHighSoftCap();

        // Staggered deposits — each LP gets a different pos.lastUpdate
        _deposit(p, LP_A, 100);          // t=0: pos_A.lastUpdate=0
        vm.warp(1 * D);
        _deposit(p, LP_B, 200);          // t=1D: pos_B.lastUpdate=1D
        _assertI1(p, "I1 after deposits");

        // LP_A partial withdraw at t=2D
        vm.warp(2 * D);
        vm.prank(LP_A); p.withdraw(40 * SCALE);
        _assertI1(p, "I1 after LP_A partial withdraw");

        // finalizeFunding at T1=LOCK_TS
        vm.warp(LOCK_TS);
        p.finalizeFunding();
        assertEq(uint8(p.status()), uint8(PoolContract.Status.Unsuccessful), "Unsuccessful");
        uint256 fc = p.fundingCredit();
        assertGt(fc, 0, "fundingCredit > 0 at transition");
        _assertI1(p, "I1 at Unsuccessful transition");

        // Warp to MATURITY — both LPs withdraw their remaining principals
        vm.warp(MATURITY);

        uint256 lpABefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); p.withdraw(60 * SCALE);
        assertEq(usdc.balanceOf(LP_A) - lpABefore, 60 * SCALE, "LP_A recovered 60 SCALE");
        assertGe(p.fundingCredit(), 0,   "fundingCredit non-negative after LP_A withdraw");
        _assertI1(p, "I1 after LP_A final withdraw");

        uint256 lpBBefore = usdc.balanceOf(LP_B);
        vm.prank(LP_B); p.withdraw(200 * SCALE);
        assertEq(usdc.balanceOf(LP_B) - lpBBefore, 200 * SCALE, "LP_B recovered 200 SCALE");

        // Both LPs fully out: fund credit must drain to 0 (conservation)
        assertEq(p.principal(),     0, "pool principal 0 after all withdraws");
        assertEq(p.fundingCredit(), 0, "fundingCredit 0: sum(LP credits) == global");
        assertEq(usdc.balanceOf(address(p)), 0, "pool USDC 0: full recovery");
        _assertI1(p, "I1: all LPs recovered, conservation holds");
    }

    // ── C3d: Exact coverage — waterfall float == obligation → immediate close ─
    //   draw X = R: toPrincipal = R, outstanding = 0, protocolFees = 0 → Closed

    function testC3d_waterfall_boundary_exact() public {
        (PoolContract p, uint256 R) = _setupBoundaryBase();
        _drawRaw(p, keccak256("d2"), R, 1);
        _assertI1(p, "I1 after exact draw");

        vm.warp(MATURITY);
        vm.prank(AGENT2); p.declareDefault();

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "exact coverage: pool must close immediately (>= fires at equality)");
        assertEq(p.outstanding(), 0,
            "outstanding must be 0: waterfall covered exactly");
        assertEq(p.collectedPrincipal(), p.principal(),
            "collectedPrincipal must equal principal exactly (not over)");
        assertEq(p.protocolFees(), 0,
            "no residue: waterfall consumed R exactly, 0 left");
        assertLe(p.collectedYield(),        p.yieldOwed(),    "collectedYield must not exceed yieldOwed");
        assertLe(p.collectedOverrunYield(), p.overrunYield(), "collectedOverrunYield must not exceed overrunYield");
        assertLe(p.collectedPrincipal(),    p.principal(),     "collectedPrincipal must not exceed principal");
        _assertI1(p, "I1: exact boundary close");
    }

    // ── C3e: One unit short — waterfall float == obligation − 1 → Default ─────
    //   draw X = R+1: toPrincipal = R, outstanding = 1, collectedPrincipal = principal-1 → Default

    function testC3e_waterfall_boundary_oneShort() public {
        (PoolContract p, uint256 R) = _setupBoundaryBase();
        _drawRaw(p, keccak256("d2"), R + 1, 1);
        _assertI1(p, "I1 after 1-short draw");

        vm.warp(MATURITY);
        vm.prank(AGENT2); p.declareDefault();

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Default),
            "1-unit short: pool must enter Default (>= fails by exactly 1)");
        assertEq(p.outstanding(), 1,
            "exactly 1 unit of outstanding remains: waterfall exhausted R, 1 short");
        assertEq(p.collectedPrincipal(), p.principal() - 1,
            "collectedPrincipal exactly 1 unit short of principal");
        assertEq(p.protocolFees(), 0,
            "waterfall fully consumed: no residue (all R used, 1 short)");
        _assertI1(p, "I1: 1-unit-short Default");
    }

    // ── C3f: One unit over — waterfall float == obligation + 1 → close + 1-unit residue
    //   draw X = R-1: toPrincipal = R-1, outstanding = 0, protocolFees = 1 → Closed

    function testC3f_waterfall_boundary_oneOver() public {
        (PoolContract p, uint256 R) = _setupBoundaryBase();
        _drawRaw(p, keccak256("d2"), R - 1, 1);
        _assertI1(p, "I1 after 1-over draw");

        vm.warp(MATURITY);
        vm.prank(AGENT2); p.declareDefault();

        assertEq(uint8(p.status()), uint8(PoolContract.Status.Closed),
            "1-unit over: pool must close (surplus clears all obligations)");
        assertEq(p.outstanding(), 0,
            "outstanding must be 0: obligation fully covered");
        assertEq(p.collectedPrincipal(), p.principal(),
            "collectedPrincipal must equal principal exactly: no over-credit");
        assertEq(p.protocolFees(), 1,
            "exactly 1 unit must land in protocolFees as residue: no unit lost or duplicated");
        assertLe(p.collectedYield(),        p.yieldOwed(),    "collectedYield must not exceed yieldOwed");
        assertLe(p.collectedOverrunYield(), p.overrunYield(), "collectedOverrunYield must not exceed overrunYield");
        assertLe(p.collectedPrincipal(),    p.principal(),     "collectedPrincipal must not exceed principal");
        _assertI1(p, "I1: 1-unit-over close, residue conserved in protocolFees");
    }
}
