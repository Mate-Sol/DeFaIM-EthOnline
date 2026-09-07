const mongoose = require('mongoose');
const crypto = require('crypto');


const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  segment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Segment',
    required: false
  },
  companyName: {
    type: String,
    required: true,
    trim: true
  },
  apiKey: {
    type: String,
    unique: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  role: {
    type: String,
    enum: ['PSP', 'KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN', 'LEGAL_ADMIN', 'ONCHAIN_ADMIN'],
    required: true
  },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  // Bound via /auth/wallet/bind. Admin roles use this wallet to sign
  // initialize_pool / execute_facility / cancel_funding / claim_protocol_fees /
  // declare_default. PSPs duplicate this on PSPProfile.solanaWallet.
  solanaWallet: { type: String, default: '' },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Generate API key and secret on creation
userSchema.pre('save', function (next) {
  if (this.isNew) {
    this.apiKey = 'psp_' + crypto.randomBytes(16).toString('hex');
  }
  this.updatedAt = Date.now();
  next();
});


module.exports = mongoose.model('User', userSchema);
