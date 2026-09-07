/**
 * End-to-end integration tests for every flow currently wired.
 *
 * Hits the LIVE local stack:
 *   - Mongo on localhost:27017
 *   - Anvil on localhost:8545
 *   - This server on the port from env PORT (default 5050)
 *
 * Run with:  npm run test:e2e
 * or:        API=http://127.0.0.1:5050 node --test test/e2eFlows.test.js
 *
 * Each flow is a discrete test case that prints its pass/fail status.
 * Tests are ORDERED — signup happens before login, list before deposit.
 * Uses node:test + node's native fetch (no extra deps).
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const API = process.env.API || 'http://127.0.0.1:5050';

// Random suffix so signup emails don't collide across runs.
const RUN_ID = Math.random().toString(36).slice(2, 8);

// The access code seeded per db (polygon = 123456, arc = 654321). Env-overridable.
const ACCESS_CODE = process.env.ACCESS_CODE || '123456';

// Anvil default account #3 — used only to prove /faucet works; not signed here.
const DEMO_WALLET = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

const state = {
  jwt: null,
  lender: null,
  poolAddress: null,
};

// ── helpers ────────────────────────────────────────────────────────────

async function api(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.jwt) headers.Authorization = state.jwt;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// Seed a fresh access code so signup tests are idempotent even after
// prior runs consumed the demo one. Also cleans up test lenders from
// prior runs so email-uniqueness doesn't 409 us.
async function seedAccessCode(code) {
  const { MongoClient } = require('mongodb');
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/defa-polygon-local';
  const client = await MongoClient.connect(uri);
  const db = client.db();
  // Reset the access code
  await db.collection('accesscodes').deleteMany({ code });
  await db.collection('accesscodes').insertOne({
    code,
    label: `e2e-test-${RUN_ID}`,
    usedAt: null,
    expiresAt: new Date(Date.now() + 3600_000),
    createdBy: 'e2e',
    createdAt: new Date(),
  });
  // Purge any lender records from prior e2e runs (kept the code separately
  // per run via RUN_ID, but earlier runs may have used other suffixes).
  await db.collection('lenders').deleteMany({
    email: { $regex: /^e2e-.*@local$/ },
  });
  await client.close();
}

// ── Auth flow ──────────────────────────────────────────────────────────

test('AUTH · POST /users/apply-referral (valid code) → { valid: true }', async () => {
  await seedAccessCode(ACCESS_CODE);
  const { status, data } = await api('POST', '/users/apply-referral', { refercode: ACCESS_CODE });
  assert.strictEqual(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.valid, true);
  assert.strictEqual(data.refercode, ACCESS_CODE);
});

test('AUTH · POST /users/apply-referral (invalid code) → 400', async () => {
  const { status, data } = await api('POST', '/users/apply-referral', { refercode: 'DOESNOTEXIST' });
  assert.strictEqual(status, 400);
  assert.match(data.message || '', /invalid|expired/i);
});

test('AUTH · POST /users/create-user (atomic signup)', async () => {
  await seedAccessCode(ACCESS_CODE);
  const email = `e2e-${RUN_ID}@local`;
  const { status, data } = await api('POST', '/users/create-user', {
    userName: `E2E Tester ${RUN_ID}`,
    email,
    password: 'Passw0rd!',
    refercode: ACCESS_CODE,
  });
  assert.strictEqual(status, 200, `expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert.ok(data.token, 'must return token');
  assert.ok(data.data?._id, 'must return lender data');
  assert.strictEqual(data.data.email, email);
  state.jwt = data.token;
  state.lender = data.data;
});

test('AUTH · POST /users/login-user (existing account)', async () => {
  const email = state.lender.email;
  const { status, data } = await api('POST', '/users/login-user', {
    email,
    password: 'Passw0rd!',
  });
  assert.strictEqual(status, 200);
  assert.ok(data.token);
  assert.strictEqual(data.data.email, email);
});

test('AUTH · POST /users/login-user (wrong password) → 401', async () => {
  const email = state.lender.email;
  const { status, data } = await api('POST', '/users/login-user', {
    email,
    password: 'WRONG',
  });
  assert.strictEqual(status, 401);
});

test('AUTH · POST /users/create-user (reused code) → 400', async () => {
  const { status, data } = await api('POST', '/users/create-user', {
    userName: 'Different Tester',
    email: `e2e-second-${RUN_ID}@local`,
    password: 'Passw0rd!',
    refercode: ACCESS_CODE,   // already consumed above
  });
  assert.strictEqual(status, 400);
  assert.match(data.message || '', /invalid|used|expired/i);
});

// ── Marketplace flow (public reads, no auth needed) ────────────────────

test('MARKET · GET /pools returns >=1 pool', async () => {
  const { status, data } = await api('GET', '/pools');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(data), 'must be array');
  assert.ok(data.length >= 1, `expected at least 1 pool, got ${data.length}`);
  state.poolAddress = data[0].pubkey;
});

test('MARKET · POST /marketPlaces/getAlldealsnew (v2 shim)', async () => {
  const { status, data } = await api('POST', '/marketPlaces/getAlldealsnew?page=1&limit=10&status=All',
    { id: 'x', role: 2 });
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(data.data), 'must have data[] array');
  assert.ok(data.pagination?.totalPages >= 1, 'must have pagination.totalPages');
  const deal = data.data[0];
  assert.ok(deal._id?.startsWith('0x'), '_id must be an EVM address');
  assert.ok(deal.poolName, 'must have poolName');
  assert.ok(deal.overview?.loanAmount > 0, 'overview.loanAmount must be positive');
});

test('MARKET · GET /marketPlaces/getDealsById/:addr (v2 shim)', async () => {
  const { status, data } = await api('GET', `/marketPlaces/getDealsById/${state.poolAddress}`);
  assert.strictEqual(status, 200);
  assert.strictEqual(data._id, state.poolAddress);
  assert.ok(data.overview?.loanAmount > 0);
  assert.ok(['Low', 'Medium', 'High'].includes(data.poolRiskLevel));
});

test('MARKET · GET /pool/:pool/state (raw payfi_v1 state)', async () => {
  const { status, data } = await api('GET', `/pool/${state.poolAddress}/state`);
  assert.strictEqual(status, 200);
  assert.strictEqual(data.pubkey, state.poolAddress);
  assert.ok(data.hardCap, 'must have hardCap');
  assert.ok(typeof data.softCap === 'string');
});

// ── Lender deposit build-tx flow (auth required) ───────────────────────

test('DEPOSIT · POST /pool/lender/build-tx/deposit → { steps: [approve, deposit] }', async () => {
  const { status, data } = await api('POST', '/pool/lender/build-tx/deposit', {
    pool: state.poolAddress,
    amount: '100', // 100 USDC decimal
  });
  assert.strictEqual(status, 200, `got ${status}: ${JSON.stringify(data)}`);
  assert.ok(Array.isArray(data.steps), 'must have steps[]');
  assert.strictEqual(data.steps.length, 2, 'must be 2 steps (approve + deposit)');
  const approve = data.steps[0];
  const deposit = data.steps[1];
  assert.match(approve.label, /approve/i);
  assert.match(deposit.label, /deposit/i);
  // approve.to must be the stablecoin address
  assert.match(approve.tx.data, /^0x095ea7b3/, 'approve calldata must start with 0x095ea7b3 (approve selector)');
  // deposit.to must be the pool address; selector must be keccak256(deposit(uint256))
  assert.strictEqual(deposit.tx.to, state.poolAddress);
  assert.match(deposit.tx.data, /^0xb6b55f25/, 'deposit calldata must start with 0xb6b55f25 (deposit selector)');
});

test('DEPOSIT · POST /pool/lender/build-tx/deposit (missing pool) → 400', async () => {
  const { status } = await api('POST', '/pool/lender/build-tx/deposit', { amount: '100' });
  assert.strictEqual(status, 400);
});

// ── Faucet ─────────────────────────────────────────────────────────────

test('FAUCET · POST /faucet/usdc-df mints 1M USDC (server-signed)', async () => {
  const { status, data } = await api('POST', '/faucet/usdc-df', { wallet: DEMO_WALLET });
  // status could be 200 OR 429 if we hit lifetime cap from prior runs
  if (status === 429) {
    assert.match(data.message, /cap|cooldown/i);
    console.log('    (429 = expected if run repeatedly — lifetime cap)');
    return;
  }
  assert.strictEqual(status, 200, `got ${status}: ${JSON.stringify(data)}`);
  assert.strictEqual(data.success, true);
  assert.ok(data.txHash?.startsWith('0x'));
  assert.strictEqual(data.amount, '1000000000000'); // 1M with 6 decimals
});

// ── Admin build-tx flow (calldata correctness, not signing) ────────────

test('ADMIN · POST /admin/build-tx/approve-psp (unauthorized) → 403', async () => {
  const { status } = await api('POST', '/admin/build-tx/approve-psp',
    { pspWallet: '0x1111111111111111111111111111111111111111' });
  // authMiddleware — 401 if no JWT, 403 if not onchain admin. We are a lender.
  assert.ok([401, 403].includes(status), `expected 401 or 403, got ${status}`);
});

// ── Stubbed endpoints (per B3a) ────────────────────────────────────────

test('STUB · GET /pool/:pool/activity → 501', async () => {
  const { status, data } = await api('GET', `/pool/${state.poolAddress}/activity`);
  assert.strictEqual(status, 501);
  assert.match(data.message, /not yet implemented/i);
});

test('STUB · GET /pool/:pool/daily-activity → 501', async () => {
  const { status } = await api('GET', `/pool/${state.poolAddress}/daily-activity`);
  assert.strictEqual(status, 501);
});

test('STUB · GET /pool/:pool/fee-aggregates → 501', async () => {
  const { status } = await api('GET', `/pool/${state.poolAddress}/fee-aggregates`);
  assert.strictEqual(status, 501);
});

// ── Rate limiter smoke ─────────────────────────────────────────────────

test('SANITY · Server hosts /marketPlaces route (mount ordering)', async () => {
  const { status } = await api('POST', '/marketPlaces/getAlldealsnew', {});
  assert.notStrictEqual(status, 404, 'route must be mounted (got 404 — check server/index.js)');
});
