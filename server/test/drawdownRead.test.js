/**
 * Regression tests for reading a pool's open drawdowns.
 *
 * The bug this guards: the chain fallback scanned DrawdownExecuted logs over a
 * fixed 20,000-block lookback — a few hours on Arc. A drawdown taken four days
 * earlier fell outside the window, so /pool/:pool/drawdowns returned [] for a
 * pool carrying 10 USDC outstanding. The borrower's repay screen showed
 * "no drawdowns" for a debt that was actively accruing penalties, with no way
 * to repay it from the UI.
 *
 * Open drawdowns live in the `drawDownRefs` array (repayment swap-and-pops the
 * entry), so storage is authoritative and needs no window at all.
 */

const test = require('node:test');
const assert = require('node:assert');
const { readOpenDrawdownRefs } = require('../services/poolServiceEvm');

// Solidity reverts on an out-of-bounds array read; that revert is the
// terminator for the walk.
const poolWithRefs = (refs) => ({
  drawDownRefs: async (i) => {
    if (i >= refs.length) throw Object.assign(new Error('missing revert data'), { code: 'CALL_EXCEPTION' });
    return refs[i];
  },
});

test('DRAWDOWN · every open ref is read, regardless of how old it is', async () => {
  // Age is exactly what the old log-window approach got wrong.
  const refs = ['0xaa', '0xbb', '0xcc'];
  assert.deepStrictEqual(await readOpenDrawdownRefs(poolWithRefs(refs)), refs);
});

test('DRAWDOWN · a pool with no drawdowns reads as empty, not as an error', async () => {
  assert.deepStrictEqual(await readOpenDrawdownRefs(poolWithRefs([])), []);
});

test('DRAWDOWN · a single outstanding drawdown is found', async () => {
  // The shape of the pool that exposed this: one ref, days old.
  const one = ['0xb240eb8040d3f48be9923794b3de1cb094b5f8633c30a38188e6cf7ce9b3c93d'];
  assert.deepStrictEqual(await readOpenDrawdownRefs(poolWithRefs(one)), one);
});

test('DRAWDOWN · the walk is bounded so a misbehaving RPC cannot hang it', async () => {
  // An endpoint that never reverts must not spin forever.
  let calls = 0;
  const endless = { drawDownRefs: async () => { calls += 1; return '0xff'; } };
  const out = await readOpenDrawdownRefs(endless);
  assert.ok(out.length <= 256, 'walk must stop at the cap');
  assert.strictEqual(calls, out.length);
});

// ── ABI coverage ────────────────────────────────────────────────────────

const { getPool } = require('../services/poolServiceEvm');

/**
 * The server keeps its own hand-written human-readable ABI, separate from the
 * JSON the Subgraph uses. When a read is written against the JSON but the
 * server's copy lacks the function, the call throws — and here that throw was
 * indistinguishable from "end of array", so the storage walk silently returned
 * nothing. The fix looked deployed while changing nothing at all.
 */
test('DRAWDOWN · the server ABI exposes every function the reader calls', () => {
  const pool = getPool('0x71300bA34A75B5Cc788F324aCf775767Dd215A06');
  const names = pool.interface.fragments
    .filter((f) => f.type === 'function')
    .map((f) => f.name);
  for (const fn of ['drawDownRefs', 'getDrawDown', 'getRepaymentOwed', 'outstanding']) {
    assert.ok(names.includes(fn), `server ABI is missing ${fn}()`);
  }
});
