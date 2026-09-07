const mongoose = require('mongoose');

const financingRequestSchema = new mongoose.Schema({
  pspId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PSPProfile',
    required: true
  },
  orderReference: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },

  // Status tracking (async workflow)
  // 'AwaitingDrawdown' was added in the Solana migration: the request was
  // approved off-chain, but the on-chain `request_drawdown` tx hasn't been
  // signed by the PSP yet. Surfaces a "Sign Drawdown" action in the UI.
  status: {
    type: String,
    enum: [
      'Pending', 'Validated',
      'AwaitingDrawdown',
      'Disbursed', 'Repaid', 'Rejected', 'Failed',
      'Overdue', 'PenaltyApplied', 'RepaymentPending', 'ProcessingRepayment'
    ],
    default: 'Pending'
  },

  // ─── Solana correlation ──────────────────────────────────────────────────
  // Filled in by /pool/psp/build-tx/drawdown when the PSP signs and the
  // tx confirms. The indexer uses these to correlate Drawdown PDA state
  // changes (e.g. repaid: false → true) back to the FinancingRequest.
  poolPda: { type: String, default: '', index: true },
  drawdownPda: { type: String, default: '', index: true },
  drawdownId: { type: Number, default: null },
  facilityDocId: { type: mongoose.Schema.Types.ObjectId, ref: 'Facility', default: null, index: true },

  // Timeline
  validatedAt: Date,
  disbursedAt: Date,
  dueDate: Date,
  repaidAt: Date,

  // Interest tracking (copied from PSPProfile at disbursement)
  utilizedBips: Number,
  unutilizedBips: Number,
  approvedAmount: Number, // Total credit line at time of financing

  // Repayment tracking
  repaymentTxHash: String,
  actualInterestPaid: Number,
  expectedInterestAtRepayment: Number,

  // Partial Repayment Support
  remainingPrincipal: {
    type: Number,
    default: function () { return this.amount; }
  },
  totalInterestSettled: {
    type: Number,
    default: 0
  },
  lastInterestAccrualDate: {
    type: Date,
    default: function () { return this.disbursedAt || this.createdAt; }
  },

  // Blockchain
  txHash: String,
  contractAddress: String,

  // Validation pipeline trace. Populated by financingValidationAgent
  // as it walks each gate (order check, credit-line check, etc.).
  // Powers the visual "validation pipeline" stepper shown on PSP /
  // admin / lender drawdown views — auditable + reassuring for users.
  validationSteps: {
    type: [{
      name:     { type: String, required: true },        // human-readable step name
      status:   { type: String, enum: ['pending', 'running', 'passed', 'failed', 'skipped'], default: 'pending' },
      detail:   { type: String, default: '' },           // why it passed/failed
      startedAt:  { type: Date, default: null },
      completedAt:{ type: Date, default: null },
    }],
    default: () => [],
  },

  // External PSP tracking
  isExternalPSP: {
    type: Boolean,
    default: false
  },
  externalOrderId: {
    type: String,
    default: null
  },
  externalPspApiKey: {
    type: String,
    default: null
  },
  externalPspApiSecret: {
    type: String,
    default: null
  },

  // Replenishment reference
  receiptId: {
    type: String,
    default: null
  },
  receiptUrl: {
    type: String,
    default: null
  },

  // Overdue & Penalty tracking
  isOverdue: {
    type: Boolean,
    default: false
  },
  overdueAt: {
    type: Date,
    default: null
  },
  penaltyAmount: {
    type: Number,
    default: 0
  },
  penaltyTriggeredAt: {
    type: Date,
    default: null
  },
  dueSoonEmailSent: {
    type: Boolean,
    default: false
  },
  overdueEmailSent: {
    type: Boolean,
    default: false
  },

  // Error handling
  drawdownTenor: {
    type: Number,
    default: 2
  },
  failureReason: String
}, {
  timestamps: true
});

// Virtual: calendar days elapsed between disburse and repay (or now). Kept as
// a UX/sort helper — purely informational. Not used for fee math; the
// Solana program is authoritative for utilization, commit, and penalty fees.
financingRequestSchema.virtual('daysElapsed').get(function () {
  if (!this.disbursedAt) return 0;
  const start = new Date(this.disbursedAt); start.setHours(0, 0, 0, 0);
  const end = new Date(this.repaidAt || new Date()); end.setHours(0, 0, 0, 0);
  return Math.round(Math.abs(end - start) / 86_400_000) + 1;
});

// Tenor in days for the on-chain drawdown that backs this request. Mirrors
// `Drawdown.tenor_days` once the indexer fills in `drawdownPda`.
financingRequestSchema.virtual('drawdownDays').get(function () {
  if (!this.disbursedAt || !this.dueDate) return 0;
  const start = new Date(this.disbursedAt); start.setHours(0, 0, 0, 0);
  const end = new Date(this.dueDate); end.setHours(0, 0, 0, 0);
  return Math.round(Math.abs(end - start) / 86_400_000) + 1;
});

// NOTE: the EVM-era `interestDays` (Full Tenure Floor) and `accruedInterest`
// virtuals were removed in the Solana migration. The on-chain program
// computes utilization + commit + penalty fees automatically inside `repay`
// and `settle_commit_fee`. Off-chain fee values come from the indexer
// reading Pool.accrued_*_fee and from the per-repayment delta on Drawdown
// state transitions — not from a virtual.

financingRequestSchema.set('toJSON', { virtuals: true });
financingRequestSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('FinancingRequest', financingRequestSchema);
