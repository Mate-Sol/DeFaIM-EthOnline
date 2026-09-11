/**
 * Regression tests for borrower-wallet resolution at pool-deploy time.
 *
 * The bug this guards: `Facility.pspWallet` is stamped when the facility is
 * *requested*. A PSP who binds their wallet afterwards — or whose profile
 * still carried an operator's seeded address — kept the stale value all the
 * way to `createPool`, minting a pool whose borrower could never draw down or
 * repay. Nothing looked wrong until the PSP tried and the call reverted.
 *
 * Deploy-time resolution must prefer the profile's live binding, but must
 * never rewrite a facility whose pool already exists: that borrower is fixed
 * on chain and the stamped address is the historical record.
 */

const test = require('node:test');
const assert = require('node:assert');
const { pickBorrowerWallet } = require('../routes/poolTx');

const AWAIS = '0xAd8783aF69bD72eEf8f7e4ec3dc514cD5116c656';
const SEEDED = '0x0b9dDfcdB31aEf5Cde26d0E6DbAc6917B6849f05';

test('BORROWER · live binding overrides the address stamped at request time', () => {
  const r = pickBorrowerWallet({ stamped: SEEDED, bound: AWAIS, hasPool: false });
  assert.strictEqual(r.wallet, AWAIS);
  assert.strictEqual(r.changed, true, 'the facility must be corrected too');
});

test('BORROWER · a deployed pool is never re-pointed', () => {
  // The on-chain borrower cannot change, so neither may the stamped value.
  const r = pickBorrowerWallet({ stamped: SEEDED, bound: AWAIS, hasPool: true });
  assert.strictEqual(r.wallet, SEEDED);
  assert.strictEqual(r.changed, false);
});

test('BORROWER · an unbound PSP falls back to the stamped address', () => {
  const r = pickBorrowerWallet({ stamped: SEEDED, bound: '', hasPool: false });
  assert.strictEqual(r.wallet, SEEDED);
  assert.strictEqual(r.changed, false, 'no binding is not a reason to write');
});

test('BORROWER · agreement writes nothing, whatever the casing', () => {
  const r = pickBorrowerWallet({ stamped: AWAIS.toLowerCase(), bound: AWAIS, hasPool: false });
  assert.strictEqual(r.changed, false);
});

test('BORROWER · a malformed binding never displaces a good address', () => {
  const r = pickBorrowerWallet({ stamped: AWAIS, bound: 'not-an-address', hasPool: false });
  assert.strictEqual(r.wallet, AWAIS);
  assert.strictEqual(r.changed, false);
});

test('BORROWER · neither side set yields empty, so the caller can 400', () => {
  const r = pickBorrowerWallet({ stamped: '', bound: '', hasPool: false });
  assert.strictEqual(r.wallet, '');
});

// ── Binding confirmation ────────────────────────────────────────────────

const { hasConfirmedBinding } = require('../routes/poolTx');

test('BINDING · a seeded primaryWallet is not a confirmed binding', () => {
  // Seeding writes primaryWallet directly and leaves the array empty. This is
  // the exact shape that let three pools deploy against the wrong borrower:
  // the address looks bound, but nobody ever signed for it.
  assert.strictEqual(
    hasConfirmedBinding({ primaryWallet: SEEDED, walletAddress: [] }),
    false,
  );
});

test('BINDING · a signed bind counts', () => {
  assert.strictEqual(
    hasConfirmedBinding({ primaryWallet: AWAIS, walletAddress: [{ address: AWAIS, name: 'Primary Wallet' }] }),
    true,
  );
});

test('BINDING · a stale array entry does not vouch for a different primary', () => {
  // Rebinding moves primaryWallet; an old entry left in the array must not
  // make the new address look confirmed.
  assert.strictEqual(
    hasConfirmedBinding({ primaryWallet: SEEDED, walletAddress: [{ address: AWAIS }] }),
    false,
  );
});

test('BINDING · casing differences still match', () => {
  assert.strictEqual(
    hasConfirmedBinding({ primaryWallet: AWAIS, walletAddress: [{ address: AWAIS.toLowerCase() }] }),
    true,
  );
});

test('BINDING · no profile and no wallet are both unconfirmed', () => {
  assert.strictEqual(hasConfirmedBinding(null), false);
  assert.strictEqual(hasConfirmedBinding({ primaryWallet: '', walletAddress: [] }), false);
});
