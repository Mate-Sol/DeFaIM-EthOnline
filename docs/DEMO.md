# Reviewing DeFa

**ETHOnline 2026 · Arc testnet (chain 5042002)**

Everything below runs against the live deployment. Nothing needs to be
installed to see the protocol working, and nothing here requires a wallet
except where stated.

---

## 1 · No setup at all

### The Subgraph

Live endpoint, no key required:

```
https://api.studio.thegraph.com/query/1760269/defa-arc/v0.0.1
```

```bash
curl -s -X POST https://api.studio.thegraph.com/query/1760269/defa-arc/v0.0.1 \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ facilities(first:5, orderBy:createdAt, orderDirection:desc){ id borrower status totalAssets totalDrawn totalRepaid outstanding } repayments(first:3, orderBy:timestamp, orderDirection:desc){ principal financeCharge txHash } }"}'
```

Every repayment returned here can be checked against
[testnet.arcscan.app](https://testnet.arcscan.app) by its `txHash`.

### The risk agent

```bash
git clone https://github.com/Mate-Sol/DeFaIM-EthOnline
cd DeFaIM-EthOnline
node agent/src/index.js --demo-clock
```

No dependencies, no env, no keys — it reads the Subgraph and nothing else.
Exits 1 if anything CRITICAL is outstanding.

```bash
node agent/src/index.js --json     # machine-readable
cd agent && npm test               # 18 tests, offline
```

---

## 2 · The web apps

| | |
|---|---|
| **Lender** | https://defa-arc-hackathon.invoicemate.net |
| **PSP & Admin** | https://defa-arc-hackathon-admin.invoicemate.net |

### Demo accounts

These are throwaway accounts on a testnet deployment. They hold no real funds.

| Role | Email | Password |
|---|---|---|
| Lender | `demolender@demo.invoicemate.net` | `demo12345` |
| Borrower (PSP) | `psp3@demo.invoicemate.net` | `demo123` |
| Relationship manager (KAM) | `kam@maildrop.cc` | `admin123` |
| Credit analysis (CAD) | `cad@maildrop.cc` | `admin123` |
| Risk (CRO) | `cro@maildrop.cc` | `admin123` |

### What you can see without a wallet

- **Lender** — the marketplace of live facilities on Arc, their terms, tenures
  and status; any facility's detail page
- **Borrower** — the facility list, a facility's limit, drawable balance and
  outstanding position
- **Credit committee** — the review queues and the approval chain a facility
  moves through

### What needs a wallet

Anything that writes to the chain: depositing as a lender, repaying as a
borrower, and the on-chain admin screens that deploy pools. Those sign with
the connected browser wallet — the server returns calldata and never signs on
a user's behalf.

**Arc testnet in MetaMask**

| | |
|---|---|
| RPC | `https://rpc.testnet.arc.io` |
| Chain ID | `5042002` |
| Currency | `USDC` |
| Explorer | `https://testnet.arcscan.app` |

USDC is Arc's native gas token, so a testnet balance covers both gas and
principal. Note the decimals differ: 18 for gas, 6 for balances.

### On-chain admin

The on-chain admin screens are gated by an allowlist
(`ONCHAIN_ADMIN_WALLETS`) and by `MULTISIG_ROLE` on the factory, so they
cannot be opened with an arbitrary wallet. **If you want to deploy a facility
yourself, open an issue with your address and we will allowlist it.** None of
the read-only review above requires it.

---

## 3 · Contracts

Addresses and deployment blocks: [`DEPLOYMENTS.md`](./DEPLOYMENTS.md).

```bash
cd contracts && forge test
```

---

## 4 · Running the stack yourself

```bash
# API
cd server && npm install && cp .env.example .env   # fill in the blanks
npm test                                           # 82 tests
npm start

# Lender app
cd web/lender && npm install && npm run dev

# PSP & admin portal
cd web/portal && npm install && npm run dev

# Subgraph
cd subgraph && npm install && npx graph codegen && npx graph build
```

`server/.env.example` documents every variable. The two that matter:

- `PAYFI_FACTORY_ADDRESS` — which factory to point at
- one agent signer — either `AGENT_PRIVATE_KEY`, or the four `PRIVY_*`
  variables to sign through Privy's enclave instead

### A note on keys

**No private key, API key or app secret is in this repository, and none will
be.** `.env` is gitignored; only `.env.example` is committed, with empty
values. The one private key that appears anywhere in the history is Anvil's
well-known test account (`0xac09…ff80`), which is public knowledge and used in
the local Foundry script.

The server's agent key holds `AGENT2_ROLE` and can execute drawdowns, which is
exactly why it now lives in a Privy enclave behind a policy rather than in an
environment variable. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6.

---

## 5 · Where to look in the code

| Interest | Path |
|---|---|
| Credit terms, waterfall, invariants | `contracts/src/PoolContract.sol`, `PoolFactory.sol` |
| Subgraph schema (ERC-4626 shaped) | `subgraph/schema.graphql` |
| Pool clone indexing by template | `subgraph/src/pool.ts` |
| Risk rules over Subgraph data | `agent/src/rules.js` |
| Privy enclave signer + policy | `server/services/privySigner.js` |
| Transaction builders (server never signs) | `server/routes/poolTx.js` |
| Full lifecycle end-to-end run | `scripts/e2e-arc.js` |
