/**
 * Unit tests for evmIndexer's pure-data mapping. No RPC, no Mongo.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Set env before requiring the indexer module (which pulls in config/chain).
process.env.PAYFI_FACTORY_ADDRESS    = process.env.PAYFI_FACTORY_ADDRESS    || '0x1111111111111111111111111111111111111111';
process.env.PAYFI_STABLECOIN_ADDRESS = process.env.PAYFI_STABLECOIN_ADDRESS || '0x2222222222222222222222222222222222222222';
process.env.PAYFI_TREASURY_ADDRESS   = process.env.PAYFI_TREASURY_ADDRESS   || '0x3333333333333333333333333333333333333333';

const { poolStateToDoc } = require('../workers/evmIndexer');

const POOL_ADDR = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
const PSP_ADDR  = '0xbBBBbBBBbBbbBBbBBBbBBbBBbbbBbBbbBBbBbBbB';
const USDC_ADDR = '0xccCCCcccCCCCcccCCcCCcCcCCCcCcCcCCcCcCcCC';

const baseState = {
  poolAddress: POOL_ADDR,
  status: 1,
  pspWallet: PSP_ADDR,
  stablecoin: USDC_ADDR,
  factory: '0xdEaDBeEf00000000000000000000000000000000',
  softCap: 1_000_000_000n,   // 1_000 USDC (6 decimals)
  hardCap: 5_000_000_000n,   // 5_000 USDC
  tenure: 30n,
  aprAnnual: 100_000_000_000_000_000n, // 0.1 WAD = 10%
  idleRateDaily: 0n,
  utilizedRateDaily: 100_000_000_000_000n,
  penaltyRateDaily: 200_000_000_000_000n,
  penaltyGraceDays: 3n,
  minDeposit: 1_000_000n,
  fundingStartTs: 1_780_000_000n,
  fMaturityTs: 1_780_500_000n,
  poolStartTs: 1_780_600_000n,
  poolFinalityTs: 1_783_000_000n,
  principal: 3_000_000_000n,
  availableToDd: 2_000_000_000n,
  outstanding: 1_000_000_000n,
  fundingCredit: 0n,
  yieldOwed: 0n,
  dollarSeconds: 0n,
  isDrawdownAllowed: true,
  currentDay: 12n,
};

test('poolStateToDoc — identity fields', () => {
  const doc = poolStateToDoc(baseState);
  assert.strictEqual(doc.pubkey, POOL_ADDR);
  assert.strictEqual(doc.pspWallet, PSP_ADDR);
  assert.strictEqual(doc.usdcMint, USDC_ADDR);
  // payfi_v1 collapses vault into the pool address (pool holds the ERC20)
  assert.strictEqual(doc.vault, POOL_ADDR);
});

test('poolStateToDoc — BigInt fields serialized to strings', () => {
  const doc = poolStateToDoc(baseState);
  assert.strictEqual(typeof doc.softCap, 'string');
  assert.strictEqual(typeof doc.hardCap, 'string');
  assert.strictEqual(typeof doc.totalCapital, 'string');
  assert.strictEqual(typeof doc.outstandingPrincipal, 'string');
  assert.strictEqual(doc.softCap, '1000000000');
  assert.strictEqual(doc.hardCap, '5000000000');
  assert.strictEqual(doc.totalCapital, '3000000000');
  assert.strictEqual(doc.outstandingPrincipal, '1000000000');
});

test('poolStateToDoc — status enum decoded to bool flags', () => {
  // status=1 (Active)
  const active = poolStateToDoc({ ...baseState, status: 1 });
  assert.strictEqual(active.isActive, true);
  assert.strictEqual(active.isCancelled, false);
  assert.strictEqual(active.isDefaulted, false);

  // status=2 (Unsuccessful)
  const cancelled = poolStateToDoc({ ...baseState, status: 2 });
  assert.strictEqual(cancelled.isActive, false);
  assert.strictEqual(cancelled.isCancelled, true);
  assert.strictEqual(cancelled.isDefaulted, false);

  // status=4 (Default)
  const defaulted = poolStateToDoc({ ...baseState, status: 4 });
  assert.strictEqual(defaulted.isDefaulted, true);
  assert.strictEqual(defaulted.isActive, false);
});

test('poolStateToDoc — day-index conversion from timestamps', () => {
  const doc = poolStateToDoc(baseState);
  // 1_780_000_000 / 86_400 = 20601 (integer division)
  assert.strictEqual(doc.createdDay, Math.floor(1_780_000_000 / 86400));
  assert.strictEqual(doc.activatedDay, Math.floor(1_780_600_000 / 86400));
});

test('poolStateToDoc — zero timestamps stay 0', () => {
  const doc = poolStateToDoc({ ...baseState, fundingStartTs: 0n, poolStartTs: 0n });
  assert.strictEqual(doc.createdDay, 0);
  assert.strictEqual(doc.activatedDay, 0);
});

test('poolStateToDoc — lastIndexedAt is fresh', () => {
  const before = Date.now();
  const doc = poolStateToDoc(baseState);
  const after = Date.now();
  assert.ok(doc.lastIndexedAt instanceof Date, 'lastIndexedAt is a Date');
  assert.ok(doc.lastIndexedAt.getTime() >= before && doc.lastIndexedAt.getTime() <= after);
});

test('poolStateToDoc — grace/tenure/day fields are Number, not BigInt', () => {
  const doc = poolStateToDoc(baseState);
  assert.strictEqual(typeof doc.facilityTenorDays, 'number');
  assert.strictEqual(typeof doc.graceDays, 'number');
  assert.strictEqual(typeof doc.todayDay, 'number');
  assert.strictEqual(doc.facilityTenorDays, 30);
  assert.strictEqual(doc.graceDays, 3);
  assert.strictEqual(doc.todayDay, 12);
});
