# DeFa

A secured revolving credit facility for cross-border payments, settling in USDC on
[Arc](https://www.arc.io) — Circle's stablecoin-native L1.

Institutional liquidity providers deposit USDC into risk-tiered pools. That capital is
deployed as revolving credit lines to licensed cross-border payment companies, which draw
against verified receivables to pre-fund payouts. Draws are repaid on settlement (T+1–T+7),
and yield flows back to LPs through an on-chain repayment waterfall.

## How it works

```
LP deposits USDC ──▶ Pool ──▶ Drawdown ──▶ Payout pre-funded
                      ▲                          │
                      └──── Repayment ◀──────────┘
                            (T+1–T+7 settlement)
```

Every drawdown passes five validation gates before funds are released:

| Gate | Check |
|---|---|
| Counterparty | Receiver is an approved, allowlisted wallet |
| Corridor | Payment corridor is eligible for this facility |
| Concentration | Single-counterparty exposure within limits |
| Facility limit | Draw fits inside the committed line |
| Liquidity covenant | Pool retains required liquidity buffer |

Repayment follows a fixed waterfall: principal → utilisation fee → penalty → LP yield.
Defaults settle from a treasury reserve.

## Architecture

**Arc (settlement).** Factory-cloned credit pools using EIP-1167 minimal proxies, one per
facility. Settlement in native USDC. Validation gates enforced on-chain, so release is a
conditional, multi-step operation rather than a trusted backend call.

**The Graph (data).** A Subgraph indexes pool events — deposits, drawdowns, repayments,
payout attestations — exposing facility state as a queryable, ERC-4626-shaped vault feed.

**Privy (accounts and approval).** Organization wallets for LP and borrower onboarding,
with policy- and quorum-gated approval on drawdown release.

## Repository layout

```
contracts/   Foundry — pool, factory, treasury reserve
server/      Node + Express + Mongoose — API, indexer, transaction builders
web/         Lender and borrower interfaces
subgraph/    The Graph — schema, manifest, mappings
agent/       Risk monitor querying the Subgraph
docs/        Architecture, contracts, API, repayment logic
```

## Network

| | |
|---|---|
| Arc Testnet | chain `5042002` · `https://rpc.testnet.arc.io` · [testnet.arcscan.app](https://testnet.arcscan.app) |
| Arc Mainnet | chain `5042` |
| USDC | `0x3600000000000000000000000000000000000000` (native gas token; 6-decimal ERC-20 interface) |

Deployed addresses are listed in [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md).

## Getting started

Setup instructions are in [`docs/LOCAL.md`](docs/LOCAL.md).

## License

MIT — see [LICENSE](LICENSE).
