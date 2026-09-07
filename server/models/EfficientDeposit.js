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
      type: Number, // ✅ changed to Number for queries (range, sorting)
      required: true
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['DEPOSIT', 'REFUND', "TOPUP"], // adjust if needed
    },
    status: {
      type: String,
    },
    created_at: {
      type: Date, // ✅ converted to Date for time queries
    }
  },
  { _id: false } // prevents extra _id inside payload
);
const EfficientDepositSchema = new mongoose.Schema({
  // Use Mixed type to store any JSON structure received
  payload: {
    type: PayloadSchema,
    required: true
  },
  status: {
    type: String,
    enum: ['Financing', 'Financed', 'Rejected', "None"],
    default: 'None'
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
  collection: 'efficent_deposits',
  timestamps: true
});

// Add indexes for common query patterns
EfficientDepositSchema.index({ 'metadata.partnerId': 1 });
EfficientDepositSchema.index({ 'metadata.receivedAt': -1 });

module.exports = mongoose.model('EfficientDeposit', EfficientDepositSchema);
