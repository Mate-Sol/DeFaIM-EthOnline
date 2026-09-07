const mongoose = require('mongoose');

const orderBookSchema = new mongoose.Schema({
  pspId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PSPProfile',
    required: true
  },
  referenceId: {
    type: String,
    required: true,
    unique: true
  },
  customerName: String,
  amount: Number,
  settlementDate: Date,
  status: {
    type: String,
    enum: ['Pending', 'Financed', 'Settled'],
    default: 'Pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('OrderBook', orderBookSchema);
