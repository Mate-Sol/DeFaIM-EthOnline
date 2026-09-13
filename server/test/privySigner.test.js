'use strict';

/**
 * Tests for the Privy-backed agent signer.
 *
 * The signer holds AGENT2_ROLE, which is the one server-side authority that
 * can move lender capital. What matters here is that the transaction we hand
 * to Privy is the transaction ethers asked us to sign — a dropped `data`
 * field or a mangled chain id would produce a valid signature over the wrong
 * intent — and that a policy denial is distinguishable from an outage.
 */

const test = require('node:test');
const assert = require('node:assert');
const { ethers } = require('ethers');
const { PrivySigner, agentPolicyDocument } = require('../services/privySigner');

const BASE = {
  appId: 'app-123',
  appSecret: 'secret-456',
  walletId: 'wallet-789',
  address: '0x0b9dDfcdB31aEf5Cde26d0E6DbAc6917B6849f05',
};

// ── transaction mapping ─────────────────────────────────────────────────

test('PRIVY · a contract call keeps its calldata and chain id', () => {
  const out = PrivySigner.toPrivyTransaction({
    to: '0x71300bA34A75B5Cc788F324aCf775767Dd215A06',
    data: '0xabcdef',
    value: 0n,
    chainId: 5042002n,
    nonce: 7,
    gasLimit: 500000n,
  });
  assert.strictEqual(out.data, '0xabcdef');
  assert.strictEqual(out.chain_id, 5042002);
  assert.strictEqual(out.nonce, 7);
  assert.strictEqual(out.to, '0x71300bA34A75B5Cc788F324aCf775767Dd215A06');
});

test('PRIVY · empty calldata is omitted rather than sent as 0x', () => {
  const out = PrivySigner.toPrivyTransaction({ to: BASE.address, data: '0x', chainId: 1 });
  assert.ok(!('data' in out));
});

test('PRIVY · null and undefined fields are dropped, not sent as null', () => {
  // The API rejects nulls as malformed; sending them turns a working call
  // into an opaque 400.
  const out = PrivySigner.toPrivyTransaction({
    to: BASE.address, chainId: 1, nonce: null, gasLimit: undefined, maxFeePerGas: null,
  });
  assert.ok(!('nonce' in out));
  assert.ok(!('gas_limit' in out));
  assert.ok(!('max_fee_per_gas' in out));
});

test('PRIVY · amounts are hex-encoded', () => {
  const out = PrivySigner.toPrivyTransaction({ to: BASE.address, value: 1000n, chainId: 1 });
  assert.strictEqual(out.value, '0x3e8');
});

test('PRIVY · the recipient is checksummed', () => {
  const out = PrivySigner.toPrivyTransaction({ to: BASE.address.toLowerCase(), chainId: 1 });
  assert.strictEqual(out.to, ethers.getAddress(BASE.address));
});

// ── construction ────────────────────────────────────────────────────────

test('PRIVY · refuses to construct without complete credentials', () => {
  assert.throws(() => new PrivySigner({ ...BASE, appSecret: '' }), /appId and appSecret/);
  assert.throws(() => new PrivySigner({ ...BASE, walletId: '' }), /walletId/);
  assert.throws(() => new PrivySigner({ ...BASE, address: '' }), /address/);
});

test('PRIVY · exposes the wallet address as the signer address', async () => {
  const s = new PrivySigner(BASE);
  assert.strictEqual(await s.getAddress(), ethers.getAddress(BASE.address));
});

test('PRIVY · connect() preserves credentials', () => {
  const s = new PrivySigner(BASE).connect(null);
  assert.strictEqual(s.walletId, BASE.walletId);
  assert.strictEqual(s.address, ethers.getAddress(BASE.address));
});

// ── error handling ──────────────────────────────────────────────────────

test('PRIVY · a 403 is marked as a policy denial, not a transport failure', async () => {
  const s = new PrivySigner(BASE);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'denied by policy' }), { status: 403 });
  try {
    await assert.rejects(
      () => s.signTransaction({ to: BASE.address, chainId: 5042002 }),
      (e) => e.policyDenied === true && /denied by policy/.test(e.message),
    );
  } finally { globalThis.fetch = realFetch; }
});

test('PRIVY · a 500 is not mistaken for a policy denial', async () => {
  const s = new PrivySigner(BASE);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('upstream boom', { status: 500 });
  try {
    await assert.rejects(
      () => s.signTransaction({ to: BASE.address, chainId: 5042002 }),
      (e) => e.policyDenied === false && e.status === 500,
    );
  } finally { globalThis.fetch = realFetch; }
});

test('PRIVY · a success with no signature is an error, not a silent undefined', async () => {
  // Returning undefined here would have ethers broadcast garbage.
  const s = new PrivySigner(BASE);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: {} }), { status: 200 });
  try {
    await assert.rejects(() => s.signTransaction({ to: BASE.address, chainId: 5042002 }), /no signed transaction/);
  } finally { globalThis.fetch = realFetch; }
});

test('PRIVY · the signed transaction is returned verbatim', async () => {
  const s = new PrivySigner(BASE);
  const realFetch = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = JSON.parse(init.body);
    return new Response(JSON.stringify({ data: { signed_transaction: '0xdeadbeef' } }), { status: 200 });
  };
  try {
    const raw = await s.signTransaction({ to: BASE.address, data: '0x1234', chainId: 5042002 });
    assert.strictEqual(raw, '0xdeadbeef');
    assert.strictEqual(seen.method, 'eth_signTransaction');
    assert.strictEqual(seen.caip2, 'eip155:5042002');
    assert.strictEqual(seen.params.transaction.data, '0x1234');
  } finally { globalThis.fetch = realFetch; }
});

// ── policy ──────────────────────────────────────────────────────────────

test('POLICY · denies any transaction carrying native value', () => {
  // On Arc, USDC is the native token — value is money leaving the wallet.
  const doc = agentPolicyDocument({ chainId: 5042002 });
  const deny = doc.rules.find((r) => r.action === 'DENY');
  assert.ok(deny, 'expected a DENY rule');
  const cond = deny.conditions[0];
  assert.strictEqual(cond.field, 'value');
  assert.strictEqual(cond.operator, 'gt');
  assert.strictEqual(cond.value, '0');
});

test('POLICY · allows zero-value calls, scoped to our chain', () => {
  const doc = agentPolicyDocument({ chainId: 5042002 });
  const allow = doc.rules.find((r) => r.action === 'ALLOW');
  assert.strictEqual(allow.conditions[0].field, 'chain_id');
  assert.strictEqual(allow.conditions[0].value, '5042002');
});

test('POLICY · the deny rule is ordered before the allow rule', () => {
  // An allow evaluated first would let a value-carrying transaction through.
  const doc = agentPolicyDocument({});
  assert.strictEqual(doc.rules[0].action, 'DENY');
});
