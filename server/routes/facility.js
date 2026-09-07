const express = require('express');
const router = express.Router();

const { authMiddleware: auth, authorizeRoles } = require('../middleware/auth');
const Facility    = require('../models/Facility');
const PSPProfile  = require('../models/PSPProfile');
// EVM swap: on-chain admin's factory.createPool() returns the pool
// address in the tx receipt. We can no longer pre-derive it from PSP wallet
// + facility id (that was Solana PDA behaviour). The poolPda / vaultPda /
// lpMintPda fields on Facility stay null until Onchain admin actually
// deploys the pool and the evmIndexer picks up the PoolCreated event.

// Authorized state transitions per role.
const NEXT_AFTER = {
  KAM_REVIEW: 'CAD_REVIEW',
  CAD_REVIEW: 'CRO_REVIEW',
  CRO_REVIEW: 'AWAITING_POOL_INIT',
};
const ROLE_FOR_STATE = {
  KAM_REVIEW: 'KAM',
  CAD_REVIEW: 'CAD',
  CRO_REVIEW: 'CRO',
};

// =====================================================================
// PSP endpoints
// =====================================================================

// PSP requests a new facility.
//   Body: { label?, requestedTerms: { creditLine, tenorDays, utilizationRateBps,
//           commitmentRateBps, penaltyRateBps, graceDays?, penaltyDays?,
//           maxDrawdownAmount? } }
// Determines first-vs-subsequent based on whether the PSP has any
// previously CRO-approved facility. First → KAM_REVIEW; subsequent → CRO_REVIEW.
router.post('/facility/request', auth, async (req, res) => {
  try {
    const profile = await PSPProfile.findOne({ userId: req.user.userId });
    if (!profile) return res.status(404).json({ message: 'PSP profile not found' });
    if (profile.workflowStep !== 'FINALIZED') {
      return res.status(403).json({
        message: 'PSP onboarding not yet complete; finish KYC before requesting a facility.',
        workflowStep: profile.workflowStep,
      });
    }
    if (!profile.solanaWallet) {
      return res.status(400).json({ message: 'Bind a Solana wallet before requesting a facility.' });
    }

    // PSP-side request only carries the fields the borrower actually
    // negotiates: credit line, tenor, optional label. Risk-pricing fields
    // (util/commit/penalty rates, grace/penalty days, max drawdown, day
    // length) are filled by the CRO during review and locked on-chain by
    // ONCHAIN_ADMIN at pool init. We accept null/0 for those here.
    const t = req.body?.requestedTerms || {};
    const numOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
    const requestedTerms = {
      creditLine:          Number(t.creditLine),
      tenorDays:           Number(t.tenorDays),
      utilizationRateBps:  numOrNull(t.utilizationRateBps),
      commitmentRateBps:   numOrNull(t.commitmentRateBps),
      penaltyRateBps:      numOrNull(t.penaltyRateBps),
      graceDays:           numOrNull(t.graceDays),
      penaltyDays:         numOrNull(t.penaltyDays),
      maxDrawdownAmount:   numOrNull(t.maxDrawdownAmount),
      secondsPerDay:       numOrNull(t.secondsPerDay),
    };

    const errs = [];
    if (!(requestedTerms.creditLine > 0)) errs.push('creditLine must be > 0');
    if (!(requestedTerms.tenorDays > 0))  errs.push('tenorDays must be > 0');
    if (errs.length) return res.status(400).json({ message: 'invalid terms', errors: errs });

    // First facility = no prior CRO-approved facility for this PSP.
    const priorApproved = await Facility.countDocuments({
      pspProfileId: profile._id,
      croApprovedAt: { $ne: null },
    });
    const isFirstFacility = priorApproved === 0;
    const initialStatus = isFirstFacility ? 'KAM_REVIEW' : 'CRO_REVIEW';

    // Atomically allocate the next facilityId for this PSP.
    const updated = await PSPProfile.findOneAndUpdate(
      { _id: profile._id },
      { $inc: { nextFacilityId: 1 } },
      { new: false }
    );
    const facilityId = updated.nextFacilityId || 1;

    const facility = await Facility.create({
      pspProfileId: profile._id,
      pspWallet:    profile.solanaWallet,
      facilityId,
      label: req.body?.label || '',
      requestedTerms,
      status: initialStatus,
      isFirstFacility,
    });

    return res.json({
      facilityId: facility._id.toString(),
      onChainFacilityId: facility.facilityId,
      status: facility.status,
      isFirstFacility,
    });
  } catch (e) {
    console.error('[facility/request]', e);
    return res.status(500).json({ message: e.message });
  }
});

// PSP lists their own facilities.
router.get('/facility/my', auth, async (req, res) => {
  try {
    const profile = await PSPProfile.findOne({ userId: req.user.userId });
    if (!profile) return res.status(404).json({ message: 'PSP profile not found' });
    const items = await Facility.find({ pspProfileId: profile._id }).sort({ facilityId: 1 });
    res.json({ items: items.map(serialize) });
  } catch (e) {
    console.error('[facility/my]', e);
    res.status(500).json({ message: e.message });
  }
});

// =====================================================================
// Admin endpoints
// =====================================================================

// Queue per status. Auth-gated: KAM sees KAM_REVIEW, CAD sees CAD_REVIEW,
// CRO sees CRO_REVIEW + AWAITING_POOL_INIT (informational).
router.get('/facility/queue', auth, authorizeRoles('KAM','CAD','CRO','SUPER_ADMIN','ONCHAIN_ADMIN'), async (req, res) => {
  try {
    const requestedStatus = req.query.status;
    const role = req.user.role;
    const allowedFor = {
      KAM:  ['KAM_REVIEW'],
      CAD:  ['CAD_REVIEW'],
      CRO:  ['CRO_REVIEW', 'AWAITING_POOL_INIT'],
      SUPER_ADMIN:   Object.keys(NEXT_AFTER).concat(['AWAITING_POOL_INIT', 'FUNDING', 'ACTIVE']),
      ONCHAIN_ADMIN: ['AWAITING_POOL_INIT'],
    };
    const allowed = allowedFor[role] || [];
    const status = requestedStatus && allowed.includes(requestedStatus) ? requestedStatus : allowed[0];
    if (!status) return res.status(403).json({ message: `role ${role} cannot read facility queue` });

    const items = await Facility.find({ status })
      .sort({ requestedAt: 1 })
      .populate('pspProfileId', 'companyName solanaWallet workflowStep');
    res.json({ status, items: items.map(serialize) });
  } catch (e) {
    console.error('[facility/queue]', e);
    res.status(500).json({ message: e.message });
  }
});

router.get('/facility/:id', auth, async (req, res) => {
  try {
    const f = await Facility.findById(req.params.id).populate('pspProfileId', 'companyName solanaWallet workflowStep');
    if (!f) return res.status(404).json({ message: 'Facility not found' });
    // PSPs can read only their own.
    if (req.user.role === 'PSP') {
      if (String(f.pspProfileId._id) !== String(await pspProfileIdFor(req.user.userId))) {
        return res.status(403).json({ message: 'forbidden' });
      }
    }
    res.json(serialize(f));
  } catch (e) {
    console.error('[facility/:id]', e);
    res.status(500).json({ message: e.message });
  }
});

// Generic role-gated approval. Validates role matches current step.
router.post('/facility/:id/approve', auth, authorizeRoles('KAM','CAD','CRO'), async (req, res) => {
  try {
    const f = await Facility.findById(req.params.id);
    if (!f) return res.status(404).json({ message: 'Facility not found' });

    const next = NEXT_AFTER[f.status];
    if (!next) return res.status(409).json({ message: `Cannot approve from state ${f.status}` });
    const requiredRole = ROLE_FOR_STATE[f.status];
    if (req.user.role !== requiredRole) {
      return res.status(403).json({ message: `${f.status} requires ${requiredRole}, you are ${req.user.role}` });
    }

    const note = req.body?.note || '';
    const stamp = { approvedAt: new Date(), approvedBy: req.user.email || req.user.userId, notes: note };

    if (f.status === 'KAM_REVIEW') f.approvals.kam = stamp;
    if (f.status === 'CAD_REVIEW') f.approvals.cad = stamp;

    if (f.status === 'CRO_REVIEW') {
      // CRO can override terms before locking.
      const overrides = req.body?.termAdjustments || {};
      const finalTerms = {
        creditLine:          Number(overrides.creditLine          ?? f.requestedTerms.creditLine),
        tenorDays:           Number(overrides.tenorDays           ?? f.requestedTerms.tenorDays),
        utilizationRateBps:  Number(overrides.utilizationRateBps  ?? f.requestedTerms.utilizationRateBps),
        commitmentRateBps:   Number(overrides.commitmentRateBps   ?? f.requestedTerms.commitmentRateBps),
        penaltyRateBps:      Number(overrides.penaltyRateBps      ?? f.requestedTerms.penaltyRateBps),
        graceDays:           Number(overrides.graceDays           ?? f.requestedTerms.graceDays),
        penaltyDays:         Number(overrides.penaltyDays         ?? f.requestedTerms.penaltyDays),
        maxDrawdownAmount:   Number(overrides.maxDrawdownAmount   ?? f.requestedTerms.maxDrawdownAmount),
        secondsPerDay:       Number(overrides.secondsPerDay       ?? f.requestedTerms.secondsPerDay ?? 86_400),
      };
      // Default soft/hard caps to the credit line if not explicitly set.
      finalTerms.softCap  = Number(overrides.softCap  ?? finalTerms.creditLine);
      finalTerms.hardCap  = Number(overrides.hardCap  ?? finalTerms.creditLine);

      f.approvedTerms = finalTerms;
      f.approvals.cro = { ...stamp, termAdjustments: overrides };
      f.croApprovedAt = new Date();
      // EVM: pool address is unknown until factory.createPool() runs at
      // the onchain-admin step. Leave the *Pda fields null; the evmIndexer
      // will set them when it observes the PoolCreated event.
      f.poolPda   = '';
      f.vaultPda  = '';
      f.lpMintPda = '';
    }

    f.status = next;
    await f.save();
    res.json(serialize(f));
  } catch (e) {
    console.error('[facility/:id/approve]', e);
    res.status(500).json({ message: e.message });
  }
});

// CRO uploads (or replaces) the credit memo PDF for a facility. Lenders
// see this on the facility detail page so they can review the underwriting
// rationale before depositing. PDF is the expected format but we accept any
// MIME — caller-provided. Stored via the existing fileUpload helper, so
// it lands on Azure Blob in prod and `/public/...` in dev.
router.post('/facility/:id/credit-memo', auth, authorizeRoles('CRO','SUPER_ADMIN'), async (req, res) => {
  try {
    const { uploadBase64Attachment } = require('../fileUpload');
    const f = await Facility.findById(req.params.id);
    if (!f) return res.status(404).json({ message: 'Facility not found' });

    const { fileName, mimeType, base64Data } = req.body || {};
    if (!fileName || !base64Data) {
      return res.status(400).json({ message: 'fileName and base64Data required' });
    }
    // Cap at 10 MB raw; base64 expands by ~33%.
    const approxBytes = Math.floor((base64Data.length * 3) / 4);
    if (approxBytes > 10 * 1024 * 1024) {
      return res.status(413).json({ message: 'Credit memo must be ≤ 10 MB' });
    }

    // Sanitize filename and prefix with facility id so concurrent uploads
    // for different facilities never collide.
    const safe = String(fileName).replace(/[^A-Za-z0-9._-]/g, '_');
    const storedName = `${f._id}-${Date.now()}-${safe}`;
    const containerName = process.env.containerName || 'defa';
    const subPath = 'uploads/credit-memos';

    await uploadBase64Attachment(
      `${containerName}/${subPath}`,
      storedName,
      base64Data,
      mimeType || 'application/pdf'
    );
    const url = `${process.env.blobBaseUrl}/${containerName}/${subPath}/${storedName}`;

    f.creditMemo = {
      url,
      fileName: safe,
      mimeType: mimeType || 'application/pdf',
      sizeBytes: approxBytes,
      uploadedAt: new Date(),
      uploadedBy: req.user.email || req.user.userId || '',
    };
    await f.save();
    res.json(serialize(f));
  } catch (e) {
    console.error('[facility/:id/credit-memo]', e);
    res.status(500).json({ message: e.message });
  }
});

// Public-ish lookup so the lender's facility-detail page can fetch the
// memo without needing the off-chain Facility _id (lender only knows
// the on-chain pool PDA). Returns just the memo metadata + URL — no
// other facility internals.
router.get('/facility/by-pool/:poolPda/credit-memo', async (req, res) => {
  try {
    const f = await Facility.findOne({ poolPda: req.params.poolPda }).select('creditMemo facilityId pspWallet');
    if (!f) return res.status(404).json({ message: 'Facility not found for this pool' });
    if (!f.creditMemo || !f.creditMemo.url) {
      return res.status(404).json({ message: 'No credit memo on file' });
    }
    res.json({
      facilityId: f.facilityId,
      url:        f.creditMemo.url,
      fileName:   f.creditMemo.fileName,
      mimeType:   f.creditMemo.mimeType,
      sizeBytes:  f.creditMemo.sizeBytes,
      uploadedAt: f.creditMemo.uploadedAt,
    });
  } catch (e) {
    console.error('[facility/by-pool/:poolPda/credit-memo]', e);
    res.status(500).json({ message: e.message });
  }
});

router.post('/facility/:id/reject', auth, authorizeRoles('KAM','CAD','CRO'), async (req, res) => {
  try {
    const f = await Facility.findById(req.params.id);
    if (!f) return res.status(404).json({ message: 'Facility not found' });
    if (!['KAM_REVIEW','CAD_REVIEW','CRO_REVIEW'].includes(f.status)) {
      return res.status(409).json({ message: `Cannot reject from state ${f.status}` });
    }
    f.status = 'CANCELLED';
    f.rejectionReason = req.body?.reason || '';
    f.rejectedBy      = req.user.email || req.user.userId;
    f.rejectedAt      = new Date();
    await f.save();
    res.json(serialize(f));
  } catch (e) {
    console.error('[facility/:id/reject]', e);
    res.status(500).json({ message: e.message });
  }
});

// =====================================================================
// Helpers
// =====================================================================
async function pspProfileIdFor(userId) {
  const p = await PSPProfile.findOne({ userId }).select('_id');
  return p ? p._id : null;
}

function serialize(f) {
  const o = f.toObject ? f.toObject() : f;
  return {
    _id: o._id?.toString(),
    pspProfileId: typeof o.pspProfileId === 'object' && o.pspProfileId?._id
      ? o.pspProfileId._id.toString()
      : (o.pspProfileId ? o.pspProfileId.toString() : null),
    psp: typeof o.pspProfileId === 'object' && o.pspProfileId?.companyName
      ? { companyName: o.pspProfileId.companyName, solanaWallet: o.pspProfileId.solanaWallet }
      : null,
    pspWallet:        o.pspWallet,
    facilityId:       o.facilityId,
    label:            o.label || '',
    status:           o.status,
    isFirstFacility:  !!o.isFirstFacility,
    requestedTerms:   o.requestedTerms,
    approvedTerms:    o.approvedTerms,
    poolPda:          o.poolPda || '',
    vaultPda:         o.vaultPda || '',
    lpMintPda:        o.lpMintPda || '',
    initializeTxSig:  o.initializeTxSig || '',
    creditMemo:       o.creditMemo && o.creditMemo.url ? o.creditMemo : null,
    approvals:        o.approvals,
    rejectionReason:  o.rejectionReason || '',
    rejectedBy:       o.rejectedBy || '',
    rejectedAt:       o.rejectedAt,
    requestedAt:      o.requestedAt,
    croApprovedAt:    o.croApprovedAt,
    initializedAt:    o.initializedAt,
    activatedAt:      o.activatedAt,
    closedAt:         o.closedAt,
    createdAt:        o.createdAt,
    updatedAt:        o.updatedAt,
  };
}

module.exports = router;
