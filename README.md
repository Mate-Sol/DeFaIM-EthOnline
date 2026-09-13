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

**The Graph (data).** A Subgraph indexes both factories and, by template, every pool
clone they deploy — deposits and withdrawals in the ERC-4626 event shape, drawdowns,
repayments with their finance charge, and lender yield and principal claims.

The schema is built on the **ERC-4626 tokenised vault standard** rather than a shape
of our own: `Deposit` and `Withdrawal` carry the standard `sender` / `owner` /
`assets` / `shares` fields, and each `Facility` exposes `asset`, `totalAssets` and
`totalSupply`. A DeFa facility is therefore legible to any tool that already reads
4626 vaults, with no protocol-specific knowledge — a credit facility presented
through the same interface as a yield vault.

**Wallets.** Lenders and borrowers connect an EOA through RainbowKit/wagmi and prove
ownership with a SIWE signature; that bound wallet is stamped into the pool as the
borrower and is the only address the contract accepts repayment from. Drawdown release
is gated on-chain by `AGENT2_ROLE` rather than by a backend check.

## Repository layout

```
contracts/   Foundry — pool, factory, treasury reserve
server/      Node + Express + Mongoose — API, indexer, transaction builders
web/         Lender and borrower interfaces
subgraph/    The Graph — schema, manifest, mappings
docs/        Architecture, protocol mechanics, deployments
```

## Documentation

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagrams, components, lifecycle, money flows, trust model |
| [`docs/PROTOCOL.md`](docs/PROTOCOL.md) | Fees, repayment waterfall, invariants, default handling |
| [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md) | Contract addresses on Arc Testnet |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Running the stack |

**Subgraph endpoint:** `https://api.studio.thegraph.com/query/1760269/defa-arc/v0.0.1`

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
