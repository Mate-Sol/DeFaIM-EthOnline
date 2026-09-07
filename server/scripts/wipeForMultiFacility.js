// Pre-pilot reset: drops all PSP-side state so we can test the new
// multi-facility flow from scratch. Leaves admin/lender accounts and
// segments alone. On-chain pools previously initialized still exist on
// devnet but the off-chain backend will not reference them.
//
// Run with:  node server/scripts/wipeForMultiFacility.js
//
// Add --include-lenders to also wipe Lender records (forces lenders to
// re-sign-in-with-Solana).
require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

const PSPProfile        = require('../models/PSPProfile');
const Facility          = require('../models/Facility');
const FinancingRequest  = require('../models/FinancingRequest');
const RepaymentRecord   = require('../models/RepaymentRecord');
const PoolState         = require('../models/PoolState');
const DrawdownState     = require('../models/DrawdownState');
const User              = require('../models/User');

const includeLenders = process.argv.includes('--include-lenders');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('connected');

  const collections = [
    ['Facility',         Facility],
    ['FinancingRequest', FinancingRequest],
    ['RepaymentRecord',  RepaymentRecord],
    ['PoolState',        PoolState],
    ['DrawdownState',    DrawdownState],
    ['PSPProfile',       PSPProfile],
  ];

  for (const [name, model] of collections) {
    const before = await model.countDocuments();
    const r = await model.deleteMany({});
    console.log(`  ${name.padEnd(20)} deleted=${r.deletedCount} (was=${before})`);
  }

  // PSP user accounts (so they can re-onboard from scratch).
  const pspUserResult = await User.deleteMany({ role: 'PSP' });
  console.log(`  ${'User(role=PSP)'.padEnd(20)} deleted=${pspUserResult.deletedCount}`);

  if (includeLenders) {
    try {
      const Lender = require('../models/Lender');
      const r = await Lender.deleteMany({});
      console.log(`  ${'Lender'.padEnd(20)} deleted=${r.deletedCount}`);
    } catch {
      console.log('  Lender model not present, skipping');
    }
  }

  console.log('done');
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
