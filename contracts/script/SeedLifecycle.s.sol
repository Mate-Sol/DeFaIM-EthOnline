// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * SeedLifecycle.s.sol
 *
 * Seeds four facilities on a live network, each held at a different point in
 * the lifecycle, so every stage can be inspected on chain rather than inferred
 * from one pool's history.
 *
 *   Meridian FX Corridor     Funding    created, open for deposits
 *   Aurum Cross-Border       Funded     lender capital committed
 *   Mercury Settlements      Drawn      locked, borrower has drawn
 *   Atlas Trade Finance      Settled    drawn, repaid, lender claimed
 *
 * Runs in two phases because locking a pool means actually waiting out its
 * funding window on a live chain — there is no vm.warp here.
 *
 *   PHASE=1  approve the PSP, create all four, deposit into three
 *   ... wait out FUNDING_SECS (default 90s) ...
 *   PHASE=2  lock, draw, repay and claim
 *
 * Amounts are small by design: settlement is real USDC on Arc, which cannot be
 * minted. The waterfall is proportional, so the mechanism is identical at any
 * scale.
 *
 * Env:
 *   PAYFI_FACTORY_ADDRESS     from Deploy.s.sol
 *   PAYFI_STABLECOIN_ADDRESS  native USDC on Arc
 *   PHASE                     1 or 2
 *   FUNDING_SECS              funding window for the short-lived pools (default 90)
 */

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/PoolFactory.sol";
import "../src/PoolContract.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SeedLifecycleScript is Script {
    uint256 constant WAD = 1e18;

    // USDC, 6 decimals
    uint256 constant SOFT_CAP = 200_000;      // 0.20 USDC
    uint256 constant HARD_CAP = 20_000_000;   // 20.00 USDC
    uint256 constant DEPOSIT  = 400_000;      // 0.40 USDC
    uint256 constant DRAW     = 150_000;      // 0.15 USDC

    PoolFactory factory;
    IERC20      usdc;
    address     me;

    function run() external {
        factory = PoolFactory(vm.envAddress("PAYFI_FACTORY_ADDRESS"));
        usdc    = IERC20(vm.envAddress("PAYFI_STABLECOIN_ADDRESS"));
        uint256 phase = vm.envOr("PHASE", uint256(1));
        me = msg.sender;

        if (phase == 1) _phase1();
        else            _phase2();
    }

    // ── Phase 1 — create and fund ────────────────────────────────────────────

    function _phase1() internal {
        uint256 fundingSecs = vm.envOr("FUNDING_SECS", uint256(90));

        vm.startBroadcast();

        // The factory allows one live pool per PSP, so each facility gets its
        // own borrower address. The deployer drives every call; these addresses
        // only need to exist, not to hold keys.
        address pspFresh   = _psp("meridian");
        address pspFunded  = _psp("aurum");
        address pspDrawn   = _psp("mercury");
        address pspSettled = _psp("atlas");

        factory.approvePsp(pspFresh);
        factory.approvePsp(pspFunded);
        factory.approvePsp(pspDrawn);
        factory.approvePsp(pspSettled);

        // Long window: these stay open for deposits through the demo.
        address fresh  = _create("Meridian FX Corridor", pspFresh,  14 days, 1400);
        address funded = _create("Aurum Cross-Border",   pspFunded, 14 days, 600);

        // Short window: these get locked in phase 2.
        address drawn   = _create("Mercury Settlements", pspDrawn,   fundingSecs, 1200);
        address settled = _create("Atlas Trade Finance", pspSettled, fundingSecs, 900);

        usdc.approve(funded,  DEPOSIT);
        PoolContract(funded).deposit(DEPOSIT);
        usdc.approve(drawn,   DEPOSIT);
        PoolContract(drawn).deposit(DEPOSIT);
        usdc.approve(settled, DEPOSIT);
        PoolContract(settled).deposit(DEPOSIT);

        vm.stopBroadcast();

        console.log("");
        console.log("=== phase 1 complete ===");
        console.log("  Meridian FX Corridor (Funding) ", fresh);
        console.log("  Aurum Cross-Border   (Funded)  ", funded);
        console.log("  Mercury Settlements  (-> Drawn)", drawn);
        console.log("  Atlas Trade Finance  (-> Settled)", settled);
        console.log("");
        console.log("Wait out the funding window, then run PHASE=2 with:");
        console.log("  POOL_DRAWN=  ", drawn);
        console.log("  POOL_SETTLED=", settled);
    }

    // ── Phase 2 — lock, draw, repay, claim ───────────────────────────────────

    function _phase2() internal {
        PoolContract drawn   = PoolContract(vm.envAddress("POOL_DRAWN"));
        PoolContract settled = PoolContract(vm.envAddress("POOL_SETTLED"));

        vm.startBroadcast();

        // ── Mercury Settlements: lock and draw, leave it outstanding ──
        drawn.finalizeFunding();
        drawn.addReceiver(me);
        bytes32 refA = keccak256("mercury-drawdown-1");
        drawn.executeDrawdown(refA, me, DRAW, 5);
        console.log("Mercury  locked + drawn");

        // ── Atlas Trade Finance: the whole cycle ──
        settled.finalizeFunding();
        settled.addReceiver(me);
        bytes32 refB = keccak256("atlas-drawdown-1");
        settled.executeDrawdown(refB, me, DRAW, 5);

        (, , uint256 owed) = settled.getRepaymentOwed(refB);
        usdc.approve(address(settled), owed);
        settled.repay(refB);
        console.log("Atlas    drawn + repaid, owed:", owed);

        settled.claimYield();
        settled.claimPrincipal();
        console.log("Atlas    lender claimed yield + principal");

        vm.stopBroadcast();

        console.log("");
        console.log("=== phase 2 complete ===");
    }

    // ── helper ───────────────────────────────────────────────────────────────

    /// Deterministic stand-in borrower address for a facility.
    function _psp(string memory name) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked("defa.psp.", name)))));
    }

    function _create(string memory label, address psp, uint256 fundingSecs, uint256 aprBps)
        internal
        returns (address pool)
    {
        pool = factory.createPool(PoolFactory.CreatePoolParams({
            pspWallet:           psp,
            fundingDurationSecs: fundingSecs,
            softCap:             SOFT_CAP,
            hardCap:             HARD_CAP,
            tenure:              30,
            // The factory requires the promised LP APR to be coverable by
            // borrower utilisation fees over the facility's maximum life:
            //   apr * maxTenureSecs <= utilRate * 365 * tenure * 1 day
            idleRateDaily:       1e13,          // 0.001%/day on idle capital
            utilizedRateDaily:   1e15,          // 0.1%/day on drawn capital
            penaltyRateDaily:    2e15,          // 0.2%/day once overdue
            penaltyGraceDays:    2,
            minDeposit:          0,
            aprAnnual:           aprBps * WAD / 10_000,
            agent1:              me,
            agent2:              me,
            multisig:            me
        }));
        console.log(label, pool);
    }
}
