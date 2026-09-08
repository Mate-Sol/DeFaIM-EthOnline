/**
 * Run every seed in dependency order, idempotently.
 *
 * Exists so a deployment can populate a fresh database without anyone execing
 * into the container: set SEED_DEMO_DATA=1 and the server runs this once after
 * it connects to Mongo. Re-running is safe — each seed upserts.
 *
 * Run directly:  node scripts/seedAll.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const seedAdmins = require('./seedAdmins');
const seedSegments = require('./seedSegments');
const seedPublicDemoCode = require('./seedPublicDemoCode');
const seedDemoPsps = require('./seedDemoPsps');

// Segments first: accounts reference them.
const STEPS = [
  ['segments', seedSegments],
  ['admins', seedAdmins],
  ['borrowers', seedDemoPsps],
  ['access code', seedPublicDemoCode],
];

async function seedAll() {
  const owned = mongoose.connection.readyState === 0;
  if (owned) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/defa');
  }

  // The access-code seed requires this; default it so a deployment does not
  // have to set one more variable to get a working demo.
  if (!process.env.PUBLIC_DEMO_CODE) process.env.PUBLIC_DEMO_CODE = '654321';

  for (const [name, fn] of STEPS) {
    try {
      await fn();
    } catch (e) {
      // One failing seed must not stop the rest, and must never stop the
      // server from starting.
      console.error(`[seed] ${name} failed:`, e.message);
    }
  }

  if (owned) await mongoose.disconnect();
}

module.exports = seedAll;

if (require.main === module) {
  seedAll().catch((e) => {
    console.error('seed failed:', e.message);
    process.exit(1);
  });
}
