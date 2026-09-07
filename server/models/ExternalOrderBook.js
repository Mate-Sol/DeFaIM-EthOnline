const mongoose = require('mongoose');

const externalOrderBookSchema = new mongoose.Schema({
  externalPspUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExternalPSPUser',
    required: true
  },
  orderReference: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  customerEmail: {
    type: String,
    trim: true
  },
  customerPhone: {
    type: String,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true
  },
  orderDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  settlementDate: {
    type: Date,
    required: true
  },
  invoiceNumber: {
    type: String,
    trim: true
  },
  invoiceDetails: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Completed', 'Cancelled', 'Financed'],
    default: 'Pending'
  },
  // Loan request tracking
  loanRequested: {
    type: Boolean,
    default: false
  },
  loanRequestDate: {
    type: Date,
    default: null
  },
  loanRequestAmount: {
    type: Number,
    default: null
  },
  loanStatus: {
    type: String,
    enum: ['None', 'Pending', 'Approved', 'Rejected', 'Disbursed'],
    default: 'None'
  },
  credmateLoanRequestId: {
    type: String,
    default: null
  },
  // Metadata
  notes: {
    type: String,
    trim: true
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

// Update timestamp on save
externalOrderBookSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for faster queries
externalOrderBookSchema.index({ externalPspUserId: 1, orderReference: 1 });
externalOrderBookSchema.index({ loanRequested: 1, loanStatus: 1 });

module.exports = mongoose.model('ExternalOrderBook', externalOrderBookSchema);
