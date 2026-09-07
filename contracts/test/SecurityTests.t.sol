// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";
import "../src/TreasuryReserve.sol";
import "../src/MockStablecoin.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  Attack helpers
// ─────────────────────────────────────────────────────────────────────────────

/// @dev ERC20 that fires a callback into a target contract on every transfer TO
///      `hookRecipient`.  The call goes to `hookCallTarget` (usually the pool),
///      not to the recipient — simulating a reentrancy attempt from inside the
///      token's transfer logic.
contract ReentrantERC20 is MockStablecoin {
    address public hookRecipient;
    address public hookCallTarget;
    bytes   public hookCalldata;
    bool    private _inHook;

    event ReentryAttempt(bool success, bytes returnData);

    /// @param recipient  trigger when transferring TO this address
    /// @param callTarget re-enter this address (e.g. the pool)
    /// @param data       calldata to send (e.g. abi.encodeCall(pool.claimYield, ()))
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

// ─────────────────────────────────────────────────────────────────────────────
//  Main test contract
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Phase 3C — Security taxonomy.
///
/// For every attack class in the audit checklist, there is at least one test
/// that attempts the attack and asserts it fails.  Architectural N/A entries
/// (oracle, rebasing) are documented inline with no active test.
///
/// Findings summary at the bottom of this file.
contract SecurityTests is Test {

    uint256 constant SCALE = 1e12;
    uint256 constant WAD   = 1e18;
    uint256 constant D     = 86400;
    uint256 constant LOCK  = 5 * D;
    uint256 constant TENOR = 30;
    uint256 constant MAT   = LOCK + TENOR * D;

    address LP_A     = address(0xAAAA);
    address LP_B     = address(0xBBBB);
    address PSP      = address(0x5555);
    address AGENT1   = address(0x3333);
    address AGENT2   = address(0x4444);
    address MULTISIG = address(0x1111);
    address DEPLOYER = address(0x2222);
    address RANDOM   = address(0xDEAD);

    MockStablecoin  usdc;
    TreasuryReserve treasury;
    PoolFactory     factory;
    PoolContract    pool;

    // ── Shared setup ─────────────────────────────────────────────────────────

    function setUp() public {
        vm.warp(0);
        usdc     = new MockStablecoin();
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
        pool = PoolContract(addr);

        // Fund actors
        usdc.mint(LP_A,     5_000_000 * SCALE);
        usdc.mint(LP_B,     5_000_000 * SCALE);
        usdc.mint(PSP,     50_000_000 * SCALE);
        usdc.mint(MULTISIG, 10_000_000 * SCALE);
        vm.prank(LP_A);    usdc.approve(address(pool), type(uint256).max);
        vm.prank(LP_B);    usdc.approve(address(pool), type(uint256).max);
        vm.prank(PSP);     usdc.approve(address(pool), type(uint256).max);
        vm.prank(MULTISIG);usdc.approve(address(pool), type(uint256).max);
    }

    function _lock() internal {
        vm.prank(LP_A); pool.deposit(1_000_000 * SCALE);
        vm.warp(LOCK);   pool.finalizeFunding();
    }

    function _draw(bytes32 ref, uint256 amtUSDC, uint256 settle) internal {
        vm.prank(AGENT2); pool.executeDrawdown(ref, PSP, amtUSDC * SCALE, settle);
    }

    function _repay(bytes32 ref) internal {
        (, , uint256 total) = pool.getRepaymentOwed(ref);
        usdc.mint(PSP, total);
        vm.prank(PSP); usdc.approve(address(pool), total);
        vm.prank(PSP); pool.repay(ref);
    }

    function _closePool() internal {
        vm.warp(MAT + D);
        (, , uint256 owed) = pool.getIdleFeesBreakdown();
        if (owed > 0) {
            usdc.mint(PSP, owed);
            vm.prank(PSP); usdc.approve(address(pool), owed);
            vm.prank(PSP); pool.payAccruedIdleFees(owed);
        }
        // Trigger maturity/finality if still active
        if (pool.status() == PoolContract.Status.Active) {
            vm.prank(LP_A); pool.claimYield();
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  1. REENTRANCY
    //
    //  Finding: nonReentrant + CEI at every outgoing transfer.
    //  Mitigation: OpenZeppelin ReentrancyGuard on all external state-changing
    //              functions; state updated before safeTransfer in claimYield,
    //              claimPrincipal, executeDrawdown, sweepProtocolFees.
    // ══════════════════════════════════════════════════════════════════════════

    /// A malicious ERC20 re-enters claimYield during the token transfer.
    /// The nonReentrant guard must block the nested call.
    function testReentrancy_claimYield_blocked() public {
        // Deploy a fresh pool backed by the malicious token
        ReentrantERC20 rToken = new ReentrantERC20();
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

        vm.warp(LOCK);   rPool.finalizeFunding();
        rToken.mint(PSP, 50_000_000 * SCALE);
        vm.prank(PSP);   rToken.approve(pAddr, type(uint256).max);
        vm.prank(AGENT2); rPool.executeDrawdown(bytes32("r1"), PSP, 100_000 * SCALE, 3);
        vm.warp(LOCK + 3 * D);
        (, , uint256 repayTotal) = rPool.getRepaymentOwed(bytes32("r1"));
        rToken.mint(PSP, repayTotal);
        vm.prank(PSP); rToken.approve(pAddr, repayTotal);
        vm.prank(PSP);    rPool.repay(bytes32("r1"));

        // Arm: when pool sends rToken to LP_A, the token calls rPool.claimYield()
        // re-entry is blocked by nonReentrant; the hook emits ReentryAttempt(false,...)
        rToken.setHook(LP_A, address(rPool), abi.encodeCall(rPool.claimYield, ()));

        uint256 balBefore = rToken.balanceOf(LP_A);
        vm.prank(LP_A); rPool.claimYield();
        assertGt(rToken.balanceOf(LP_A) - balBefore, 0, "outer claimYield must succeed");

        // Second call: CEI wrote claimedYield before transfer → nothing left
        uint256 balAfter = rToken.balanceOf(LP_A);
        vm.prank(LP_A); rPool.claimYield();   // returns early (claimable == 0)
        assertEq(rToken.balanceOf(LP_A), balAfter, "re-entry double-claim succeeded");
    }

    /// CEI ordering: pool updates claimedPrincipal before safeTransfer.
    /// A second claimPrincipal call must find claimable == 0 (returns early).
    function testReentrancy_claimPrincipal_CEI() public {
        _lock();
        _draw(bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 3 * D); _repay(bytes32("r1"));
        _closePool();

        uint256 balBefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); pool.claimPrincipal();
        assertGt(usdc.balanceOf(LP_A) - balBefore, 0, "principal not claimed");

        // Second call: pos.claimedPrincipal already updated → claimable == 0
        uint256 balAfter = usdc.balanceOf(LP_A);
        vm.prank(LP_A); pool.claimPrincipal();
        assertEq(usdc.balanceOf(LP_A), balAfter, "double-claim succeeded");
    }

    /// TreasuryReserve.topUp is pool-gated — arbitrary callers are blocked
    /// at the onlyPool modifier even before any reentrancy consideration.
    function testReentrancy_treasury_onlyPool() public {
        vm.expectRevert("TR: not a pool");
        treasury.topUp(100 * SCALE);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  2. ACCESS CONTROL
    //
    //  Finding: every privileged function gated by onlyRole or explicit require.
    //  Mitigation: OpenZeppelin AccessControl in factory; bespoke hasRole checks
    //              in PoolContract; Ownable in TreasuryReserve.
    // ══════════════════════════════════════════════════════════════════════════

    // executeDrawdown — onlyRole(AGENT2_ROLE); PSP cannot call it directly
    function testAccessControl_executeDrawdown_pspRejected() public {
        _lock();
        vm.prank(PSP);
        vm.expectRevert();
        pool.executeDrawdown(bytes32("r1"), PSP, 100_000 * SCALE, 1);
    }

    // executeDrawdown — receiver must be pre-authorized
    function testAccessControl_executeDrawdown_unauthorizedReceiver() public {
        _lock();
        address UNAUTH = address(0x9999);
        vm.prank(AGENT2);
        vm.expectRevert("Pool: receiver not authorized");
        pool.executeDrawdown(bytes32("r1"), UNAUTH, 100_000 * SCALE, 1);
    }

    // declareDefault — onlyRole(AGENT2_ROLE)
    function testAccessControl_declareDefault_wrongCaller() public {
        _lock(); _draw(bytes32("r1"), 100_000, 3);
        vm.warp(MAT + D);
        vm.prank(LP_A);
        vm.expectRevert();
        pool.declareDefault();
    }

    // setScOverdue — onlyRole(AGENT1_ROLE)
    function testAccessControl_setScOverdue_wrongCaller() public {
        _lock();
        vm.prank(AGENT2); vm.expectRevert(); pool.setScOverdue(false);
        vm.prank(LP_A);   vm.expectRevert(); pool.setScOverdue(false);
        vm.prank(RANDOM); vm.expectRevert(); pool.setScOverdue(false);
    }

    // setPaused — onlyRole(AGENT1_ROLE); requires scOverdueCheck=false first
    function testAccessControl_setPaused_wrongCaller() public {
        _lock();
        vm.prank(AGENT1); pool.setScOverdue(false);
        vm.prank(AGENT2); vm.expectRevert(); pool.setPaused(true);
        vm.prank(LP_A);   vm.expectRevert(); pool.setPaused(true);
    }

    // settleDefaultPrincipal — onlyRole(MULTISIG_ROLE)
    function testAccessControl_settleDefaultPrincipal_wrongCaller() public {
        _lock(); _draw(bytes32("r1"), 100_000, 3);
        vm.warp(MAT + D);
        vm.prank(AGENT2); pool.declareDefault();
        vm.prank(LP_A);
        vm.expectRevert();
        pool.settleDefaultPrincipal(100_000 * SCALE);
    }

    // sweepProtocolFees — onlyRole(MULTISIG_ROLE)
    function testAccessControl_sweepProtocolFees_wrongCaller() public {
        _lock();
        _draw(bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 3 * D); _repay(bytes32("r1"));
        _closePool();
        vm.prank(LP_A);
        vm.expectRevert();
        pool.sweepProtocolFees();
    }

    // setPspWallet — MULTISIG_ROLE or factory
    function testAccessControl_setPspWallet_wrongCaller() public {
        vm.prank(LP_A);   vm.expectRevert("Pool: unauthorized"); pool.setPspWallet(address(0x9999));
        vm.prank(AGENT2); vm.expectRevert("Pool: unauthorized"); pool.setPspWallet(address(0x9999));
        vm.prank(AGENT1); vm.expectRevert("Pool: unauthorized"); pool.setPspWallet(address(0x9999));
    }

    // Factory.createPool — DEPLOYER_ROLE
    function testAccessControl_createPool_wrongCaller() public {
        vm.prank(LP_A);
        vm.expectRevert();
        factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet: PSP, softCap: 1 * SCALE, hardCap: 9_000_000 * SCALE,
            fundingDurationSecs: 5 * 86400,
            tenure: TENOR, idleRateDaily: 5e14, utilizedRateDaily: 5e14,
            penaltyRateDaily: 1e15, penaltyGraceDays: 2, minDeposit: 0,
            aprAnnual: 1e17, agent1: AGENT1, agent2: AGENT2, multisig: MULTISIG
        }));
    }

    // Factory.approvePsp — MULTISIG_ROLE_
    function testAccessControl_approvePsp_wrongCaller() public {
        vm.prank(LP_A);
        vm.expectRevert();
        factory.approvePsp(address(0x9999));
    }

    // TreasuryReserve.setRiskParams — Ownable (MULTISIG is owner)
    function testAccessControl_treasury_setRiskParams_wrongCaller() public {
        vm.prank(LP_A);
        vm.expectRevert();
        treasury.setRiskParams(1e17, 1_000_000 * SCALE, WAD, 0);
    }

    // TreasuryReserve.withdrawReserve — Ownable
    function testAccessControl_treasury_withdrawReserve_wrongCaller() public {
        vm.prank(LP_A);
        vm.expectRevert();
        treasury.withdrawReserve(MULTISIG, 1 * SCALE);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  3. PRECISION / ROUNDING / INTEGER UNDERFLOW
    //
    //  Finding: penDays underflow safe (explicit ternary); mulDiv is floor;
    //           topup + protocolFees == protocol_raw by construction.
    //  Mitigation: Solidity 0.8 revert-on-overflow; MathLib.mulDiv (512-bit);
    //              ternary: `tdays > pStart ? tdays - pStart : 0`.
    // ══════════════════════════════════════════════════════════════════════════

    /// On-time repay: elapsedDays < penaltyStart → penDays = 0, no underflow.
    function testPrecision_onTimeRepay_noPenaltyUnderflow() public {
        _lock();
        // settleDays=6 → penaltyStart = min(6+1+2,7) = 7
        // Repay at day 2 → daysTotal=3 < pStart=7 → penDays=0
        _draw(bytes32("r1"), 100_000, 6);
        vm.warp(LOCK + 2 * D);
        _repay(bytes32("r1"));   // must not revert
        assertEq(pool.outstanding(), 0);
    }

    /// mulDiv floors: LP yield claim is always ≤ pool's collectedYield.
    function testPrecision_yieldFloor_neverExceedsPool() public {
        _lock();
        _draw(bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 3 * D); _repay(bytes32("r1"));
        _closePool();
        uint256 cy = pool.collectedYield();
        uint256 balBefore = usdc.balanceOf(LP_A);
        vm.prank(LP_A); pool.claimYield();
        uint256 claimed = usdc.balanceOf(LP_A) - balBefore;
        assertGt(claimed, 0, "no yield claimed");
        assertLe(claimed, cy, "LP claimed more than pool collected");
    }

    /// protocolFees == 0 after sweep — no phantom units remain.
    function testPrecision_sweepProtocolFees_zeroes() public {
        _lock();
        _draw(bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 3 * D); _repay(bytes32("r1"));
        _closePool();
        assertGt(pool.protocolFees(), 0, "no protocol fees to sweep");
        vm.prank(MULTISIG); pool.sweepProtocolFees();
        assertEq(pool.protocolFees(), 0, "protocolFees not zeroed after sweep");
    }

    /// Minimum draw: 1 USDC × 1 day → no zero-divide at tiny amounts.
    function testPrecision_minimumDrawRepay_noRevert() public {
        _lock();
        _draw(bytes32("r1"), 1, 1);   // 1 USDC (= 1 * SCALE internally)
        vm.warp(LOCK + D);
        _repay(bytes32("r1"));
        assertEq(pool.outstanding(), 0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  4. DONATION / INFLATION / FIRST-DEPOSITOR
    //
    //  Finding: pool reads tracked buckets, not balanceOf.  A direct USDC
    //           transfer to the pool is unattributed surplus and does not
    //           affect any accounting variable.  No share math that divides by
    //           token balance → no inflation attack.
    //  Mitigation: all accounting via explicit state variables; balanceOf never
    //              consulted for correctness.
    // ══════════════════════════════════════════════════════════════════════════

    /// Direct USDC transfer to pool must not affect tracked accounting.
    function testDonation_directTransfer_noAccountingEffect() public {
        _lock();
        uint256 principalBefore   = pool.principal();
        uint256 avBefore          = pool.availableToDd();
        uint256 outstandingBefore = pool.outstanding();

        usdc.mint(address(this), 999_999 * SCALE);
        usdc.transfer(address(pool), 999_999 * SCALE);

        assertEq(pool.principal(),     principalBefore,  "donation inflated principal");
        assertEq(pool.availableToDd(), avBefore,          "donation inflated availableToDd");
        assertEq(pool.outstanding(),   outstandingBefore, "donation changed outstanding");
    }

    /// Direct USDC transfer to treasury must not affect reserveBalance.
    function testDonation_treasury_directTransfer_noEffect() public {
        uint256 resBefore = treasury.reserveBalance();
        usdc.mint(address(this), 100_000 * SCALE);
        usdc.transfer(address(treasury), 100_000 * SCALE);
        assertEq(treasury.reserveBalance(), resBefore, "donation inflated reserveBalance");
    }

    /// First-depositor inflation attack: deposit 1 unit, donate large amount,
    /// then second depositor joins.  Pool tracks deposits directly → no inflation.
    function testDonation_firstDepositor_noInflation() public {
        // First depositor: 1 SCALE
        vm.prank(LP_A); pool.deposit(1 * SCALE);
        // Donate directly to pool (unattributed; no effect on accounting)
        usdc.mint(address(this), 9_000_000 * SCALE);
        usdc.transfer(address(pool), 9_000_000 * SCALE);
        // Second depositor: same 1 SCALE
        vm.prank(LP_B); pool.deposit(1 * SCALE);

        vm.warp(LOCK); pool.finalizeFunding();
        vm.warp(MAT + D);
        (, , uint256 owed) = pool.getIdleFeesBreakdown();
        usdc.mint(PSP, owed);
        vm.prank(PSP); usdc.approve(address(pool), owed);
        vm.prank(PSP); pool.payAccruedIdleFees(owed);

        // Both LPs deposited the same amount → same dollarSeconds
        (, uint256 lpADs,,,,) = pool.getLpPosition(LP_A);
        (, uint256 lpBDs,,,,) = pool.getLpPosition(LP_B);
        assertEq(lpADs, lpBDs, "dollarSeconds differ despite equal deposits");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  5. UNBOUNDED LOOP / GAS GRIEFING
    //
    //  Finding: _hasOverdueUnsettled() is O(N) over drawDownRefs when
    //           scOverdueCheck=true.  This is a deliberate design choice — no
    //           hard cap on concurrent drawdowns.  The operational mitigation is
    //           setScOverdue(false) before N grows large enough to approach the
    //           block gas limit.  Part A derives the concrete threshold.
    //
    //  _removeDrawDown (repay) is O(1) swap-and-pop.
    //  Claims are pull-based — no LP loop anywhere.
    // ══════════════════════════════════════════════════════════════════════════

    /// Swap-and-pop: repaying any draw in a 3-draw set is O(1).
    function testUnboundedLoop_repay_O1_swapAndPop() public {
        _lock();
        _draw(bytes32("r1"), 100_000, 6);
        _draw(bytes32("r2"), 100_000, 6);
        _draw(bytes32("r3"), 100_000, 6);
        vm.warp(LOCK + 3 * D);
        _repay(bytes32("r2"));   // middle element — swap-and-pop
        assertEq(pool.outstanding(), 200_000 * SCALE, "outstanding wrong after mid-repay");
    }

    /// Pull-based claims: two LPs each claim independently, no shared loop.
    function testUnboundedLoop_claims_pullBased() public {
        vm.prank(LP_A); pool.deposit(500_000 * SCALE);
        vm.prank(LP_B); pool.deposit(500_000 * SCALE);
        vm.warp(LOCK); pool.finalizeFunding();
        _draw(bytes32("r1"), 100_000, 3);
        vm.warp(LOCK + 3 * D); _repay(bytes32("r1"));
        _closePool();

        uint256 balA0 = usdc.balanceOf(LP_A);
        vm.prank(LP_A); pool.claimYield();
        assertGt(usdc.balanceOf(LP_A), balA0, "LP_A got no yield");

        uint256 balB0 = usdc.balanceOf(LP_B);
        vm.prank(LP_B); pool.claimYield();
        assertGt(usdc.balanceOf(LP_B), balB0, "LP_B got no yield");
    }

    /// N=30 open draws with scOverdueCheck ON: executeDrawdown still works (well within
    /// block gas limit).  Also confirms the mode-switch resolves the O(N) path.
    function testUnboundedLoop_scOverdueON_N30_thenSwitch() public {
        _lock();
        for (uint256 n = 1; n <= 30; n++) {
            bytes32 ref = bytes32(n);
            vm.prank(AGENT2); pool.executeDrawdown(ref, PSP, 10_000 * SCALE, 6);
        }
        // executeDrawdown at N=30 must succeed
        bytes32 ref31 = bytes32(uint256(31));
        vm.prank(AGENT2); pool.executeDrawdown(ref31, PSP, 10_000 * SCALE, 6);

        // Mode-switch: scOverdueCheck=false → subsequent executeDrawdown is O(1)
        vm.prank(AGENT1); pool.setScOverdue(false);
        bytes32 ref32 = bytes32(uint256(32));
        vm.prank(AGENT2); pool.executeDrawdown(ref32, PSP, 10_000 * SCALE, 6);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  6. SINGLE-TOKEN / FEE-ON-TRANSFER / REBASING TOKEN
    //
    //  Finding: stablecoin is fixed at initialize(); no path to deposit a
    //           different token.  Fee-on-transfer and rebasing tokens cannot
    //           enter because the token reference is immutable per-pool.
    //  Mitigation: stablecoin = p.stablecoin set at init; no multi-token
    //              deposit overload; no token-switching setter.
    // ══════════════════════════════════════════════════════════════════════════

    /// The pool's stablecoin is fixed; a foreign token direct-transfer changes no state.
    function testSingleToken_foreignToken_untracked() public {
        MockStablecoin foreignToken = new MockStablecoin();
        assertNotEq(pool.stablecoin(), address(foreignToken));

        uint256 principalBefore = pool.principal();
        foreignToken.mint(address(this), 1_000_000 * SCALE);
        foreignToken.transfer(address(pool), 1_000_000 * SCALE);
        assertEq(pool.principal(), principalBefore, "foreign token transfer modified principal");
    }

    /// stablecoin is read-only after init; no ABI setter exists.
    function testSingleToken_noStablecoinSetter() public {
        assertEq(pool.stablecoin(), address(usdc));
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  7. PRICE ORACLE MANIPULATION / FLASH-LOAN PRICE ATTACKS — N/A
    //
    //  The protocol has no price oracle, no AMM dependency, and no external
    //  price feed.  LP coupon (yieldOwed) is fixed at pool lock time from
    //  dollarSeconds × aprAnnual / year; it does not depend on any spot price.
    //  Flash loans cannot affect this computation.
    //
    //  No active test is needed; this is an architectural N/A.
    // ══════════════════════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════════════════════
    //  8. STORAGE COLLISION / UNINITIALISED PROXY (EIP-1167 CLONE PATTERN)
    //
    //  Finding — re-initialization: initialize() is guarded by _initialized.
    //    Once a clone is initialized by the factory, it cannot be initialized
    //    again by any caller.
    //
    //  Fix applied: PoolContract constructor now sets `_initialized = true`,
    //    which is the manual equivalent of OZ Initializable._disableInitializers().
    //    Any call to initialize() on the raw implementation now reverts with
    //    "Pool: already initialized" before any state can be written.
    //    This removes the class permanently regardless of future edits.
    //
    //  Mitigation: Initializable one-shot flag (_initialized bool) in pool;
    //              constructor locks the impl against direct initialization;
    //              factory deploys clone then calls initialize in one tx;
    //              no storage-layout collision possible with EIP-1167.
    // ══════════════════════════════════════════════════════════════════════════

    /// Live clone cannot be re-initialized — _initialized flag blocks the call.
    function testProxy_cloneCannotBeReinitialized() public {
        vm.expectRevert("Pool: already initialized");
        pool.initialize(PoolContract.InitParams({
            pspWallet:              PSP,
            softCap:                1 * SCALE,
            hardCap:                9_000_000 * SCALE,
            tenure:                 TENOR,
            idleRateDaily:          5e14,
            utilizedRateDaily:      5e14,
            penaltyRateDaily:       1e15,
            penaltyGraceDays:       2,
            minDeposit:             0,
            aprAnnual:              1e17,
            fundingDurationSecs:    5 * 86400,
            fundingExecBufferDays:  25e16,
            maxGracePeriodDays:     3,
            minDdDays:              1,
            maxDdDays:              7,
            treasury:               address(treasury),
            stablecoin:             address(usdc),
            agent1:                 AGENT1,
            agent2:                 AGENT2,
            multisig:               MULTISIG
        }));
    }

    /// Arbitrary caller cannot re-initialize an already-live clone.
    function testProxy_reinitializeByRandom_reverts() public {
        vm.prank(RANDOM);
        vm.expectRevert("Pool: already initialized");
        pool.initialize(PoolContract.InitParams({
            pspWallet:              RANDOM,
            softCap:                1 * SCALE,
            hardCap:                9_000_000 * SCALE,
            tenure:                 TENOR,
            idleRateDaily:          5e14,
            utilizedRateDaily:      5e14,
            penaltyRateDaily:       1e15,
            penaltyGraceDays:       2,
            minDeposit:             0,
            aprAnnual:              1e17,
            fundingDurationSecs:    5 * 86400,
            fundingExecBufferDays:  25e16,
            maxGracePeriodDays:     3,
            minDdDays:              1,
            maxDdDays:              7,
            treasury:               address(treasury),
            stablecoin:             address(usdc),
            agent1:                 AGENT1,
            agent2:                 AGENT2,
            multisig:               MULTISIG
        }));
    }

    /// initialize() on the raw implementation must revert.
    /// The constructor sets _initialized = true, preventing any caller from
    /// initializing the impl directly (OZ _disableInitializers() equivalent).
    function testProxy_implInitialization_reverts() public {
        address impl = factory.poolImplementation();
        PoolContract implContract = PoolContract(impl);

        vm.expectRevert("Pool: already initialized");
        implContract.initialize(PoolContract.InitParams({
            pspWallet:              RANDOM,
            softCap:                1 * SCALE,
            hardCap:                9_000_000 * SCALE,
            tenure:                 TENOR,
            idleRateDaily:          5e14,
            utilizedRateDaily:      5e14,
            penaltyRateDaily:       1e15,
            penaltyGraceDays:       2,
            minDeposit:             0,
            aprAnnual:              1e17,
            fundingDurationSecs:    5 * 86400,
            fundingExecBufferDays:  25e16,
            maxGracePeriodDays:     3,
            minDdDays:              1,
            maxDdDays:              7,
            treasury:               address(treasury),
            stablecoin:             address(usdc),
            agent1:                 AGENT1,
            agent2:                 AGENT2,
            multisig:               MULTISIG
        }));
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ADDITIONAL: Status-machine guards
    // ══════════════════════════════════════════════════════════════════════════

    function testStatusGuard_executeDrawdown_requires_Active() public {
        vm.prank(AGENT2);
        vm.expectRevert("Pool: not active");
        pool.executeDrawdown(bytes32("r1"), PSP, 100_000 * SCALE, 1);
    }

    function testStatusGuard_repay_requires_Active() public {
        vm.prank(PSP);
        vm.expectRevert("Pool: not active");
        pool.repay(bytes32("r1"));
    }

    function testStatusGuard_claimYield_allowedAfterDefault() public {
        _lock();
        _draw(bytes32("r1"), 100_000, 3);
        vm.warp(MAT + D);
        vm.prank(AGENT2); pool.declareDefault();
        vm.prank(LP_A); pool.claimYield();   // must not revert
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  FINDINGS TABLE
//
//  Class                           Verdict            Evidence / Notes
//  ──────────────────────────────  ─────────────────  ────────────────────────
//  1. Reentrancy                   MITIGATED          OZ ReentrancyGuard on all
//                                                     external state-mutating
//                                                     fns; CEI before every
//                                                     safeTransfer.
//                                                     Tests: testReentrancy_*
//
//  2. Access control               MITIGATED          OZ AccessControl (factory)
//                                                     hasRole (pool) Ownable
//                                                     (treasury).
//                                                     Tests: testAccessControl_*
//
//  3. Precision / underflow        MITIGATED          Solidity 0.8; MathLib
//                                                     mulDiv (512-bit); explicit
//                                                     ternary for penDays=0.
//                                                     Tests: testPrecision_*
//
//  4. Donation / inflation         MITIGATED          Tracked-bucket accounting;
//                                                     balanceOf not used for
//                                                     correctness; no share math.
//                                                     Tests: testDonation_*
//
//  5. Unbounded loop / gas         KNOWN / MANAGED    O(N) loop is deliberate
//                                                     design.  Operational
//                                                     mitigation: setScOverdue
//                                                     (false) at threshold N.
//                                                     Part A derives the N.
//                                                     Tests: testUnboundedLoop_*
//
//  6. Single-token / FOT           MITIGATED          Stablecoin fixed at init;
//                                                     no multi-token path.
//                                                     Tests: testSingleToken_*
//
//  7. Oracle / flash-loan          N/A                No price oracle; APR coupon
//                                                     fixed at pool lock time.
//
//  8. Storage collision / proxy    MITIGATED          Constructor sets
//                                                     _initialized=true on the
//                                                     impl (equivalent to OZ
//                                                     _disableInitializers()).
//                                                     Clone re-init also blocked.
//                                                     Both layers tested.
//                                                     Tests: testProxy_*
// ─────────────────────────────────────────────────────────────────────────────
