// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * Deploy.s.sol
 *
 * Foundry deploy script for the payfi_v1 contract set. Deploys in order:
 *
 *   1. MockStablecoin (test USDC — 6 decimals, unrestricted mint)
 *   2. TreasuryReserve
 *   3. PoolContract (implementation, used as EIP-1167 clone source)
 *   4. PoolFactory (wires impl + treasury + stablecoin + bounds)
 *   5. TreasuryReserve.setFactory(factory)      — link back
 *   6. Factory.setEnvelope(default envelope)    — wide open, tunable
 *   7. Optionally: factory.approvePsp(DEMO_PSP)
 *
 * Usage (local Anvil):
 *
 *   # Terminal A: run a fresh Anvil (chain id 31337)
 *   anvil --chain-id 31337
 *
 *   # Terminal B: deploy — anvil default private key
 *   cd contracts
 *   forge script script/Deploy.s.sol:DeployScript \
 *     --rpc-url http://localhost:8545 \
 *     --broadcast \
 *     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *
 * Usage (Polygon Amoy / Arc testnet):
 *
 *   forge script script/Deploy.s.sol:DeployScript \
 *     --rpc-url $EVM_RPC_URL \
 *     --broadcast \
 *     --private-key $DEPLOYER_PRIVATE_KEY
 *
 * Env overrides (all optional, sensible defaults if missing):
 *   MULTISIG          address that gets MULTISIG_ROLE (default: deployer)
 *   DEPLOYER          address that gets DEPLOYER_ROLE (default: deployer)
 *   DEMO_PSP          if set, factory.approvePsp() is called for it
 *   RESERVE_TARGET    treasury reserve target in USDC base units
 *                     (default: 1000 USDC = 1_000_000_000)
 *
 * The script prints every deployed address at the end so .env values can
 * be copy-pasted directly.
 */

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/MockStablecoin.sol";
import "../src/TreasuryReserve.sol";
import "../src/PoolContract.sol";
import "../src/PoolFactory.sol";

contract DeployScript is Script {
    // ── WAD helper — Solidity's 1e18 fixed-point scale ─────────────
    uint256 internal constant WAD = 1e18;

    function run() external {
        // ── Actor addresses ─────────────────────────────────────────
        // Foundry's msg.sender is the tx.origin from the --private-key flag,
        // which we treat as the deployer + default multisig on Anvil.
        address deployer = msg.sender;
        address multisig = _envAddr("MULTISIG", deployer);
        address roleDeployer = _envAddr("DEPLOYER", deployer);

        console.log("=========================================================");
        console.log("Deploying payfi_v1 contract set");
        console.log("=========================================================");
        console.log("  deployer:   ", deployer);
        console.log("  multisig:   ", multisig);
        console.log("  DEPLOYER role:", roleDeployer);
        console.log("");

        vm.startBroadcast();

        // ── 1. MockStablecoin ───────────────────────────────────────
        MockStablecoin usdc = new MockStablecoin();
        console.log("MockStablecoin:      ", address(usdc));

        // ── 2. TreasuryReserve ──────────────────────────────────────
        // reserveRate: 20% of protocol fees flow into reserve
        // reserveTarget: 1000 USDC default (envable)
        // hurdleFrac: 5% — LP bonus kicks in past this
        // lpBonusShare: 50% — half of overrun goes to LPs
        uint256 reserveRate       = 2 * 1e17;   // 0.20 WAD
        uint256 reserveTarget     = _envUint("RESERVE_TARGET", 1_000_000_000); // 1000 USDC (6 dec)
        uint256 hurdleFrac        = 5 * 1e16;   // 0.05 WAD
        uint256 lpBonusShare      = 5 * 1e17;   // 0.50 WAD

        TreasuryReserve treasury = new TreasuryReserve(
            address(usdc), multisig,
            reserveRate, reserveTarget, hurdleFrac, lpBonusShare
        );
        console.log("TreasuryReserve:     ", address(treasury));

        // ── 3. PoolContract (implementation) ────────────────────────
        // The constructor locks the implementation against direct init;
        // only clones via factory can be initialized.
        PoolContract poolImpl = new PoolContract();
        console.log("PoolContract impl:   ", address(poolImpl));

        // ── 4. PoolFactory ──────────────────────────────────────────
        // Bounds tuned for hackathon demos:
        //   funding window     ≤ 30 days
        //   funding→exec buffer  0.25 day  (6h)
        //   grace period       ≤ 30 days
        //   drawdown tenor     1..365 days
        uint256 maxFundingDurationSecs = 30 days;
        uint256 fundingExecBufferDays  = WAD / 4;  // 0.25 day
        uint256 maxGracePeriodDays     = 30;
        uint256 minDdDays              = 1;
        uint256 maxDdDays              = 365;

        PoolFactory factory = new PoolFactory(
            multisig, roleDeployer, address(poolImpl), address(treasury), address(usdc),
            maxFundingDurationSecs, fundingExecBufferDays, maxGracePeriodDays, minDdDays, maxDdDays
        );
        console.log("PoolFactory:         ", address(factory));

        // ── 5. Link Treasury -> Factory ─────────────────────────────
        // TreasuryReserve.setFactory is Ownable-gated to `multisig`.
        // Only callable by multisig — on Anvil the deployer IS multisig
        // (unless MULTISIG env was set differently). On real testnets,
        // this call has to be made from the multisig address.
        if (multisig == deployer) {
            treasury.setFactory(address(factory));
            console.log("Treasury.setFactory  OK");
        } else {
            console.log("Treasury.setFactory  SKIPPED (multisig != deployer, run separately)");
        }

        // ── 6. Envelope (permissive default) ────────────────────────
        // Wide-open envelope suitable for demos. CRO tightens per-facility.
        PoolFactory.Envelope memory env = PoolFactory.Envelope({
            minApr:         WAD / 100,       // 1% APR floor
            maxApr:         30 * WAD / 100,  // 30% APR ceiling
            minTenure:      7,               // 1 week
            maxTenure:      365,             // 1 year
            minPgd:         0,
            maxPgd:         30,
            minIdleRate:    0,
            maxIdleRate:    WAD / 100,       // 1%/day ceiling
            minUtilRate:    0,
            maxUtilRate:    WAD / 10,        // 10%/day ceiling
            minPenRate:     0,
            maxPenRate:     WAD / 5,         // 20%/day ceiling
            hardCapCeiling: 10_000_000_000_000  // 10M USDC (6 dec)
        });
        if (multisig == deployer) {
            factory.setEnvelope(env);
            console.log("Factory.setEnvelope  OK");
        } else {
            console.log("Factory.setEnvelope  SKIPPED (multisig != deployer)");
        }

        // ── 7. Optional: approve a demo PSP ─────────────────────────
        address demoPsp = _envAddr("DEMO_PSP", address(0));
        if (demoPsp != address(0)) {
            if (multisig == deployer) {
                factory.approvePsp(demoPsp);
                console.log("Factory.approvePsp   OK  ", demoPsp);
            } else {
                console.log("Factory.approvePsp   SKIPPED (needs multisig)", demoPsp);
            }
        }

        vm.stopBroadcast();

        // ── Final address dump ──────────────────────────────────────
        console.log("");
        console.log("=========================================================");
        console.log("Paste into server/.env and client/.env:");
        console.log("=========================================================");
        console.log("PAYFI_STABLECOIN_ADDRESS = ", address(usdc));
        console.log("PAYFI_TREASURY_ADDRESS   = ", address(treasury));
        console.log("PAYFI_FACTORY_ADDRESS    = ", address(factory));
        console.log("");
        console.log("VITE_STABLECOIN_ADDRESS  = ", address(usdc));
        console.log("VITE_TREASURY_ADDRESS    = ", address(treasury));
        console.log("VITE_FACTORY_ADDRESS     = ", address(factory));
        console.log("=========================================================");
    }

    // ── env helpers ────────────────────────────────────────────────
    function _envAddr(string memory key, address fallback_) internal view returns (address) {
        try vm.envAddress(key) returns (address v) { return v; } catch { return fallback_; }
    }

    function _envUint(string memory key, uint256 fallback_) internal view returns (uint256) {
        try vm.envUint(key) returns (uint256 v) { return v; } catch { return fallback_; }
    }
}
