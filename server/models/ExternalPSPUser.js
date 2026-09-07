const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const externalPSPUserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
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
  apiSecret: {
    type: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Webhook configuration
  webhookUrl: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
externalPSPUserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Generate API key and secret on creation
externalPSPUserSchema.pre('save', function(next) {
  if (this.isNew) {
    this.apiKey = 'psp_' + crypto.randomBytes(16).toString('hex');
    this.apiSecret = crypto.randomBytes(32).toString('hex');
  }
  this.updatedAt = Date.now();
  next();
});

// Method to compare password
externalPSPUserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to verify API key and secret
externalPSPUserSchema.methods.verifyApiCredentials = function(apiKey, apiSecret) {
  return this.apiKey === apiKey && this.apiSecret === apiSecret;
};

module.exports = mongoose.model('ExternalPSPUser', externalPSPUserSchema);
