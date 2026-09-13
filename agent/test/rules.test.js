'use strict';

/**
 * Tests for the risk rules. Pure functions, no network.
 *
 * The fixtures mirror facilities that actually exist on Arc testnet — notably
 * a 10 USDC drawdown left open past its grace window, which the live monitor
 * flags at ~100 USDC of accrued penalty against a contract that reports
 * 99.19. The rule is an estimate for triage, not an accounting figure.
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  evaluate, penaltyAccruing, outstandingNearFinality,
  fundingStalled, borrowerConcentration, daysBetween,
} = require('../src/rules');

const WAD = 10n ** 18n;
const DAY = 86400;
const NOW = 1_789_300_000;

const facility = (over = {}) => ({
  id: '0x71300ba34a75b5cc788f324acf775767dd215a06',
  borrower: '0xad8783af69bd72eef8f7e4ec3dc514cd5116c656',
  status: 'ACTIVE',
  softCap: '20000000',
  hardCap: '20000000',
  totalAssets: '20000000',
  totalFinanceCharge: '0',
  totalYieldClaimed: '0',
  outstanding: '10000000',
  tenureDays: '30',
  penaltyGraceDays: '1',
  penaltyRateDaily: (WAD / 1000n).toString(), // 0.1%/day
  utilizedRateDaily: (WAD / 10000n).toString(),
  fundingMaturity: String(NOW - 10 * DAY),
  finalityAt: String(NOW + 30 * DAY),
  lenderCount: 1,
  drawdowns: [],
  ...over,
});

const drawdown = (over = {}) => ({
  ref: '0xb240eb8040d3f48be9923794b3de1cb094b5f8633c30a38188e6cf7ce9b3c93d',
  amount: '10000000',
  drawnAt: String(NOW - 5 * DAY),
  repaid: false,
  ...over,
});

// ── clock ───────────────────────────────────────────────────────────────

test('CLOCK · elapsed days respect the contract clock, not the wall clock', () => {
  // The demo factory builds with SECONDS_PER_DAY = 60. Judging on the wrong
  // clock makes every demo facility look catastrophically overdue.
  assert.strictEqual(daysBetween(0, 600, 60), 10);
  assert.strictEqual(daysBetween(0, 600, DAY), 0);
});

// ── penalty ─────────────────────────────────────────────────────────────

test('PENALTY · a drawdown inside its term is not flagged', () => {
  const f = facility({ tenureDays: '30', penaltyGraceDays: '1' });
  assert.strictEqual(penaltyAccruing(f, drawdown(), NOW, DAY), null);
});

test('PENALTY · a drawdown past grace is flagged CRITICAL with an estimate', () => {
  const f = facility({ tenureDays: '2', penaltyGraceDays: '1' });
  const hit = penaltyAccruing(f, drawdown(), NOW, DAY);
  assert.ok(hit, 'expected a finding');
  assert.strictEqual(hit.severity, 'CRITICAL');
  assert.strictEqual(hit.overdueDays, 2);
  // 10 USDC x 0.1%/day x 2 days = 0.02 USDC
  assert.strictEqual(hit.estimatedPenalty, 0.02);
});

test('PENALTY · a repaid drawdown is never flagged', () => {
  const f = facility({ tenureDays: '1', penaltyGraceDays: '0' });
  assert.strictEqual(penaltyAccruing(f, drawdown({ repaid: true }), NOW, DAY), null);
});

test('PENALTY · exactly at the grace boundary is not yet overdue', () => {
  // Off-by-one here would page someone the day before anything is wrong.
  const f = facility({ tenureDays: '4', penaltyGraceDays: '1' });
  assert.strictEqual(penaltyAccruing(f, drawdown(), NOW, DAY), null);
});

// ── finality ────────────────────────────────────────────────────────────

test('FINALITY · outstanding debt well before finality is not flagged', () => {
  assert.strictEqual(outstandingNearFinality(facility(), NOW, DAY), null);
});

test('FINALITY · debt inside the window warns', () => {
  const f = facility({ finalityAt: String(NOW + 2 * DAY) });
  const hit = outstandingNearFinality(f, NOW, DAY);
  assert.strictEqual(hit.severity, 'WARNING');
  assert.strictEqual(hit.daysToFinality, 2);
});

test('FINALITY · debt past finality is CRITICAL', () => {
  const f = facility({ finalityAt: String(NOW - DAY) });
  assert.strictEqual(outstandingNearFinality(f, NOW, DAY).severity, 'CRITICAL');
});

test('FINALITY · a fully repaid facility is never flagged', () => {
  const f = facility({ outstanding: '0', finalityAt: String(NOW - DAY) });
  assert.strictEqual(outstandingNearFinality(f, NOW, DAY), null);
});

// ── funding ─────────────────────────────────────────────────────────────

test('FUNDING · an open window is not flagged', () => {
  const f = facility({ status: 'FUNDING', fundingMaturity: String(NOW + DAY) });
  assert.strictEqual(fundingStalled(f, NOW), null);
});

test('FUNDING · expired above soft cap asks for finalisation', () => {
  const f = facility({ status: 'FUNDING', totalAssets: '20000000', softCap: '20000000' });
  const hit = fundingStalled(f, NOW);
  assert.strictEqual(hit.severity, 'WARNING');
  assert.match(hit.message, /finalizeFunding/);
});

test('FUNDING · expired below soft cap tells lenders to withdraw', () => {
  const f = facility({ status: 'FUNDING', totalAssets: '0', softCap: '20000000' });
  const hit = fundingStalled(f, NOW);
  assert.strictEqual(hit.severity, 'INFO');
  assert.match(hit.message, /Unsuccessful/);
});

// ── concentration ───────────────────────────────────────────────────────

test('CONCENTRATION · a single borrower holding everything is flagged', () => {
  const hits = borrowerConcentration([facility()]);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].sharePct, 100);
});

test('CONCENTRATION · a spread book is not flagged', () => {
  const hits = borrowerConcentration([
    facility({ borrower: '0xaaa', outstanding: '10000000' }),
    facility({ borrower: '0xbbb', outstanding: '10000000' }),
    facility({ borrower: '0xccc', outstanding: '10000000' }),
  ]);
  assert.strictEqual(hits.length, 0);
});

test('CONCENTRATION · an empty book does not divide by zero', () => {
  assert.deepStrictEqual(borrowerConcentration([]), []);
  assert.deepStrictEqual(borrowerConcentration([facility({ outstanding: '0' })]), []);
});

// ── evaluate ────────────────────────────────────────────────────────────

test('EVALUATE · findings come back worst-first', () => {
  const f = facility({
    tenureDays: '2',
    penaltyGraceDays: '1',
    finalityAt: String(NOW - DAY),
    drawdowns: [drawdown()],
  });
  const out = evaluate([f], { now: NOW, secondsPerDay: DAY });
  assert.ok(out.length >= 2);
  assert.strictEqual(out[0].severity, 'CRITICAL');
  const severities = out.map((x) => x.severity);
  assert.deepStrictEqual(severities, [...severities].sort((a, b) =>
    ({ CRITICAL: 3, WARNING: 2, INFO: 1 }[b]) - ({ CRITICAL: 3, WARNING: 2, INFO: 1 }[a])));
});

test('EVALUATE · a healthy book produces no findings', () => {
  const clean = facility({ outstanding: '0', status: 'ACTIVE', drawdowns: [] });
  assert.deepStrictEqual(evaluate([clean], { now: NOW, secondsPerDay: DAY }), []);
});

test('EVALUATE · malformed amounts do not crash the run', () => {
  // Subgraph fields are strings; a null must not take the monitor down.
  const broken = facility({ outstanding: null, totalAssets: undefined, drawdowns: [drawdown({ amount: null })] });
  assert.doesNotThrow(() => evaluate([broken], { now: NOW, secondsPerDay: DAY }));
});
