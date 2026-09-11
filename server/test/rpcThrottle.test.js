/**
 * Regression tests for the global RPC throttle.
 *
 * The bug this guards: Arc's public RPC limits sustained request rate and
 * signals refusal as `CALL_EXCEPTION` with `data: null` — indistinguishable at
 * a glance from a contract revert. Reading the facilities list (~250 view
 * calls) tripped it, and the failure surfaced on `poolCount()`, a
 * zero-argument view that cannot revert. Time was lost hunting a revert that
 * did not exist.
 */

const test = require('node:test');
const assert = require('node:assert');

process.env.EVM_RPC_MAX_CONCURRENT = '2';
process.env.EVM_RPC_MIN_GAP_MS = '0';
process.env.EVM_RPC_BACKOFF_MS = '1';
const { throttleProvider, isRateLimited } = require('../config/rpcThrottle');

const rateLimitErr = () => Object.assign(new Error('missing revert data'), {
  code: 'CALL_EXCEPTION', data: null, reason: null,
  info: { error: { code: -32005, message: 'rate limit exceeded' } },
});

test('THROTTLE · a refused call is recognised, not read as a revert', () => {
  assert.strictEqual(isRateLimited(rateLimitErr()), true);
  assert.strictEqual(isRateLimited(Object.assign(new Error('x'), { info: { error: { code: -32005 } } })), true);
});

test('THROTTLE · a genuine revert is not mistaken for throttling', () => {
  // Real reverts carry ABI-encoded reason bytes. Retrying these would only
  // delay a deterministic failure.
  const revert = Object.assign(new Error('execution reverted: Factory: PSP not approved'), {
    code: 'CALL_EXCEPTION',
    data: '0x08c379a0',
    reason: 'Factory: PSP not approved',
  });
  assert.strictEqual(isRateLimited(revert), false);
});

test('THROTTLE · a throttled request is retried and succeeds', async () => {
  let calls = 0;
  const provider = throttleProvider({
    send: async () => { calls += 1; if (calls < 3) throw rateLimitErr(); return 'ok'; },
  });
  assert.strictEqual(await provider.send('eth_call', []), 'ok');
  assert.strictEqual(calls, 3, 'should retry until the endpoint serves it');
});

test('THROTTLE · a revert fails immediately without burning retries', async () => {
  let calls = 0;
  const provider = throttleProvider({
    send: async () => {
      calls += 1;
      throw Object.assign(new Error('execution reverted'), {
        code: 'CALL_EXCEPTION', data: '0x08c379a0', reason: 'nope',
      });
    },
  });
  await assert.rejects(() => provider.send('eth_call', []), /execution reverted/);
  assert.strictEqual(calls, 1);
});

test('THROTTLE · concurrency never exceeds the cap', async () => {
  let inFlight = 0;
  let peak = 0;
  const provider = throttleProvider({
    send: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return 1;
    },
  });
  await Promise.all(Array.from({ length: 20 }, () => provider.send('eth_call', [])));
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded the cap of 2`);
});

test('THROTTLE · wrapping twice does not double-count capacity', () => {
  const base = { send: async () => 1 };
  const once = throttleProvider(base);
  assert.strictEqual(throttleProvider(once), once);
});

test('THROTTLE · every queued request still completes', async () => {
  const provider = throttleProvider({ send: async (m, p) => p[0] });
  const out = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((n) => provider.send('m', [n])));
  assert.deepStrictEqual(out, [1, 2, 3, 4, 5, 6, 7]);
});
