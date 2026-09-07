/**
 * Seed default Segment records.
 *
 * A Segment ties a PSP user to an order-validation strategy. The dropdown
 * in the Tech Integration step picks one. If `features.thirdPartyApi` is
 * true, the financing-validation worker hits the configured external auth
 * + endpoint URLs. If false, validation is local-only.
 *
 * For an independent / dev deployment without Eficyent or any external
 * order source, seed two local-only entries so the dropdown isn't empty
 * and orders self-validate against EfficientDeposit in Mongo.
 *
 * Run:  node scripts/seedSegments.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Segment = require('../models/Segment');

const SEGMENTS = [
  {
    key: 'DEFAULT',
    name: 'Default (local validation)',
    onboardingEnabled: true,
    features: { thirdPartyApi: false },
    flowConfig: { apiEndpoint: '', authApi: '' },
  },
  {
    key: 'CORPORATE',
    name: 'Corporate',
    onboardingEnabled: true,
    features: { thirdPartyApi: false },
    flowConfig: { apiEndpoint: '', authApi: '' },
  },
];

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.name}`);

  for (const s of SEGMENTS) {
    const existing = await Segment.findOne({ key: s.key });
    if (existing) {
      Object.assign(existing, s);
      await existing.save();
      console.log(`  ↻ ${s.key.padEnd(12)} ${s.name}`);
    } else {
      await Segment.create(s);
      console.log(`  + ${s.key.padEnd(12)} ${s.name}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
