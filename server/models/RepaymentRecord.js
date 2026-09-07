const mongoose = require('mongoose');

const repaymentRecordSchema = new mongoose.Schema({
  financingRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FinancingRequest',
    required: true
  },
  pspId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PSPProfile',
    required: true
  },
  principalAmount: {
    type: Number,
    required: true
  },
  expectedInterest: {
    type: Number,
    required: true
  },
  actualInterestPaid: {
    type: Number,
    required: true
  },
  totalRepayment: {
    type: Number,
    required: true
  },
  repaymentDate: {
    type: Date,
    default: Date.now
  },
  txHash: {
    type: String
  },
  blockNumber: {
    type: Number
  },
  creditLineRestored: {
    type: Number,
    required: true
  },

  // Fee breakdown
  unutilizedFee: {
    type: Number,
    default: 0
  },
  penaltyFee: {
    type: Number,
    default: 0
  },

  // Off-chain receipt reference
  receiptId: {
    type: String,
    default: null
  },
  receiptUrl: {
    type: String,
    default: null
  },

  // What was replenished
  replenishmentType: {
    type: String,
    enum: ['principal', 'fee', 'full'],
    default: 'principal'
  },

  status: {
    type: String,
    enum: ['Completed', 'Failed', 'Pending Confirmation', 'Processing'],
    default: 'Completed'
  }
}, { timestamps: true });

// Virtual field for interest variance
repaymentRecordSchema.virtual('interestVariance').get(function() {
  return this.actualInterestPaid - this.expectedInterest;
});

// Virtual field for variance percentage
repaymentRecordSchema.virtual('variancePercentage').get(function() {
  if (this.expectedInterest === 0) return 0;
  return ((this.actualInterestPaid - this.expectedInterest) / this.expectedInterest) * 100;
});

// Ensure virtuals are included in JSON and object output
repaymentRecordSchema.set('toJSON', { virtuals: true });
repaymentRecordSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('RepaymentRecord', repaymentRecordSchema);
