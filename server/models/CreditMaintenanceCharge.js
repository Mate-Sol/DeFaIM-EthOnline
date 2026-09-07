const mongoose = require('mongoose');

const creditMaintenanceChargeSchema = new mongoose.Schema({
  pspId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PSPProfile',
    required: true,
    index: true
  },
  
  // Period details
  periodStart: {
    type: Date,
    required: true
  },
  periodEnd: {
    type: Date,
    required: true
  },
  
  // Calculation details
  avgAvailableCredit: {
    type: Number,
    required: true,
    default: 0
  },
  unutilizedBips: {
    type: Number,
    required: true
  },
  chargeAmount: {
    type: Number,
    required: true,
    default: 0
  },
  
  // Payment status
  status: {
    type: String,
    enum: ['Pending', 'Paid', 'Overdue', 'Waived'],
    default: 'Pending'
  },
  dueDate: {
    type: Date,
    required: true
  },
  
  // Payment details
  paidAt: Date,
  txHash: String,
  
  // Metadata
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for efficient queries
creditMaintenanceChargeSchema.index({ pspId: 1, status: 1 });
creditMaintenanceChargeSchema.index({ dueDate: 1, status: 1 });

// Update timestamp on save
creditMaintenanceChargeSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for days in period
creditMaintenanceChargeSchema.virtual('periodDays').get(function() {
  if (!this.periodStart || !this.periodEnd) return 0;
  const diffTime = this.periodEnd - this.periodStart;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for days overdue
creditMaintenanceChargeSchema.virtual('daysOverdue').get(function() {
  if (this.status !== 'Pending' && this.status !== 'Overdue') return 0;
  if (!this.dueDate) return 0;
  
  const now = new Date();
  if (now <= this.dueDate) return 0;
  
  const diffTime = now - this.dueDate;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Method to mark as overdue
creditMaintenanceChargeSchema.methods.markAsOverdue = function() {
  if (this.status === 'Pending') {
    this.status = 'Overdue';
    return this.save();
  }
};

// Method to mark as paid
creditMaintenanceChargeSchema.methods.markAsPaid = function(txHash) {
  this.status = 'Paid';
  this.paidAt = new Date();
  this.txHash = txHash;
  return this.save();
};

module.exports = mongoose.model('CreditMaintenanceCharge', creditMaintenanceChargeSchema);
