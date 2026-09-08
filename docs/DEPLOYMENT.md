# Deployment

Four images. Everything targets Arc Testnet (chain `5042002`).

| Service | Path | Port | Notes |
|---|---|---|---|
| Backend API | `server/` | 5090 | Node 22, needs MongoDB |
| Lender client | `web/lender/` | 8081 | static, nginx |
| PSP + admin portal | `web/portal/` | 8080 | static, nginx |
| External PSP portal | `web/external-psp/` | 8082 | static, nginx |

All four build from their own `Dockerfile` with no build args:

```
docker build -t defa-server        ./server
docker build -t defa-lender        ./web/lender
docker build -t defa-portal        ./web/portal
docker build -t defa-external-psp  ./web/external-psp
```

## Frontend configuration

Vite bakes `VITE_*` into the static bundle **at build time**, so the three
clients are configured by `.env.production`, which is committed. Those files
hold only public values — contract addresses, a public RPC, the API base URL.
There are no frontend secrets.

Changing an API hostname or a contract address therefore means editing
`.env.production` and **rebuilding the image**; setting an environment
variable on a running container has no effect.

Before deploying, set `VITE_API_URL` in each client's `.env.production` to the
backend's public URL, and put a real WalletConnect project id from
cloud.reown.com into `web/lender/.env.production` — the committed placeholder
makes the WalletConnect modal return 403. Injected MetaMask works regardless.

## Backend configuration

The API is configured at runtime. Required:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Session signing key |
| `EVM_CHAIN_ID` | `5042002` (Arc Testnet) |
| `EVM_RPC_URL` | `https://rpc.testnet.arc.io` |
| `PAYFI_FACTORY_ADDRESS` | see `docs/DEPLOYMENTS.md` |
| `PAYFI_TREASURY_ADDRESS` | see `docs/DEPLOYMENTS.md` |
| `PAYFI_STABLECOIN_ADDRESS` | `0x36000000...0000` — Arc's native USDC |
| `AGENT_PRIVATE_KEY` | server signer; holds AGENT2, executes drawdowns |
| `ONCHAIN_ADMIN_WALLETS` | comma-separated allowlist for the admin routes |
| `FRONTEND_URL` | lender origin, for CORS and SIWE |
| `EXTRA_CORS_ORIGINS` | comma-separated additional origins (portal, external PSP) |

Optional, with sensible defaults:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 5050 | image sets 5090 |
| `EVM_INDEXER_INTERVAL_MS` | 30000 | indexer poll interval |
| `EVM_INDEXER_WINDOW_BLOCKS` | 5000 | log scan window; Arc produces ~2 blocks/s |
| `EVM_RPC_BATCH_SIZE` | 5 | view calls issued per wave |
| `EVM_RPC_BATCH_PAUSE_MS` | 120 | pause between waves |
| `POOL_CACHE_STALE_MS` | 180000 | how long an indexed snapshot serves `/pools` |
| `PUBLIC_DEMO_CODE` | — | seeds a lender access code |

`AGENT_PRIVATE_KEY` and `JWT_SECRET` are the only secrets. They belong in the
cluster's secret store, never in the repo.

### A note on RPC limits

Arc's public RPC throttles bursts. The indexer batches its view calls and the
marketplace serves from indexed state rather than reading the chain per
request, which is enough for the public endpoint. A dedicated endpoint
(Blockdaemon, dRPC, QuickNode) gives more headroom; raise `EVM_RPC_BATCH_SIZE`
and lower `EVM_RPC_BATCH_PAUSE_MS` if you move to one.

## First run

The backend needs seeding once against a fresh database:

```
node scripts/seedAdmins.js                       # KAM / CAD / CRO / CFO / legal / viewer
node scripts/seedSegments.js                     # risk segments
PUBLIC_DEMO_CODE=654321 node scripts/seedPublicDemoCode.js
```

## Health

`GET /pools` returns the indexed facilities and is a good readiness probe: it
answers from MongoDB and does not depend on the RPC being reachable.

## MongoDB

The API needs a MongoDB it can reach from the cluster. Anything that speaks
the wire protocol works — Atlas, a managed instance, or one running in the
cluster. Provide it as `MONGODB_URI`.

Atlas is the quickest route for a hosted deployment:

1. Create a project and an **M0** (free) cluster in the region closest to the
   API.
2. Database Access → add a user with **Read and write to any database**.
3. Network Access → allow the cluster's egress IP, or `0.0.0.0/0` for a demo
   environment.
4. Connect → Drivers → copy the connection string and append the database
   name:

```
mongodb+srv://<user>:<password>@<cluster>.mongodb.net/defa?retryWrites=true&w=majority
```

Store it as a secret; it contains a password.

Sizing is modest — the API keeps user, facility, pool-snapshot and drawdown
documents, all small. M0's 512 MB is enough for a demo, but note that when an
M0 hits its quota the symptom is *write* failures that surface as login
timeouts rather than an obvious storage error, so give a long-lived deployment
a paid tier.

The indexer writes one document per pool per poll. Nothing in the schema grows
per request.
