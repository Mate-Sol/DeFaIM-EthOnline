# Testing

Three test suites, all pointed at the live stack (server + Mongo + testnet RPC).

## Suites

### `test:e2e` — HTTP-only, no wallet, no on-chain writes
`test/e2eFlows.test.js` (18) + `test/lifecycleFlows.test.js` (13)

Covers:
- Auth: register / login / access-code redeem / reused-code rejection
- Marketplace: /pools, /pool/:pool/state, /marketPlaces/getAlldealsnew, /marketPlaces/getDealsById
- Deposit build-tx: calldata generation (approve + deposit)
- Faucet: server-signed mint (this one DOES send an on-chain tx via /faucet)
- Admin gating: rejected without JWT
- Stubs: /pool/:pool/{activity,daily-activity,fee-aggregates} return 501
- Lifecycle: PSP signup → KAM approve → CAD approve → CRO approve+terms → onchain admin gate

Duration: ~30s.

### `test:onchain` — sends real testnet txs
`test/onchainFlows.test.js` (7)

Covers:
- Deployer gas balance check
- factory.approvePsp() — real tx
- factory.createPool() — real tx → pool contract deployed on chain
- BE /pool/:pool/state reads that new pool's on-chain state
- BE /marketPlaces/getDealsById/:addr serves it in v2 shape
- Faucet mints 1M USDC to a fresh address — verified via balanceOf on chain

Duration: ~25s. Costs a small amount of testnet gas per run (~0.02 POL on Amoy, similar on Arc).

### `test:all`
Both suites.

## Environment

The tests read config from env:

| Var | Purpose | Default |
|---|---|---|
| `API` | Backend URL | `http://127.0.0.1:5050` |
| `MONGODB_URI` | Mongo | `mongodb://localhost:27017/defa-polygon-local` |
| `ACCESS_CODE` | Test access code (must exist in DB) | `123456` |
| `EVM_CHAIN_ID` | Chain id | `80002` (Polygon Amoy) |
| `EVM_RPC_URL` | RPC endpoint | Amoy public RPC |
| `AGENT_PRIVATE_KEY` | Signer for on-chain writes in `test:onchain` | Buildathon key |
| `PAYFI_FACTORY_ADDRESS` | Factory contract | Amoy deploy |
| `PAYFI_STABLECOIN_ADDRESS` | MockStablecoin | Amoy deploy |
| `SKIP_ONCHAIN` | Set to `1` to skip on-chain suite in CI | (unset) |

## Run against Amoy

```bash
cd server
API=http://127.0.0.1:5050 \
ACCESS_CODE=123456 \
MONGODB_URI=mongodb://localhost:27017/defa-polygon-amoy \
EVM_CHAIN_ID=80002 \
EVM_RPC_URL=https://rpc-amoy.polygon.technology \
  npm run test:all
```

## Run against Arc

```bash
cd server
API=http://127.0.0.1:5051 \
ACCESS_CODE=654321 \
MONGODB_URI=mongodb://localhost:27017/defa-arc-testnet \
EVM_CHAIN_ID=5042002 \
EVM_RPC_URL=https://rpc.testnet.arc.network \
  npm run test:all
```

## Latest results (verified live)

Both stacks: **38/38 pass**.

| Suite | Amoy | Arc |
|---|---|---|
| e2eFlows | 18/18 | 18/18 |
| lifecycleFlows | 13/13 | 13/13 |
| onchainFlows | 7/7 | 7/7 |

Real transactions confirmed on chain:
- Amoy pool: `0x56Fa3c2C289D52B3FE0E87e2B105dea02fc408F6` (block 41691003)
- Arc pool:  `0x7F6e1d132CD8AfC1ECFaB94fbF0C77e78459b2bE` (block 50752492)
- Real 1M USDC mint proven on both.

## Test cleanup

Each run creates fresh users/facilities per `RUN_ID` (random suffix). To wipe entirely:

```javascript
db.users.deleteMany({email: {$regex: /@local\.test$/}});
db.pspprofiles.deleteMany({});
db.facilities.deleteMany({});
db.lenders.deleteMany({email: {$regex: /^e2e-.*@local\.test$/}});
```
