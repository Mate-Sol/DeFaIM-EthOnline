# DeFa Subgraph

Indexes DeFa credit facilities on Arc.

The factory is a static data source; every facility is an EIP-1167 clone
created at runtime, so pools are indexed through a **template** started from
`PoolCreated`. Facility terms are read once at creation — they are stamped
into the clone at initialize and never change — so no event handler pays for
a contract call it doesn't need.

## What it indexes

| | |
|---|---|
| `Deposit` / `Withdraw` | ERC-4626 signatures, so tokenized-vault tooling reads this pool with a shared schema |
| `DrawdownExecuted` | borrower draws against the facility |
| `Repaid` | settlement, with the finance charge broken out |
| `YieldClaimed` / `PrincipalClaimed` | lender claims |
| `Locked` / `FundingFailed` / `PoolClosed` / `DefaultDeclared` | status transitions |

Facilities expose the vault surface (`asset`, `totalAssets`, `totalSupply`)
alongside their credit terms. Shares are 1:1 with assets — the pool tracks
lender principal rather than an appreciating share price, and yield is claimed
separately.

## Network

`arc-testnet` (`eip155:5042002`). Factory
`0xB5AB6FD1672642cfafcf6A44b2eEAB712576f466`, from block `60935148`.

For mainnet, change `network` to `arc` and set the mainnet factory address and
start block.

## Develop

```
npm install
npm run codegen
npm run build
```

## Deploy

Needs a deploy key from [Subgraph Studio](https://thegraph.com/studio):

```
npx graph auth <DEPLOY_KEY>
npm run deploy
```

Querying through the gateway — and through the Subgraph MCP — uses a separate
**Gateway API key**, also issued from Studio.
