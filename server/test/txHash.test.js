/**
 * test/txHash.test.js — guard for the on-chain hash sanitiser.
 *
 * Anything not matching the strict 0x-hex shape must be rejected: the system
 * historically wrote `OFFCHAIN-${Date.now()}` into RepaymentRecord.txHash and
 * the SAFE-Observer treated those synthetic ids as real on-chain hashes,
 * which broke the unmapped-vault matching. This test pins the sanitiser
 * behaviour so it doesn't regress.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isRealTxHash } = require('../utils/txHash');

test('isRealTxHash: accepts 0x-prefixed hex (any length)', () => {
  assert.equal(isRealTxHash('0xabc123'), true);
  assert.equal(
    isRealTxHash(
      '0x9fca4d000000000000000000000000000000000000000000000000000092d2b8'
    ),
    true,
  );
  assert.equal(isRealTxHash('0xABCDEF1234567890'), true); // uppercase ok
});

test('isRealTxHash: rejects OFFCHAIN- placeholders (the historical bug)', () => {
  assert.equal(isRealTxHash('OFFCHAIN-1776082925850'), false);
  assert.equal(isRealTxHash('OFFCHAIN-' + Date.now()), false);
});

test('isRealTxHash: rejects nullish / empty / non-hex', () => {
  assert.equal(isRealTxHash(null), false);
  assert.equal(isRealTxHash(undefined), false);
  assert.equal(isRealTxHash(''), false);
  assert.equal(isRealTxHash('0x'), false); // prefix only, no body
  assert.equal(isRealTxHash('not-a-hash'), false);
  assert.equal(isRealTxHash('0xZZZ'), false); // non-hex chars
  assert.equal(isRealTxHash(12345), false); // not a string
  assert.equal(isRealTxHash({ hash: '0xabc' }), false); // not a string
});
