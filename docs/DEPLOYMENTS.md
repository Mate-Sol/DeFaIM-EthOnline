# Deployments

## Arc Testnet — chain `5042002`

| Contract | Address |
|---|---|
| PoolFactory | [`0xB5AB6FD1672642cfafcf6A44b2eEAB712576f466`](https://testnet.arcscan.app/address/0xB5AB6FD1672642cfafcf6A44b2eEAB712576f466) |
| PoolContract (implementation) | [`0xAa3AFC189F933C4F8D82eb452Fc5899Dd7371D6e`](https://testnet.arcscan.app/address/0xAa3AFC189F933C4F8D82eb452Fc5899Dd7371D6e) |
| TreasuryReserve | [`0x227D4F1F50162b5bEe0567AdBbbb1296061CfE1f`](https://testnet.arcscan.app/address/0x227D4F1F50162b5bEe0567AdBbbb1296061CfE1f) |
| USDC (settlement asset) | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |

USDC is Arc's native gas token, exposed as a 6-decimal ERC-20 at the address
above. It is not deployed by us — the factory is pointed at the chain's own
asset.

**Deployment block:** `60935148`  ·  use `60935148` as the Subgraph `startBlock`.

**Gas used:** 7,809,606 (0.195 USDC at 45 gwei).

Pools are EIP-1167 clones of the implementation, created by the factory, so
each facility gets its own address at `createPool()` time.

### Verifying the wiring

```
export ETH_RPC_URL=https://rpc.testnet.arc.io
cast call 0xB5AB6FD1672642cfafcf6A44b2eEAB712576f466 'stablecoin()(address)'
cast call 0xB5AB6FD1672642cfafcf6A44b2eEAB712576f466 'treasury()(address)'
cast call 0x227D4F1F50162b5bEe0567AdBbbb1296061CfE1f 'factory()(address)'
```

## Arc Mainnet — chain `5042`

Not yet deployed. Arc mainnet launches 16 September 2026.

Deployment uses the same script; the settlement asset resolves to the native
USDC precompile by chain id, so no configuration change is required:

```
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url $RPC_URL --broadcast --private-key $DEPLOYER_PRIVATE_KEY
```

Mainnet must be deployed from a freshly generated key.
