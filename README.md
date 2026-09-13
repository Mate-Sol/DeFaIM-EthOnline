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

**Privy (agent key custody).** The server holds `AGENT2_ROLE`, which lets it call
`executeDrawdown()` — the one server-side authority that moves lender capital to a
borrower. That authority was a raw private key in an environment variable: anything
that could read the environment could sign as the agent, from anywhere, forever.

It is now a Privy server wallet. The key lives in Privy's enclave and never reaches
this process; the server asks for a signature and a **policy** attached to the wallet
decides whether to give one. The policy denies any transaction carrying native value —
on Arc, USDC *is* the native token, so value is money leaving the wallet, and every
legitimate agent action is a zero-value contract call. Compromising the server yields
the ability to *request* a signature for a contract call, not to take the key or move
funds.

Arc is not in Privy's supported-chain list, so we sign with Privy and broadcast
through our own Arc RPC — `eth_signTransaction` accepts an arbitrary chain id.
Provision with `node scripts/privy-setup.js`; the signer falls back to a local key
when the Privy variables are unset.

**Risk monitor (`agent/`).** The Subgraph is not only displayed, it is reasoned
over. The monitor reads live facility state and decides what a human needs to
look at: drawdowns past their grace window accruing uncapped penalties,
facilities approaching finality with debt still outstanding, funding windows
that closed and were never finalised, and single-borrower concentration across
the book. It has no RPC client and no database — if the Subgraph is down the
agent has nothing to reason about, which is the honest test of whether an
integration is load-bearing.

```
node agent/src/index.js --demo-clock     # exits 1 if anything is CRITICAL
```

The same rules back `GET /pool/risk/findings`, which is how the on-chain admin
sees portfolio risk. Cross-facility questions are answered from the Subgraph
rather than RPC: asking them over JSON-RPC means one call per pool per field,
which is precisely the pattern that trips Arc's rate limiter.

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
agent/       Risk monitor reasoning over live Subgraph data
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
