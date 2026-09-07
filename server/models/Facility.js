const mongoose = require('mongoose');

// One Facility = one on-chain pool PDA owned by a PSP.
// A PSP can have many facilities. Each facility goes through its own
// approval workflow (KAM → CAD → CRO for the first, CRO-only for
// subsequent), gets its own pool init transaction, and runs its own
// drawdown/repayment lifecycle.
const FacilitySchema = new mongoose.Schema(
  {
    pspProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PSPProfile',
      required: true,
      index: true,
    },
    pspWallet: { type: String, required: true, index: true },

    // Sequential per-PSP. (psp_wallet, facilityId) is the seed for the
    // pool PDA on-chain — must be unique per PSP.
    facilityId: { type: Number, required: true },

    // Optional human label so PSPs/admins can distinguish facilities
    // ("Q3 working capital", "weekend revolver", etc.).
    label: { type: String, default: '' },

    // Proposed by PSP at request time. Only creditLine + tenorDays are
    // required from the borrower; risk-pricing fields (rates, grace,
    // penalty days, max draw, day length) are filled by the CRO during
    // review and locked on-chain by ONCHAIN_ADMIN at pool init.
    requestedTerms: {
      creditLine: { type: Number, required: true }, // USDC (whole units)
      tenorDays: { type: Number, required: true },
      utilizationRateBps: { type: Number, default: null },
      commitmentRateBps: { type: Number, default: null },
      penaltyRateBps: { type: Number, default: null },
      graceDays: { type: Number, default: null },
      penaltyDays: { type: Number, default: null },
      maxDrawdownAmount: { type: Number, default: null },
      // Day length in seconds. 86_400 = real day; smaller (>=60) for
      // compressed-time test pools so a "30-day" facility can play out
      // in hours. Contract enforces 60..=86_400. Null until CRO sets it.
      secondsPerDay: { type: Number, default: null },
    },
    // Final terms locked in by CRO at approval time. Mirror of
    // requestedTerms with any admin overrides applied.
    approvedTerms: {
      creditLine: { type: Number },
      tenorDays: { type: Number },
      utilizationRateBps: { type: Number },
      commitmentRateBps: { type: Number },
      penaltyRateBps: { type: Number },
      graceDays: { type: Number },
      penaltyDays: { type: Number },
      maxDrawdownAmount: { type: Number },
      softCap: { type: Number },
      hardCap: { type: Number },
      secondsPerDay: { type: Number, default: 86_400 },
    },

    status: {
      type: String,
      enum: [
        'REQUESTED',          // PSP filled the form, waiting on first review
        'KAM_REVIEW',         // First facility only
        'CAD_REVIEW',         // First facility only
        'CRO_REVIEW',         // Final risk sign-off; CRO can edit terms
        'AWAITING_POOL_INIT', // CRO approved; on-chain admin yet to sign initialize_pool
        'FUNDING',            // Pool initialized; lenders can deposit
        'ACTIVE',             // execute_facility called; PSP can drawdown
        'CLOSED',             // close_facility called
        'CANCELLED',          // Rejected during review or cancelled before init
      ],
      default: 'REQUESTED',
      index: true,
    },

    // On-chain artifacts (set when admin signs initialize_pool tx)
    poolPda:     { type: String, default: '', index: true },
    vaultPda:    { type: String, default: '' },
    lpMintPda:   { type: String, default: '' },
    initializeTxSig: { type: String, default: '' },

    // CRO-attached credit memo. Uploaded during review so lenders can
    // see the underwriting rationale before depositing. URL points at
    // the configured blob store (Azure in prod, /public in dev).
    creditMemo: {
      url:        { type: String, default: '' },
      fileName:   { type: String, default: '' },
      mimeType:   { type: String, default: '' },
      sizeBytes:  { type: Number, default: 0 },
      uploadedAt: { type: Date,   default: null },
      uploadedBy: { type: String, default: '' }, // admin email/name for audit trail
    },

    // Approval audit trail
    approvals: {
      kam: {
        approvedAt: { type: Date, default: null },
        approvedBy: { type: String, default: '' },
        notes: { type: String, default: '' },
      },
      cad: {
        approvedAt: { type: Date, default: null },
        approvedBy: { type: String, default: '' },
        notes: { type: String, default: '' },
      },
      cro: {
        approvedAt: { type: Date, default: null },
        approvedBy: { type: String, default: '' },
        notes: { type: String, default: '' },
        termAdjustments: { type: mongoose.Schema.Types.Mixed, default: null },
      },
    },

    rejectionReason: { type: String, default: '' },
    rejectedBy:      { type: String, default: '' },
    rejectedAt:      { type: Date, default: null },

    // Lifecycle timestamps
    requestedAt:        { type: Date, default: Date.now },
    croApprovedAt:      { type: Date, default: null },
    initializedAt:      { type: Date, default: null }, // when on-chain pool created
    activatedAt:        { type: Date, default: null }, // when execute_facility ran
    closedAt:           { type: Date, default: null },

    // Whether full multi-tier review is required. Set at request time
    // based on whether the PSP has any prior CRO-approved facility.
    isFirstFacility: { type: Boolean, default: true },
  },
  { timestamps: true }
);

FacilitySchema.index({ pspProfileId: 1, facilityId: 1 }, { unique: true });
FacilitySchema.index({ status: 1, requestedAt: 1 });

module.exports = mongoose.model('Facility', FacilitySchema);
