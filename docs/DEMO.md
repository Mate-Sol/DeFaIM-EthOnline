# Reviewing DeFa

**ETHOnline 2026 · Arc testnet (chain 5042002)**

Everything in this document was checked against the live deployment. Where a
step needs something you may not have, it says so rather than leaving you on a
screen that will not work.

---

## 1 · Zero setup

### The Subgraph — public, no key

```
https://api.studio.thegraph.com/query/1760269/defa-arc/v0.0.1
```

```bash
curl -s -X POST https://api.studio.thegraph.com/query/1760269/defa-arc/v0.0.1 \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ facilities(first:5, orderBy:createdAt, orderDirection:desc){ id borrower status totalAssets totalDrawn totalRepaid outstanding } repayments(first:3, orderBy:timestamp, orderDirection:desc){ principal financeCharge txHash } }"}'
```

Any `txHash` it returns can be checked on
[testnet.arcscan.app](https://testnet.arcscan.app).

### The risk agent — no install, no env, no keys

```bash
git clone https://github.com/Mate-Sol/DeFaIM-EthOnline
cd DeFaIM-EthOnline
node agent/src/index.js --demo-clock
```

Reads the Subgraph and nothing else. Exits 1 if anything CRITICAL is open.
`--json` for machine-readable output; `cd agent && npm test` runs 18 offline
tests.

---

## 2 · Accounts

Throwaway accounts on a testnet deployment. They hold no real funds.

| Role | Email | Password | Portal |
|---|---|---|---|
| Lender | `demolender@demo.invoicemate.net` | `demo12345` | Lender |
| Borrower (PSP) | `psp3@demo.invoicemate.net` | `demo123` | PSP & Admin |
| Relationship manager | `kam@maildrop.cc` | `admin123` | PSP & Admin |
| Credit analysis | `cad@maildrop.cc` | `admin123` | PSP & Admin |
| Risk officer | `cro@maildrop.cc` | `admin123` | PSP & Admin |

| Portal | URL |
|---|---|
| Lender | https://defa-arc-hackathon.invoicemate.net |
| PSP & Admin | https://defa-arc-hackathon-admin.invoicemate.net |

> **One session per site.** Both portals keep a single session per origin, so
> you cannot be the borrower and the risk officer at the same time. Sign out
> between roles.

---

## 3 · Arc testnet in your wallet

| | |
|---|---|
| Network name | Arc Testnet |
| RPC | `https://rpc.testnet.arc.io` |
| Chain ID | `5042002` |
| Currency symbol | `USDC` |
| Explorer | `https://testnet.arcscan.app` |

USDC is Arc's **native gas token** — no token import needed, the balance shows
as the native one. Gas is quoted in 18 decimals, protocol amounts in 6.

### Getting testnet USDC

- [faucet.circle.com](https://faucet.circle.com/) — select Arc Testnet
- [arc-faucet.dev](https://arc-faucet.dev/) — larger daily grant, GitHub sign-in

> The `/faucet` route in this repo targets a mintable MockStablecoin and does
> **not** work on Arc, where USDC is the chain's own asset and we are not a
> minter. Use the faucets above.

---

## 4 · Full lifecycle walkthrough

Steps 1–2 and 4–7 you can do yourself. Step 3 is allowlist-gated; see below.

### 1 · Raise a facility — *borrower*

Sign in as **psp3** → **Borrow Portal** → **Request New Facility**.
Credit line `20`, tenor `30` days.

psp3 has approved facilities already, so this goes straight to **CRO review** —
only a PSP's *first* facility runs the full KAM → CAD → CRO chain.

### 2 · Approve it — *risk officer*

Sign out, sign in as **cro@maildrop.cc** → **/admin/cro**. The request is in the
queue. Approve, setting the terms:

| Term | Value |
|---|---|
| Credit line | 20 |
| Tenor | 30 days |
| Utilisation rate | 10 bps/day |
| Commitment rate | 1 bps/day |
| Penalty rate | 20 bps/day |
| Grace | 1 day |

> The utilisation rate must be **below** the penalty rate, and the APR must be
> coverable by the utilisation rate over the facility's worst-case life. The
> factory rejects anything else — you will see `Factory: util >= pen` or
> `Factory: APR not coverable by util rate` rather than a broken pool.

The facility moves to `AWAITING_POOL_INIT`.

### 3 · Deploy the pool — *on-chain admin* ⚠️

**/onchain-admin/initialize** → pick a funding window → **Initialize**. Two
signatures: approve the PSP on the factory, then create the pool.

This screen is gated by an allowlist (`ONCHAIN_ADMIN_WALLETS`) and by
`MULTISIG_ROLE` on the factory, so an arbitrary wallet cannot open it — the
same control that stops anyone deploying facilities against the protocol.
**Open an issue with your address and we will allowlist it**, or skip to step 4
against a facility already in funding.

### 4 · Fund it — *lender*

> **A facility is open right now:** `0x41A52E7337654E1B79C083EFB6Fc6EE1D3968aA2`
> — soft cap **1 USDC**, hard cap 20. The soft cap is deliberately one dollar,
> because Circle's faucet grants roughly 1 USDC per day: a single claim is
> enough to meet it, activate the facility and reach a drawdown. If its funding
> window has closed by the time you read this, open an issue and we will deploy
> another.


Sign in to the lender portal → **Pools** → pick one in *lending* → **Deposit**.
Two signatures: approve USDC, then deposit.

> Clear the **Risk Level** filter if the list looks empty — it persists between
> visits and will hide everything.

### 5 · Activate

The funding window must elapse in full; there is no early lock. At maturity,
`finalizeFunding()` activates the pool if the soft cap was met, and marks it
unsuccessful if it was not — in which case lenders withdraw.

### 6 · Draw down — *borrower*

**Borrow Portal** → the facility → **Request Drawdown**. Five validation gates
run — authorised receiver, eligible corridor, concentration, facility limit,
liquidity covenant — and any one failing rejects the draw. This call is signed
by the server under `AGENT2_ROLE`, so it needs **no wallet signature from you**.

### 7 · Repay

Same screen → **Repay**. Two signatures: approve USDC, then repay. The contract
computes the finance charge itself. Outstanding returns to zero, and before
the facility's finality date the principal becomes drawable again.

Then confirm it landed, three ways: `outstanding` on the facility, the
transaction on arcscan, and the `repayments` query in §1 — same hash in all
three.

### Doing the whole thing headlessly

```bash
cd server && npm install
PRIVATE_KEY=0x... node ../scripts/e2e-arc.js
```

Drives the same HTTP routes the web apps call and signs with a local key
instead of a browser wallet, verifying each step against the chain. The pool
creation step needs a key with `MULTISIG_ROLE`; everything after it does not.

---

## 5 · Timing

The demo deployment uses a second factory built with
`MathLib.SECONDS_PER_DAY = 60`, so a contract "day" elapses in a real minute
and a 30-day facility completes in half an hour. The bytecode is otherwise
identical to production, and the Subgraph indexes both.

Two consequences worth knowing before you read a number as a bug:

- A funding window of "1 hour" is 60 contract days and will fail the APR
  coverability check. Use ten minutes.
- Penalty accrues per contract day. A drawdown left open overnight shows a
  principal of 10 USDC against a debt of over 100 — correct behaviour observed
  at unusual speed.

---

## 6 · Contracts and local setup

Addresses and deployment blocks: [`DEPLOYMENTS.md`](./DEPLOYMENTS.md).

```bash
cd contracts && forge test          # contract suite
cd server && npm install && npm test   # 82 tests
cd agent  && npm test                  # 18 tests
```

Running the stack:

```bash
cd server      && cp .env.example .env && npm start
cd web/lender  && npm install && npm run dev
cd web/portal  && npm install && npm run dev
cd subgraph    && npm install && npx graph codegen && npx graph build
```

### Keys

**No private key, API key or app secret is committed to this repository.**
`.env` is gitignored; only `.env.example` ships, with empty values. The one
private key anywhere in the history is Anvil's well-known test account
(`0xac09…ff80`), used by the local Foundry script and public by design.

The server's agent key holds `AGENT2_ROLE` and can execute drawdowns, which is
why it now lives in a Privy enclave behind a policy rather than in an
environment variable — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6.

---

## 7 · Where to look

| Interest | Path |
|---|---|
| Credit terms, waterfall, invariants | `contracts/src/PoolContract.sol`, `PoolFactory.sol` |
| ERC-4626-shaped Subgraph schema | `subgraph/schema.graphql` |
| Pool clones indexed by template | `subgraph/src/pool.ts` |
| Risk rules over Subgraph data | `agent/src/rules.js` |
| Privy enclave signer and policy | `server/services/privySigner.js` |
| Transaction builders (server never signs for a user) | `server/routes/poolTx.js` |
| Scripted full lifecycle | `scripts/e2e-arc.js` |
