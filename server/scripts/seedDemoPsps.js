/**
 * Seed borrower (PSP) accounts with completed KYB profiles, each parked at a
 * different point in the approval chain so every reviewer queue has work in it.
 *
 * seedAdmins.js creates only the staff roles, so a fresh database has nobody
 * who can request a facility — which leaves the KAM / CAD / CRO / Legal queues
 * permanently empty and makes the lifecycle impossible to demonstrate. This
 * fills that gap.
 *
 *   psp1@demo.invoicemate.net   Meridian FX        -> KAM_REVIEW
 *   psp2@demo.invoicemate.net   Aurum Cross-Border -> CAD_REVIEW
 *   psp3@demo.invoicemate.net   Mercury Settle     -> CRO_REVIEW
 *   psp4@demo.invoicemate.net   Atlas Trade        -> LEGAL_REVIEW
 *   psp5@demo.invoicemate.net   Helix Payments     -> AWAITING_POOL_INIT
 *
 * Password for all: demo123
 *
 * Idempotent — re-running updates in place rather than duplicating.
 *
 * Run:  node scripts/seedDemoPsps.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const PSPProfile = require('../models/PSPProfile');

const PASSWORD = 'demo123';

// Each entry is a plausible cross-border payments business. The financials
// matter: CAD and CRO screens read revenue, volume and corridor mix, so a
// profile with zeroes renders an empty review page.
const PSPS = [
  {
    email: 'psp1@demo.invoicemate.net',
    name: 'Meridian FX',
    company: 'Meridian FX Corridor Ltd',
    country: 'United Arab Emirates',
    jurisdiction: 'DIFC',
    licenseType: 'Payment Services Provider',
    sector: 'Cross-border payments',
    corridors: [{ fromCountry: 'AE', toCountry: 'IN', volume: 4200000, count: 18400 }],
    requestedAmount: '250000',
    requestedDuration: '30',
    annualRevenue: 6800000,
    workflowStep: 'KAM_REVIEW',
    creditLineStatus: 'Pending',
  },
  {
    email: 'psp2@demo.invoicemate.net',
    name: 'Aurum Cross-Border',
    company: 'Aurum Cross-Border Payments',
    country: 'Singapore',
    jurisdiction: 'MAS',
    licenseType: 'Major Payment Institution',
    sector: 'Remittance',
    corridors: [{ fromCountry: 'SG', toCountry: 'PH', volume: 2900000, count: 22600 }],
    requestedAmount: '180000',
    requestedDuration: '30',
    annualRevenue: 4100000,
    workflowStep: 'CAD_REVIEW',
    creditLineStatus: 'Pending',
  },
  {
    email: 'psp3@demo.invoicemate.net',
    name: 'Mercury Settlements',
    company: 'Mercury Settlements Inc',
    country: 'United Kingdom',
    jurisdiction: 'FCA',
    licenseType: 'Authorised Payment Institution',
    sector: 'B2B settlement',
    corridors: [{ fromCountry: 'GB', toCountry: 'NG', volume: 5600000, count: 9800 }],
    requestedAmount: '400000',
    requestedDuration: '45',
    annualRevenue: 9200000,
    workflowStep: 'CRO_REVIEW',
    creditLineStatus: 'Pending',
  },
  {
    email: 'psp4@demo.invoicemate.net',
    name: 'Atlas Trade Finance',
    company: 'Atlas Trade Finance BV',
    country: 'Netherlands',
    jurisdiction: 'DNB',
    licenseType: 'Electronic Money Institution',
    sector: 'Trade finance',
    corridors: [{ fromCountry: 'NL', toCountry: 'TR', volume: 3300000, count: 6100 }],
    requestedAmount: '320000',
    requestedDuration: '60',
    annualRevenue: 7400000,
    workflowStep: 'LEGAL_REVIEW',
    creditLineStatus: 'Pending',
  },
  {
    email: 'psp5@demo.invoicemate.net',
    name: 'Helix Payments',
    company: 'Helix Payments Pte Ltd',
    country: 'Hong Kong',
    jurisdiction: 'HKMA',
    licenseType: 'Money Service Operator',
    sector: 'Cross-border payments',
    corridors: [{ fromCountry: 'HK', toCountry: 'VN', volume: 4800000, count: 14200 }],
    requestedAmount: '500000',
    requestedDuration: '30',
    // Through every review; the on-chain admin signs pool creation next.
    workflowStep: 'AWAITING_POOL_INIT',
    creditLineStatus: 'Approved',
    annualRevenue: 11500000,
    approved: true,
  },
];

function profileFor(spec, userId) {
  const now = new Date();
  const base = {
    userId,
    companyName: spec.company,
    registeredName: spec.company,
    registrationNo: 'REG-' + spec.name.replace(/\s+/g, '').toUpperCase().slice(0, 8),
    country: spec.country,
    jurisdiction: spec.jurisdiction,
    licenseType: spec.licenseType,
    yearEstablished: 2019,
    sector: spec.sector,
    businessModelDescription:
      `${spec.company} pre-funds ${spec.sector.toLowerCase()} payouts for corporate clients ` +
      'and settles against receivables on a T+1 to T+7 cycle.',
    purpose: 'Working capital to pre-fund payouts ahead of settlement.',
    isAgreedToNDA: true,
    pepExposure: false,
    uboDetails: 'Beneficial ownership disclosed; no PEP exposure identified.',
    primaryContact: {
      name: spec.name + ' Treasury',
      position: 'Head of Treasury',
      email: spec.email,
      phone: '+000000000',
    },
    corridorBreakdown: spec.corridors,
    transactionVolume: String(spec.corridors[0].volume),
    annualRevenue: spec.annualRevenue,
    outstandingLoans: 0,
    preQualRequestedAmount: spec.requestedAmount,
    preQualRequestedDuration: spec.requestedDuration,
    preQualRemittanceCorridors:
      `${spec.corridors[0].fromCountry} → ${spec.corridors[0].toCountry}`,
    preQualFundingCounterparties: 'Tier-1 banking partners',
    workflowStep: spec.workflowStep,
    creditLineStatus: spec.creditLineStatus,
  };

  if (spec.approved) {
    const days = Number(spec.requestedDuration);
    Object.assign(base, {
      approvedCreditLine: Number(spec.requestedAmount),
      approvedAmount: Number(spec.requestedAmount),
      creditReserve: 0,
      approvedDuration: days,
      creditLineStartDate: now,
      creditLineEndDate: new Date(now.getTime() + days * 86400000),
      utilizedBips: 100,
      unutilizedBips: 10,
      penaltyBips: 200,
      penaltyGracePeriodHours: 48,
      pauseAfterDays: 3,
      facilityId: 1,
    });
  }
  return base;
}

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/defa';
  const owned = mongoose.connection.readyState === 0;
  if (owned) await mongoose.connect(uri);
  console.log('Connected to', mongoose.connection.name);

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const line = '─'.repeat(72);
  console.log(line);

  for (const spec of PSPS) {
    let user = await User.findOne({ email: spec.email });
    if (user) {
      user.name = spec.name;
      user.role = 'PSP';
      user.companyName = spec.company;
      user.passwordHash = passwordHash;
      user.isActive = true;
      await user.save();
    } else {
      user = await new User({
        email: spec.email,
        name: spec.name,
        role: 'PSP',
        companyName: spec.company,
        passwordHash,
        isActive: true,
      }).save();
    }

    const doc = profileFor(spec, user._id);
    const existing = await PSPProfile.findOne({ userId: user._id });
    if (existing) {
      Object.assign(existing, doc);
      await existing.save();
    } else {
      await new PSPProfile(doc).save();
    }

    console.log(
      `  ${spec.email.padEnd(30)} ${spec.company.padEnd(32)} ${spec.workflowStep}`
    );
  }

  console.log(line);
  console.log(`  ${PSPS.length} borrower accounts ready. Password: ${PASSWORD}`);
  console.log(line);
  if (owned) await mongoose.disconnect();
}

// Callable two ways: as a CLI script, and from the server at boot when the
// deployment cannot exec into the container. When the caller already holds a
// mongoose connection this reuses it and leaves it open.
module.exports = seed;

if (require.main === module) {
  seed().catch((e) => {
    console.error('seed failed:', e.message);
    process.exit(1);
  });
}
