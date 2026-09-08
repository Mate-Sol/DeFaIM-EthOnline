# Deployment

Four images. Everything targets Arc Testnet (chain `5042002`).

| Service | Path | Port | Deployment | Notes |
|---|---|---|---|---|
| Backend API | `server/` | 5050 | `arc-be` | Node 22, needs MongoDB |
| Lender client | `web/lender/` | 8081 | `arc-ui` | static, nginx |
| PSP + admin client | `web/portal/` | 8080 | `arc-admin` | static, nginx |
| PSP order book | `web/external-psp/` | 8082 | — | static, nginx; not deployed |

`web/portal` is **one application serving both the borrower and every admin
role**. KAM, CAD, CRO, CFO, Legal, view-only admin and PSP all sign in at the
same `/login`; the role on the account decides what they can reach. There is
no separate admin build. The only separate entry point is
`/onchain-admin/login`, which authenticates by wallet signature rather than
password.

`web/external-psp` is a standalone counterparty app, not part of the DeFa
product surface. It was not deployed alongside the others previously; deploy
it only if the external-PSP flow is being demonstrated.

## Ingress

This reuses the Arc hackathon stack rather than standing up a new one: same
beta cluster, same `arc-hackathon` namespace, same image and deployment names,
same hostnames and DNS. The names stay `arc-*` because they describe the chain,
which has not changed.

| Hostname | Routes to |
|---|---|
| `defa-arc-hackathon.invoicemate.net` | `/` → `arc-ui` · `/api` → `arc-be` |
| `defa-arc-hackathon-admin.invoicemate.net` | `/` → `arc-admin` |

The backend mounts its routes at the root (`/auth`, `/pools`, `/admin`, …) and
knows nothing about `/api`, so the ingress strips that prefix before
forwarding. This already works — it is how the previous deployment was wired.

## Pipeline

`.github/workflows/deploy.yml` builds, scans and rolls out on every push to
`beta`. It is the Arc pipeline with the build contexts repointed at this
repo's layout. Tests live in `ci.yml` and are not repeated there.

Four repository secrets are required, all of which already exist on the Arc
repo:

| Secret | Purpose |
|---|---|
| `DOCKER_UNAME` / `DOCKER_PASS` | Docker Hub push |
| `BETA_GKE_WIF_PROVIDER` / `BETA_GKE_GKE_SA` | GKE workload identity |

`GITLEAKS_LICENSE` is **not** needed: the secret scan runs the MIT-licensed
gitleaks CLI rather than the licensed action.

### What must change in the cluster

The deployments already exist; only the backend's Secret needs updating,
because the contracts are new:

```
PAYFI_FACTORY_ADDRESS    0xB5AB6FD1672642cfafcf6A44b2eEAB712576f466
PAYFI_TREASURY_ADDRESS   0x227D4F1F50162b5bEe0567AdBbbb1296061CfE1f
PAYFI_STABLECOIN_ADDRESS 0x3600000000000000000000000000000000000000
EVM_RPC_URL              https://rpc.testnet.arc.io
MONGODB_URI              ...point at a fresh database name, e.g. /defa-ethonline
```

Use a **new database name** on the existing MongoDB. The previous database
holds records keyed on a wallet field that has since been renamed, and pools
from the old factory that no longer exist. Same server, new database, no new
infrastructure.

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
| `PORT` | 5050 | matches the existing Service; leave unset |
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

A fresh database needs seeding once. Set on the deployment:

```
SEED_DEMO_DATA=1
```

The server then seeds itself after connecting — risk segments, the staff
accounts (KAM / CAD / CRO / CFO / Legal / view-only), five borrower accounts
with completed KYB profiles parked across the approval chain, and the lender
access code `654321`. It is idempotent, so the variable can be left set; a
failure there is logged and never stops the server starting.

This exists so seeding needs no shell access to the container. If you do have
`kubectl exec`, `node scripts/seedAll.js` does the same thing, and the
individual scripts under `scripts/` still run standalone.

Accounts, all after seeding:

| Login | Password | Role |
|---|---|---|
| `kam@maildrop.cc`, `cad@`, `cro@`, `cfo@`, `legal@`, `viewer@` | `admin123` | staff |
| `psp1@demo.invoicemate.net` … `psp5@` | `demo123` | borrowers |
| access code `654321` | — | lender app |

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

## Verified locally

All four images have been built and run together against MongoDB and the live
Arc Testnet deployment:

| Image | Size | Check |
|---|---|---|
| `defa-server` | 428 MB | `GET /pools` returned the live facilities |
| `defa-lender` | 106 MB | HTTP 200, SPA fallback on deep routes |
| `defa-portal` | 286 MB | HTTP 200, SPA fallback on deep routes |
| `defa-external-psp` | 76 MB | HTTP 200, SPA fallback on deep routes |

```
docker run -d -p 5090:5090 \
  -e MONGODB_URI=... -e JWT_SECRET=... \
  -e EVM_CHAIN_ID=5042002 -e EVM_RPC_URL=https://rpc.testnet.arc.io \
  -e PAYFI_STABLECOIN_ADDRESS=0x3600000000000000000000000000000000000000 \
  -e PAYFI_FACTORY_ADDRESS=0xB5AB6FD1672642cfafcf6A44b2eEAB712576f466 \
  -e PAYFI_TREASURY_ADDRESS=0x227D4F1F50162b5bEe0567AdBbbb1296061CfE1f \
  defa-server
```

The frontends need no runtime environment — their configuration is baked in at
build time.
