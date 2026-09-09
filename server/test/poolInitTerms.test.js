/**
 * Regression tests for the Facility → createPool param flattening.
 *
 * The bug this guards: /admin/build-tx/initialize-pool spread the Facility doc
 * flat (`{ ...fac, ...body }`), but every economic term lives nested under
 * `requestedTerms` / `approvedTerms`. softCap and hardCap therefore arrived
 * undefined and the call 400'd with "softCap / hardCap required" — and had a
 * caller supplied caps by hand, the pool would have deployed on the encoder's
 * default 5/20/50 bps rates instead of the terms the CRO actually locked.
 */

const test = require('node:test');
const assert = require('node:assert');
const { mergeFacilityTerms } = require('../routes/poolTx');

// Shaped like a real AWAITING_POOL_INIT facility: the PSP asked for a credit
// line and tenor only, the CRO filled in the rates and defaulted the caps.
const facility = {
  _id: '6aa173e44fb0bfc0348dca43',
  facilityId: 1,
  pspWallet: '0xAd8783aF69bD72eEf8f7e4ec3dc514cD5116c656',
  status: 'AWAITING_POOL_INIT',
  requestedTerms: {
    creditLine: 20,
    tenorDays: 30,
    utilizationRateBps: null,
    commitmentRateBps: null,
    penaltyRateBps: null,
    graceDays: null,
  },
  approvedTerms: {
    creditLine: 20,
    tenorDays: 30,
    utilizationRateBps: 10,
    commitmentRateBps: 1,
    penaltyRateBps: 20,
    graceDays: 0,
    softCap: 20,
    hardCap: 20,
  },
};

test('INIT-TERMS · caps surface from approvedTerms', () => {
  const merged = mergeFacilityTerms(facility, {});
  assert.strictEqual(merged.softCap, 20, 'softCap must not be undefined');
  assert.strictEqual(merged.hardCap, 20, 'hardCap must not be undefined');
});

test('INIT-TERMS · CRO rates reach the encoder, not the defaults', () => {
  const merged = mergeFacilityTerms(facility, {});
  assert.strictEqual(merged.utilizationRateBps, 10);
  assert.strictEqual(merged.commitmentRateBps, 1);
  assert.strictEqual(merged.penaltyRateBps, 20);
});

test('INIT-TERMS · tenor is carried as tenorDays for the tenure param', () => {
  const merged = mergeFacilityTerms(facility, {});
  assert.strictEqual(merged.tenorDays, 30);
});

test('INIT-TERMS · pspWallet survives the merge', () => {
  const merged = mergeFacilityTerms(facility, {});
  assert.strictEqual(merged.pspWallet, facility.pspWallet);
});

test('INIT-TERMS · approved terms beat requested terms', () => {
  const merged = mergeFacilityTerms(
    { ...facility, requestedTerms: { ...facility.requestedTerms, creditLine: 999 } },
    {},
  );
  assert.strictEqual(merged.creditLine, 20, 'CRO-approved credit line wins');
});

test('INIT-TERMS · an unset approved term falls back to the requested one', () => {
  // The CRO screen does not collect every field; a null it leaves behind must
  // not shadow a value the PSP did supply.
  const f = {
    ...facility,
    requestedTerms: { ...facility.requestedTerms, graceDays: 3 },
    approvedTerms: { ...facility.approvedTerms, graceDays: null },
  };
  assert.strictEqual(mergeFacilityTerms(f, {}).graceDays, 3);
});

test('INIT-TERMS · explicit request body overrides everything', () => {
  const merged = mergeFacilityTerms(facility, { softCap: 5, hardCap: 50 });
  assert.strictEqual(merged.softCap, 5);
  assert.strictEqual(merged.hardCap, 50);
});

test('INIT-TERMS · a facility with no approvedTerms still yields requested ones', () => {
  const merged = mergeFacilityTerms(
    { pspWallet: facility.pspWallet, requestedTerms: { creditLine: 20, tenorDays: 30 } },
    {},
  );
  assert.strictEqual(merged.creditLine, 20);
  assert.strictEqual(merged.tenorDays, 30);
});
