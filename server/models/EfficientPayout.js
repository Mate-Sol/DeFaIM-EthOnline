const mongoose = require('mongoose');


const PayloadSchema = new mongoose.Schema(
  {
    unique_id: {
      type: String,
      required: true,
    },
    user: {
      type: String,
    },
    total_amount: {
      type: String, // ✅ change to Number for queries (range, sorting)
      required: true
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
    },
    remitter: {
      type: String,
    },
    beneficiary_name: {
      type: String,
    },
    status: {
      type: String,
    },
    created_at: {
      type: String, // ✅ convert to Date for time queries
    }
  },
  { _id: false } // prevents extra _id inside payload
);
const EfficientPayoutSchema = new mongoose.Schema({
  // Use Mixed type to store any JSON structure received
  payload: {
    type: PayloadSchema,
    required: true
  },
  metadata: {
    headers: mongoose.Schema.Types.Mixed,
    ip: String,
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ExternalPSPUser',
      required: true
    },
    receivedAt: {
      type: Date,
      default: Date.now
    }
  }
}, {
  strict: false,
  collection: 'efficent_payouts',
  timestamps: true
});

// Add indexes for common query patterns
EfficientPayoutSchema.index({ 'metadata.partnerId': 1 });
EfficientPayoutSchema.index({ 'metadata.receivedAt': -1 });

module.exports = mongoose.model('EfficientPayout', EfficientPayoutSchema);
