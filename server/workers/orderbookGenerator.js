/**
 * Orderbook seeder for the demo external PSP.
 *
 * Maintains exactly one open Pending order at each target amount
 * ($100k / $250k / $350k / $500k / $750k / $1M) so the borrower's
 * "Pick an order" drawdown picker always has the same predictable
 * menu. When an order gets financed (status flips out of Pending),
 * the next tick — or the inline safety net in
 * /pool/psp/borrow/external-orders when the count drops below 5 —
 * restocks the missing amount with a fresh customer + invoice.
 *
 * The previous random-amount generator is gone; the seeded six are
 * the demo's source of truth.
 */

const ExternalPSPUser = require('../models/ExternalPSPUser');
const ExternalOrderBook = require('../models/ExternalOrderBook');

const TARGET_AMOUNTS = [100_000, 250_000, 350_000, 500_000, 750_000, 1_000_000];
const DEMO_USER_EMAIL = '11feb@maildrop.cc';

// Customer-name pool. PII-safe placeholder names; the picker UI never
// shows them (orderReference is what's displayed) but we still write
// them into ExternalOrderBook so reports / drilldowns have something
// human-readable.
const FIRST_NAMES = ['Avery', 'Blake', 'Casey', 'Drew', 'Ellis', 'Finley', 'Harper', 'Jamie', 'Kai', 'Logan', 'Morgan', 'Noah', 'Parker', 'Quinn', 'Riley', 'Sage', 'Taylor', 'Wren'];
const LAST_NAMES  = ['Adler', 'Bates', 'Cole', 'Doyle', 'Ellis', 'Frye', 'Greer', 'Hale', 'Ingram', 'Joyce', 'Knox', 'Lowe', 'Mills', 'Noble', 'Owens', 'Pace', 'Quinn', 'Reid'];
const SERVICE_TYPES = [
  'Cross-border remittance settlement',
  'B2B payment corridor',
  'Merchant payout batch',
  'Treasury reconciliation',
  'Payroll disbursement',
  'Invoice settlement',
  'API consolidation fees',
  'Liquidity provisioning',
];

const randint = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick    = (arr) => arr[randint(0, arr.length - 1)];

function generateOrderReference() {
  return `ORD-${Date.now().toString().slice(-8)}-${randint(1000, 9999)}`;
}
function generateInvoiceNumber() {
  const d = new Date();
  return `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${randint(1000, 9999)}`;
}
function generateSettlementDate() {
  const date = new Date();
  date.setDate(date.getDate() + randint(7, 45));
  return date;
}

// Lazy auto-create the demo external PSP user. Without this the seeder
// silently no-ops on a fresh DB.
async function ensureDemoUser() {
  const existing = await ExternalPSPUser.findOne({ email: DEMO_USER_EMAIL });
  if (existing) return existing;
  console.log(`[Orderbook Seeder] Creating demo external PSP user (${DEMO_USER_EMAIL})`);
  return ExternalPSPUser.create({
    email: DEMO_USER_EMAIL,
    password: require('crypto').randomBytes(16).toString('hex'),
    companyName: 'Acme Payments (Demo)',
    apiKey: 'demo-' + require('crypto').randomBytes(8).toString('hex'),
    apiSecret: require('crypto').randomBytes(16).toString('hex'),
  });
}

async function seedFixedOrders() {
  try {
    const user = await ensureDemoUser();
    let createdCount = 0;
    for (const amount of TARGET_AMOUNTS) {
      // Already have an open Pending order at this amount? Skip.
      const existing = await ExternalOrderBook.findOne({
        externalPspUserId: user._id,
        amount,
        status: 'Pending',
        loanRequested: { $ne: true },
      });
      if (existing) continue;
      const customerName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      await ExternalOrderBook.create({
        externalPspUserId: user._id,
        orderReference: generateOrderReference(),
        customerName,
        amount,
        currency: 'USD',
        settlementDate: generateSettlementDate(),
        invoiceNumber: generateInvoiceNumber(),
        invoiceDetails: `${pick(SERVICE_TYPES)} — $${amount.toLocaleString()}`,
        notes: `Demo seed order at $${amount.toLocaleString()}`,
        status: 'Pending',
      });
      createdCount += 1;
    }
    if (createdCount > 0) {
      console.log(`[Orderbook Seeder] Topped up ${createdCount} order(s)`);
    }
    return { success: true, created: createdCount };
  } catch (e) {
    console.error('[Orderbook Seeder] error:', e.message);
    return { success: false, error: e.message };
  }
}

// Optional periodic top-up. The /external-orders endpoint has an inline
// safety net (seeds when open count < 5) so the demo works even when
// this scheduler is disabled.
let schedulerInterval = null;
function startOrderbookScheduler() {
  if (schedulerInterval) {
    console.log('[Orderbook Seeder] Scheduler already running');
    return;
  }
  console.log('[Orderbook Seeder] Starting demo seeder (60s cadence)');
  seedFixedOrders();
  schedulerInterval = setInterval(seedFixedOrders, 60_000);
}
function stopOrderbookScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
}

module.exports = {
  startOrderbookScheduler,
  stopOrderbookScheduler,
  seedFixedOrders,
};
