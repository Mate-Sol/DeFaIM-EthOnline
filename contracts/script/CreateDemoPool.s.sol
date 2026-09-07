// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * CreateDemoPool.s.sol
 *
 * Seeds ONE demo pool through the deployed PoolFactory so the front-end
 * has something to render before any real facility ships. Idempotent-ish:
 * fails visibly if the PSP already has an active pool.
 *
 * Prereqs (from Deploy.s.sol output):
 *   PAYFI_FACTORY_ADDRESS
 *   PAYFI_STABLECOIN_ADDRESS
 *   PSP_WALLET       (the PSP address that will hold the credit line;
 *                     must be pre-approved via factory.approvePsp)
 *   AGENT1_ADDRESS   (holds AGENT1_ROLE — pause/sc-overdue)
 *   AGENT2_ADDRESS   (holds AGENT2_ROLE — executeDrawdown)
 *   MULTISIG_ADDRESS (per-pool multisig; can be same as factory multisig)
 *
 * Optional env:
 *   FACILITY_APR_BPS     default 1200 (12% APR)
 *   FACILITY_SOFT_CAP    default 1_000_000_000  (1000 USDC)
 *   FACILITY_HARD_CAP    default 10_000_000_000 (10K USDC)
 *   FACILITY_TENURE      default 30 days
 *
 * Usage:
 *   forge script script/CreateDemoPool.s.sol:CreateDemoPoolScript \
 *     --rpc-url $EVM_RPC_URL \
 *     --broadcast \
 *     --private-key $DEPLOYER_PRIVATE_KEY
 *
 * The caller MUST hold the factory's DEPLOYER_ROLE (deployer key from
 * Deploy.s.sol). PSP_WALLET must be approved by MULTISIG_ROLE first
 * (Deploy.s.sol does this if DEMO_PSP env is set).
 */

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/PoolFactory.sol";

contract CreateDemoPoolScript is Script {
    uint256 internal constant WAD = 1e18;

    function run() external {
        address factoryAddr = vm.envAddress("PAYFI_FACTORY_ADDRESS");
        address pspAddr     = vm.envAddress("PSP_WALLET");
        address agent1      = vm.envAddress("AGENT1_ADDRESS");
        address agent2      = vm.envAddress("AGENT2_ADDRESS");
        address multisig    = vm.envAddress("MULTISIG_ADDRESS");

        uint256 aprBps        = _envUint("FACILITY_APR_BPS",    1200);
        uint256 softCap       = _envUint("FACILITY_SOFT_CAP",   1_000_000_000);
        uint256 hardCap       = _envUint("FACILITY_HARD_CAP",   10_000_000_000);
        uint256 tenure        = _envUint("FACILITY_TENURE",     30);
        uint256 fundingSecs   = _envUint("FACILITY_FUNDING_S",  7 days);

        PoolFactory factory = PoolFactory(factoryAddr);

        // Rate config (bps → WAD/day). Chosen so idle < util < penalty, which
        // is the factory's structural invariant.
        //   idle    5 bps/day = 0.05%/day
        //   util    30 bps/day
        //   penalty 60 bps/day
        uint256 idleRateDaily     = 5  * 1e14; // 5 bps in WAD = 5e14
        uint256 utilizedRateDaily = 30 * 1e14;
        uint256 penaltyRateDaily  = 60 * 1e14;

        PoolFactory.CreatePoolParams memory p = PoolFactory.CreatePoolParams({
            pspWallet:           pspAddr,
            fundingDurationSecs: fundingSecs,
            softCap:             softCap,
            hardCap:             hardCap,
            tenure:              tenure,
            idleRateDaily:       idleRateDaily,
            utilizedRateDaily:   utilizedRateDaily,
            penaltyRateDaily:    penaltyRateDaily,
            penaltyGraceDays:    3,
            minDeposit:          1_000_000,                 // 1 USDC
            aprAnnual:           aprBps * 1e14,             // bps → WAD
            agent1:              agent1,
            agent2:              agent2,
            multisig:            multisig
        });

        vm.startBroadcast();
        address pool = factory.createPool(p);
        vm.stopBroadcast();

        console.log("=========================================================");
        console.log("Demo pool created:");
        console.log("  pool:      ", pool);
        console.log("  psp:       ", pspAddr);
        console.log("  softCap:   ", softCap);
        console.log("  hardCap:   ", hardCap);
        console.log("  tenure:    ", tenure);
        console.log("  aprAnnBps: ", aprBps);
        console.log("=========================================================");
    }

    function _envUint(string memory key, uint256 fallback_) internal view returns (uint256) {
        try vm.envUint(key) returns (uint256 v) { return v; } catch { return fallback_; }
    }
}
