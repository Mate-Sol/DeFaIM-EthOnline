# Contracts — payfi_v1 baseline

Solidity + Foundry credit pool contracts, ported verbatim from
[Mate-Sol/payfi_v1](https://github.com/Mate-Sol/payfi_v1). Same source, same
tests, same OZ + forge-std dependencies. See `../README.md` for hackathon
context.

## Layout

```
src/
  PoolFactory.sol       PSP registry + envelope + createPool (EIP-1167 clones)
  PoolContract.sol      per-facility credit pool (~1420 LOC)
  TreasuryReserve.sol   protocol-fee / insurance reserve
  MathLib.sol           WAD math helpers
  IPoolFactory.sol      minimal interface used by PoolContract
  ITreasuryReserve.sol  minimal interface used by PoolContract
  MockStablecoin.sol    6-decimal USDC stand-in for tests + testnet

test/                   26 Foundry test files: invariant / adversarial /
                        differential / fuzz / gas-profile / view-mutation
                        consistency / security. ~17K LOC of coverage.

lib/
  forge-std             Foundry std library
  openzeppelin-contracts  OZ v5.x — AccessControl, ReentrancyGuard, Clones, SafeERC20

script/
  Deploy.s.sol          deploys the full stack + wires TreasuryReserve
  CreateDemoPool.s.sol  optional seed pool for empty-state demo
```

## Local build + test

```bash
cd contracts
forge build
forge test
```

## Deploy — local Anvil (no key management needed)

```bash
# Terminal A — run a fresh Anvil (chain id 31337)
anvil --chain-id 31337

# Terminal B — deploy using anvil's first default key
cd contracts
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

The script prints all three deployed addresses at the end. Copy them into:

- `server/.env`  → `PAYFI_STABLECOIN_ADDRESS`, `PAYFI_TREASURY_ADDRESS`, `PAYFI_FACTORY_ADDRESS`
- `client/.env`  → `VITE_STABLECOIN_ADDRESS`, `VITE_TREASURY_ADDRESS`, `VITE_FACTORY_ADDRESS`

Then also set on both sides:
- `EVM_CHAIN_ID=31337`, `EVM_RPC_URL=http://localhost:8545` on the server
- `VITE_CHAIN_ID=31337`, `VITE_RPC_URL=http://localhost:8545`, `VITE_CHAIN_NAME=Anvil` on the client

## Deploy — Polygon Amoy testnet

Get an Amoy RPC (Alchemy / Infura free tier works). Fund the deployer with
a bit of Amoy POL from [the Polygon faucet](https://faucet.polygon.technology).

```bash
export EVM_RPC_URL=https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY
export DEPLOYER_PRIVATE_KEY=0x...

cd contracts
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $EVM_RPC_URL \
  --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY
```

## Deploy — Arc testnet

Same shape, different RPC. Chain ID + RPC URL from Circle's Arc docs
(check the Arc console — this changes as they iterate).

```bash
export EVM_RPC_URL=https://rpc.testnet.arc.network   # verify from Arc docs
export DEPLOYER_PRIVATE_KEY=0x...

forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $EVM_RPC_URL \
  --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY
```

## Optional: seed a demo pool

Once deployed and the demo PSP is approved (set `DEMO_PSP` env when
running `Deploy.s.sol`), you can create a pool through the factory:

```bash
export PAYFI_FACTORY_ADDRESS=0x...        # from Deploy.s.sol output
export PAYFI_STABLECOIN_ADDRESS=0x...
export PSP_WALLET=0x...                    # must match DEMO_PSP
export AGENT1_ADDRESS=$PSP_WALLET          # any address holding AGENT1
export AGENT2_ADDRESS=$PSP_WALLET          # any address holding AGENT2
export MULTISIG_ADDRESS=$DEPLOYER          # per-pool multisig

forge script script/CreateDemoPool.s.sol:CreateDemoPoolScript \
  --rpc-url $EVM_RPC_URL \
  --broadcast \
  --private-key $DEPLOYER_PRIVATE_KEY
```

Optional pool-tuning env vars (defaults in parens):
- `FACILITY_APR_BPS`    (1200 = 12%)
- `FACILITY_SOFT_CAP`   (1_000_000_000 = 1000 USDC)
- `FACILITY_HARD_CAP`   (10_000_000_000 = 10K USDC)
- `FACILITY_TENURE`     (30 days)
- `FACILITY_FUNDING_S`  (7 days in seconds)

## Env var overrides for Deploy.s.sol

| Var | Default | Meaning |
|---|---|---|
| `MULTISIG` | deployer | Address receiving `MULTISIG_ROLE` + Treasury ownership |
| `DEPLOYER` | deployer | Address receiving `DEPLOYER_ROLE` (can call createPool) |
| `DEMO_PSP` | — | If set, factory.approvePsp() runs for this address |
| `RESERVE_TARGET` | 1_000_000_000 (1K USDC) | TreasuryReserve target |

If `MULTISIG != deployer`, the `setFactory` + `setEnvelope` + `approvePsp`
calls are SKIPPED (Ownable / role-gated). You'll need to run those from
the multisig address separately.

## Post-deploy verification

```bash
# Read factory state
cast call $PAYFI_FACTORY_ADDRESS "poolCount()" --rpc-url $EVM_RPC_URL
cast call $PAYFI_FACTORY_ADDRESS "poolImplementation()" --rpc-url $EVM_RPC_URL

# Read envelope
cast call $PAYFI_FACTORY_ADDRESS "envelope()" --rpc-url $EVM_RPC_URL
```
