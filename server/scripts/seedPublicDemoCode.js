/**
 * Seed a single public demo access code (idempotent) so anyone with the
 * code can sign up on the live hackathon URL without waiting for an admin
 * to mint one. The admin `POST /access-code/create` route enforces the
 * 12-char DEFA-XXXX-XXXX-XXXX format and requires a signed-in on-chain
 * admin; this script bypasses both because the hackathon demo needs a
 * short, memorable code (e.g. 123456) that judges can paste.
 *
 * Run inside the backend pod:
 *   PUBLIC_DEMO_CODE=123456 PUBLIC_DEMO_LABEL="polygon-demo" \
 *     node scripts/seedPublicDemoCode.js
 *
 * Or via kubectl:
 *   kubectl exec deployment/ploygon-be -n ploygon-hackathon -- \
 *     env PUBLIC_DEMO_CODE=123456 PUBLIC_DEMO_LABEL=polygon-demo \
 *     node scripts/seedPublicDemoCode.js
 *
 * Safe to re-run: if the code already exists it prints "already exists"
 * and exits 0.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const AccessCode = require('../models/AccessCode');

const CODE  = (process.env.PUBLIC_DEMO_CODE || '').toUpperCase().trim();
const LABEL = process.env.PUBLIC_DEMO_LABEL || 'public-demo';
// Never expires by default; override with PUBLIC_DEMO_EXPIRES_DAYS=<n> for
// a soft ceiling on how long the code is honored.
const EXPIRES_DAYS = Number(process.env.PUBLIC_DEMO_EXPIRES_DAYS || 0);

async function main() {
  if (!CODE) throw new Error('PUBLIC_DEMO_CODE env var is required');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.name}`);

  const existing = await AccessCode.findOne({ code: CODE });
  if (existing) {
    console.log(`✓ code "${CODE}" already exists (created ${existing.createdAt.toISOString()}) — skipping`);
    await mongoose.disconnect();
    return;
  }

  const doc = await AccessCode.create({
    code: CODE,
    label: LABEL,
    // createdBy is required by the schema but the redeem flow never reads
    // it — a placeholder ObjectId satisfies the validator and marks this
    // as a bootstrap-seeded code rather than an admin-minted one.
    createdBy: new mongoose.Types.ObjectId(),
    createdByEmail: 'bootstrap@seed',
    expiresAt: EXPIRES_DAYS > 0
      ? new Date(Date.now() + EXPIRES_DAYS * 24 * 3600 * 1000)
      : null,
  });

  console.log(`✓ seeded code "${doc.code}"  label="${doc.label}"  expires=${doc.expiresAt ? doc.expiresAt.toISOString() : 'never'}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('seed failed:', e.message);
  process.exit(1);
});
