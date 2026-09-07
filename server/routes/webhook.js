const express = require('express');
const router = express.Router();
const ExternalPSPUser = require('../models/ExternalPSPUser');
const OrderBook = require('../models/OrderBook');
const PSPProfile = require('../models/PSPProfile');
const FinancingRequest = require('../models/FinancingRequest');
const EfficientPayout = require('../models/EfficientPayout');
const axios = require('axios');
const jwt = require('jsonwebtoken'); // Added to validate partner tokens
const UsedToken = require('../models/UsedToken'); // Single-use token enforcement
const EfficientDeposit = require('../models/EfficientDeposit');
const verifyPartnerAuth = require('../middleware/partnerauth');

// Middleware to verify partner authentication
router.use(verifyPartnerAuth);


// External PSP API service to validate order data
const validateExternalOrder = async (apiKey, orderId) => {
  try {
    const externalApiUrl = process.env.EXTERNAL_PSP_API_URL || 'http://localhost:5050/api/external-psp';
    console.log("🚀 ~ validateExternalOrder ~ externalApiUrl:", `${externalApiUrl}/orderbook/${orderId}`)
    console.log("🚀 ~ validateExternalOrder ~ apiKey:", apiKey)

    const response = await axios.get(`${externalApiUrl}/orderbook/${orderId}`, {
      headers: {
        'X-API-Key': apiKey
      }
    });

    return {
      success: true,
      orderData: response.data
    };
  } catch (error) {
    console.error('External order validation error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to validate order with external PSP'
    };
  }
};


// @route   POST /api/webhook/loan-request
// @desc    Receive loan request from external PSP
// @access  Public (verified by API key)
router.post('/loan-request', async (req, res) => {
  try {

    const {
      orderReference,
      orderId,
      customerName,
      amount,
      orderDate,
      settlementDate,
      companyName
    } = req.body;

    // Validate required fields
    if (!orderReference || !orderId || !customerName || !amount) {
      return res.status(400).json({
        message: 'Order reference, order ID, customer name, and amount are required'
      });
    }

    console.log('[Webhook] Loan request received from external PSP:', companyName);
    console.log('[Webhook] Order Reference:', orderReference);
    console.log('[Webhook] Amount:', amount);

    // Step 1: Validate order data with external PSP API
    const validationResult = await validateExternalOrder(req.partner.apiKey, orderId);
    console.log("🚀 ~ validationResult:", validationResult)

    if (!validationResult.success) {
      return res.status(400).json({
        message: 'Order validation failed',
        error: validationResult.error
      });
    }

    const externalOrderData = validationResult.orderData;

    // Step 2: Verify data matches
    if (externalOrderData.orderReference !== orderReference) {
      return res.status(400).json({
        message: 'Order reference mismatch',
        provided: orderReference,
        actual: externalOrderData.orderReference
      });
    }

    if (externalOrderData.customerName !== customerName) {
      return res.status(400).json({
        message: 'Customer name mismatch',
        provided: customerName,
        actual: externalOrderData.customerName
      });
    }

    if (externalOrderData.amount < amount) {
      return res.status(400).json({
        message: 'Requested amount exceeds order amount',
        requested: amount,
        orderAmount: externalOrderData.amount
      });
    }

    console.log('[Webhook] Order validation successful');

    // Step 3: Find or create PSP profile for external PSP
    // First, check if there's a User account for this external PSP
    const User = require('../models/User');
    let pspUser = await User.findOne({ email: req.partner.email });


    let pspProfile = await PSPProfile.findOne({ userId: pspUser._id });


    // Step 4: Save order to main system's OrderBook
    let orderBook = await EfficientDeposit.findOne({ "metadata.partnerId": pspProfile._id, "payload.unique_id": orderReference });

    if (!orderBook) {
      return res.status(400).json({
        message: 'Order not found in your order book',
        provided: orderReference,
        actual: orderBook?.payload?.unique_id
      });
    }

    // Step 5 : get financing request from orderbook
    const financingRequest = new FinancingRequest({
      pspId: pspProfile._id,
      amount,
      orderReference,
      status: 'Pending'
    });

    await financingRequest.save();


    // Step 6: Trigger validation workflow (async)
    const { validateFinancingRequest } = require('../workers/financingValidationAgent');
    validateFinancingRequest(financingRequest._id.toString()).catch(err => {
      console.error('[Webhook] Async validation error:', err);
    });

    // Note: External PSP will be notified via webhook when loan is approved/disbursed
    // See disbursementAgent.js for webhook notification logic

    console.log('[Webhook] Loan request processed successfully');

    res.json({
      message: 'Loan request received and processing',
      requestId: financingRequest._id,
      orderBookId: orderBook._id,
      status: 'Pending',
      validationStatus: 'Processing'
    });
  } catch (error) {
    console.error('[Webhook] Error processing loan request:', error);
    res.status(500).json({
      message: 'Server error processing loan request',
      error: error.message
    });
  }
});

// @route   POST /webhook/eficyent/payouts
// @desc    Dynamic webhook for Efficient Payouts partner
// @access  Public (verified by JWT Token AND API key)
router.post('/eficyent/payouts', async (req, res) => {
  try {

    // Capture everything dynamically into the specified collection
    const payoutData = new EfficientPayout({
      payload: req.body,
      metadata: {
        headers: req.headers,
        ip: req.ip,
        partnerId: req.partner._id,
        receivedAt: new Date()
      }
    });

    await payoutData.save();

    res.status(200).json({
      success: true,
      message: 'Webhook received and stored successfully',
      id: payoutData._id
    });

  } catch (error) {
    console.error('[Webhook] Error processing Efficient Payout:', error);
    res.status(500).json({
      success: false,
      message: 'Server error processing webhook',
      error: error.message
    });
  }
});
// @route   POST /webhook/eficyent/deposits
// @desc    Dynamic webhook for Efficient Deposits partner
// @access  Public (verified by JWT Token AND API key)
router.post('/eficyent/deposits', async (req, res) => {
  try {

    // Capture everything dynamically into the specified collection
    const payoutData = new EfficientDeposit({
      payload: req.body,
      metadata: {
        headers: req.headers,
        ip: req.ip,
        partnerId: req.partner._id,
        receivedAt: new Date()
      }
    });

    await payoutData.save();

    res.status(200).json({
      success: true,
      message: 'Webhook received and stored successfully',
      id: payoutData._id
    });

  } catch (error) {
    console.error('[Webhook] Error processing Efficient Payout:', error);
    res.status(500).json({
      success: false,
      message: 'Server error processing webhook',
      error: error.message
    });
  }
});

module.exports = router;
