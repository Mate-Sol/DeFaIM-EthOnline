# DeFa Server — Backend

Express + MongoDB + Anchor (Solana) client. Provides REST endpoints for the three portals, a fee-payer relay so users never need SOL, and a background indexer that mirrors on-chain pool state into Mongo.

```bash
npm install
cp .env.example .env       # fill the values listed below
npm run dev                # http://localhost:5050
```

---

## Environment

Required:

| Var | What |
|---|---|
| `MONGODB_URI` | Mongo connection string |
| `JWT_SECRET` | Used to sign all JWTs (PSP/admin + lender) |
| `SOLANA_RPC_URL` | Devnet/mainnet RPC endpoint |
| `PROGRAM_ID` | Anchor program id (default `pnYKpEUVokW9uMJxULV5gZMvRjSYh6uDiarg9HN5WCh`) |
| `USDC_DF_MINT` | The fake USDC mint used on devnet |
| `FEE_PAYER_KEYPAIR` | base58-encoded keypair the server signs as feePayer for relayed txs |
| `FAUCET_AUTHORITY` | base58-encoded mint authority for USDC-DF (faucet endpoint) |
| `ONCHAIN_ADMIN_WALLETS` | Comma-separated allowlist of wallet pubkeys allowed to sign in as on-chain admin |

Optional: `PORT` (default 5050), `FRONTEND_URL`, Azure storage vars (falls back to local fs).

---

## Routes

Mounted in [`index.js`](./index.js):

| Mount | File | What |
|---|---|---|
| `/auth` | `routes/auth.js` | PSP/admin email + password login, JWT issuance |
| `/auth/wallet` | `routes/walletAuth.js` | Lender + on-chain admin wallet sign-in (Sign-in-with-Solana) |
| `/pool` | `routes/poolTx.js` | Build-tx endpoints for every on-chain instruction; daily-activity, next-actions, drawdown amortization, pool state reads |
| `/facility` | `routes/facility.js` | Multi-facility request → KAM → CAD → CRO → AWAITING_POOL_INIT lifecycle |
| `/access-code` | `routes/accessCode.js` | On-chain admin mints one-time lender codes; redeem creates Lender + issues JWT |
| `/admin` | `routes/admin.js`, `routes/lifecycle.js` | PSP onboarding / approval workflow (KAM, CAD, CRO, Legal, Super-Admin) |
| `/psp` | `routes/psp.js` | PSP-side endpoints (profile, applications, agreements) |
| `/cfo` | `routes/cfo.js` | CFO dashboards (repayment monitoring) |
| `/segment` | `routes/segment.js` | Tech-integration segment registry |
| `/faucet` | `routes/faucet.js` | Devnet USDC-DF faucet for testing |
| `/relay` | `routes/relay.js` | Submits a wallet-signed tx with the server fee-payer signature |
| `/observer` | `routes/observer.js` | SAFE-Observer integration (off-chain vault telemetry) |
| `/maintenance` | `routes/maintenance.js` | Maintenance / cleanup endpoints |
| `/notifications` | `routes/notification.js` | Notification feed |
| `/support` | `routes/support.js` | Support ticket endpoints |
| `/external-psp` | `routes/externalPsp.js` | Optional companion service hooks |
| `/webhook` | `routes/webhook.js` | Webhook receivers |

---

## Models (`models/`)

| Collection | Purpose |
|---|---|
| `User` | Email-based identity (PSPs + admin roles) |
| `PSPProfile` | Onboarding state, segment, wallet binding (one per PSP) |
| `Facility` | One per pool — request → approval → init → active lifecycle, per-PSP counter |
| `Lender` | Wallet-only identity, lazily created on first sign-in or code redemption |
| `AccessCode` | One-time invite codes minted by on-chain admin |
| `FinancingRequest` | Off-chain drawdown intent (later linked to on-chain `Drawdown`) |
| `RepaymentRecord` | Off-chain audit trail of completed repayments |
| `PoolState`, `DrawdownState` | Mongo mirror of on-chain account state (refreshed by the indexer) |
| `AuthNonce` | Single-use nonces for wallet-sig sign-in |
| `RelayUsage` | Audit of fee-payer relay submissions |
| `FaucetClaim` | Audit of faucet drips |
| `Segment` | Tech-integration tier (rate / cap defaults) |
| Legacy + companion: `OrderBook`, `EfficientDeposit`, `EfficientPayout`, `ExternalPSPUser`, `ExternalOrderBook`, `Notification`, `SupportTicket`, `CreditMaintenanceCharge`, `FinancingDocument`, `AuditLog`, `UsedToken` | Onboarding + external-PSP companion flow |

---

## Workers

Started by `index.js` directly:

| Worker | What |
|---|---|
| `solanaIndexer` | Polls `getProgramAccounts` every 15s; mirrors Pool + Drawdown PDAs into Mongo and ingests `repaid: false→true` transitions as `RepaymentRecord` rows |
| `overdueWatcher` | Marks credit lines past their due date |

Started via `config/scheduler.js` (cron):

| Worker | Schedule |
|---|---|
| `creditMaintenanceWorker.processDailyMaintenance` | Daily at midnight (Asia/Karachi) |
| `creditMaintenanceWorker.markOverdueCharges` | Daily at noon |
| `orderbookGenerator.startOrderbookScheduler` | On startup |

Lazy / on-demand workers used by routes: `disbursementAgent`, `financingValidationAgent`, `repaymentAgent`.

---

## Useful scripts

```bash
node scripts/seedAdmins.js                # KAM, CAD, CRO, CFO, Legal accounts (admin123)
node scripts/seedSegments.js              # DEFAULT + CORPORATE segments
node scripts/wipeForMultiFacility.js      # nuke all PSP/facility state for a clean test
node scripts/e2e-devnet.js                # full lifecycle smoke test against devnet
```

---

## Local dev tips

- `nodemon.json` watches `.env` so server restarts when you change env vars.
- Lender JWTs use `kind: 'lender'` shape; PSP/admin use `kind: 'user'`. The auth middleware branches on `kind` to pick `Lender` vs `User` lookup.
- Wallet message signed during sign-in: `Sign in to DeFa\nWallet: <pubkey>\nNonce: <nonce>`. Server constructs this same message in `verifySignature` — they must match exactly.
- The fee-payer relay signs every on-chain tx as feePayer only. Users still sign as authority. Audit rows in `RelayUsage`.
