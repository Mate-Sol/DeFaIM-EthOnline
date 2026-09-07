// Surgical wipe for the "fresh program ID" reset path.
//
// What it KEEPS:
//   - User collection (PSP + admin accounts + their credentials)
//   - PSPProfile collection (so the PSP keeps FINALIZED status — no need
//     to redo KAM → CAD → CRO → Legal onboarding)
//   - Segment collection (DEFAULT / CORPORATE tier defaults)
//
// What it WIPES (collections that point at on-chain artifacts which no
// longer exist under the new program ID):
//   - Facility, FinancingRequest, RepaymentRecord
//   - PoolState, DrawdownState (indexer mirror)
//   - AuthNonce, AccessCode (codes were minted under old admin shadow user
//     but are now stale; lenders need fresh codes anyway)
//   - Lender (fresh wallets bound to fresh facilities)
//   - FaucetClaim, RelayUsage, UsedToken (audit-only)
//   - EfficientDeposit, EfficientPayout, OrderBook, ExternalOrderBook,
//     ExternalPSPUser (companion-flow data)
//   - FinancingDocument, Notification, SupportTicket,
//     CreditMaintenanceCharge, AuditLog (per-loan operational data)
//
// What it RESETS:
//   - PSPProfile.nextFacilityId → 1 for every PSP (fresh program means
//     facility_id=1 is collision-free again)
//
// Run with:
//   node server/scripts/partialWipeForFreshDeploy.js
//
require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('connected\n');

  const wipeList = [
    'Facility', 'FinancingRequest', 'RepaymentRecord',
    'PoolState', 'DrawdownState',
    'AuthNonce', 'AccessCode', 'Lender',
    'FaucetClaim', 'RelayUsage', 'UsedToken',
    'EfficientDeposit', 'EfficientPayout', 'OrderBook',
    'ExternalOrderBook', 'ExternalPSPUser',
    'FinancingDocument', 'Notification', 'SupportTicket',
    'CreditMaintenanceCharge', 'AuditLog',
  ];

  console.log('=== WIPING ===');
  for (const name of wipeList) {
    let model;
    try {
      model = require(`../models/${name}`);
      // Handle the PoolState file which exports both PoolState + DrawdownState.
      if (typeof model !== 'function' && model[name]) model = model[name];
      if (typeof model !== 'function') {
        console.log(`  ${name.padEnd(28)} skipped (not a Mongoose model export)`);
        continue;
      }
    } catch {
      console.log(`  ${name.padEnd(28)} skipped (file not found)`);
      continue;
    }
    const before = await model.countDocuments();
    const r = await model.deleteMany({});
    console.log(`  ${name.padEnd(28)} deleted=${r.deletedCount} (was=${before})`);
  }

  console.log('\n=== KEEPING ===');
  const User = require('../models/User');
  const PSPProfile = require('../models/PSPProfile');
  const Segment = require('../models/Segment');
  console.log(`  User (admins + PSPs)       count=${await User.countDocuments()}`);
  console.log(`  PSPProfile                 count=${await PSPProfile.countDocuments()}`);
  console.log(`  Segment                    count=${await Segment.countDocuments()}`);

  console.log('\n=== RESETTING ===');
  const reset = await PSPProfile.updateMany({}, { $set: { nextFacilityId: 1 } });
  console.log(`  PSPProfile.nextFacilityId reset to 1 on ${reset.modifiedCount} profile(s)`);

  console.log('\ndone — restart the server to pick up the new program ID');
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
