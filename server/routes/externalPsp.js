const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const ExternalPSPUser = require('../models/ExternalPSPUser');
const ExternalOrderBook = require('../models/ExternalOrderBook');
const axios = require('axios');
const User = require('../models/User');
const EfficientDeposit = require('../models/EfficientDeposit');

// Authentication middleware for external PSP
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'No authorization token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid token or user inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Authentication failed' });
  }
};

// @route   POST /api/external-psp/auth/register
// @desc    Register new external PSP
// @access  Public
router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, companyName } = req.body;

    // Validate input
    if (!email || !password || !companyName) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Check if user already exists
    const existingUser = await ExternalPSPUser.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Create new user
    const user = new ExternalPSPUser({
      email,
      password,
      companyName
    });

    await user.save();

    // Return user info with API credentials
    res.status(201).json({
      message: 'Registration successful',
      user: {
        id: user._id,
        email: user.email,
        companyName: user.companyName,
        apiKey: user.apiKey,
        apiSecret: user.apiSecret
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// @route   POST /api/external-psp/auth/login
// @desc    Login external PSP
// @access  Public
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user
    const user = await ExternalPSPUser.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is inactive' });
    }

    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        companyName: user.companyName,
        apiKey: user.apiKey
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// @route   GET /api/external-psp/profile
// @desc    Get external PSP profile
// @access  Private
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    res.json({
      id: req.user._id,
      email: req.user.email,
      companyName: req.user.companyName,
      apiKey: req.user.apiKey,
      createdAt: req.user.createdAt
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/external-psp/orderbook
// @desc    Get all orders for external PSP
// @access  Private
router.get('/orderbook', authMiddleware, async (req, res) => {
  try {
    const orders = await EfficientDeposit.find({
      "metadata.partnerId": req.user._id,
    }).select('-metadata.headers')
      .sort({ createdAt: -1 });

    const _simple = orders.map(order => {
      return {
        _id: order.payload._id,
        orderReference: order.payload.unique_id,
        customerName: order.payload.user,
        amount: order.payload.total_amount,
        currency: order.payload.currency,
        orderDate: order.payload.created_at,
        settlementDate: order.payload.created_at,
        invoiceNumber: order.payload.unique_id,
        status: order.payload.status,
        loanStatus: order.status,
      }
    })

    res.json(_simple);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/external-psp/orderbook/:orderId
// @desc    Get order details (used by CredMate for validation)
// @access  Public (verified by API key)
router.get('/orderbook/:orderId', async (req, res) => {
  try {
    const apiKey = req.header('X-API-Key');

    if (!apiKey) {
      return res.status(401).json({ message: 'API key required' });
    }

    // Find order by reference or _id
    const order = await ExternalOrderBook.findOne({
      $or: [
        { _id: req.params.orderId },
        { orderReference: req.params.orderId }
      ]
    }).populate('externalPspUserId', 'companyName apiKey');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Verify API key matches
    if (order.externalPspUserId.apiKey !== apiKey) {
      return res.status(403).json({ message: 'Invalid API key for this order' });
    }

    res.json({
      orderReference: order.orderReference,
      customerName: order.customerName,
      amount: order.amount,
      currency: order.currency,
      orderDate: order.orderDate,
      settlementDate: order.settlementDate,
      invoiceNumber: order.invoiceNumber,
      status: order.status,
      companyName: order.externalPspUserId.companyName
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/external-psp/orderbook
// @desc    Create new order
// @access  Private
router.post('/orderbook', authMiddleware, async (req, res) => {
  try {
    const {
      orderReference,
      customerName,
      customerEmail,
      customerPhone,
      amount,
      currency,
      settlementDate,
      invoiceNumber,
      invoiceDetails,
      notes
    } = req.body;

    // Validate required fields
    if (!orderReference || !customerName || !amount || !settlementDate) {
      return res.status(400).json({
        message: 'Order reference, customer name, amount, and settlement date are required'
      });
    }

    // Check if order reference already exists for this user
    const existingOrder = await ExternalOrderBook.findOne({
      externalPspUserId: req.user._id,
      orderReference
    });

    if (existingOrder) {
      return res.status(400).json({ message: 'Order reference already exists' });
    }

    // Create new order
    const order = new ExternalOrderBook({
      externalPspUserId: req.user._id,
      orderReference,
      customerName,
      customerEmail,
      customerPhone,
      amount,
      currency: currency || 'USD',
      settlementDate,
      invoiceNumber,
      invoiceDetails,
      notes
    });

    await order.save();

    res.status(201).json({
      message: 'Order created successfully',
      order
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/external-psp/request-loan
// @desc    Request loan from CredMate against an order
// @access  Private
router.post('/request-loan', authMiddleware, async (req, res) => {
  try {
    const { orderId, requestedAmount } = req.body;

    // Validate input
    if (!orderId || !requestedAmount) {
      return res.status(400).json({ message: 'Order ID and requested amount are required' });
    }

    // Find order
    const order = await ExternalOrderBook.findOne({
      _id: orderId,
      externalPspUserId: req.user._id
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if loan already requested
    if (order.loanRequested && order.loanStatus !== 'Rejected') {
      return res.status(400).json({
        message: 'Loan already requested for this order',
        loanStatus: order.loanStatus
      });
    }

    // Validate amount
    if (requestedAmount > order.amount) {
      return res.status(400).json({
        message: 'Requested amount cannot exceed order amount'
      });
    }

    // Call CredMate webhook
    const webhookUrl = process.env.CREDMATE_WEBHOOK_URL || 'http://localhost:5050/api/webhook/loan-request';

    try {
      const webhookResponse = await axios.post(webhookUrl, {
        externalPspApiKey: req.user.apiKey,
        externalPspApiSecret: req.user.apiSecret,
        orderReference: order.orderReference,
        orderId: order._id,
        customerName: order.customerName,
        amount: requestedAmount,
        orderDate: order.orderDate,
        settlementDate: order.settlementDate,
        companyName: req.user.companyName
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': req.user.apiKey,
          'X-API-Secret': req.user.apiSecret
        }
      });

      // Update order with loan request info
      order.loanRequested = true;
      order.loanRequestDate = new Date();
      order.loanRequestAmount = requestedAmount;
      order.loanStatus = 'Pending';

      if (webhookResponse.data.requestId) {
        order.credmateLoanRequestId = webhookResponse.data.requestId;
      }

      await order.save();

      res.json({
        message: 'Loan request submitted to CredMate successfully',
        order,
        credmateResponse: webhookResponse.data
      });
    } catch (webhookError) {
      console.error('Webhook call error:', webhookError.response?.data || webhookError.message);

      res.status(500).json({
        message: 'Failed to submit loan request to CredMate',
        error: webhookError.response?.data?.message || webhookError.message
      });
    }
  } catch (error) {
    console.error('Request loan error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/external-psp/loan-status/:orderId
// @desc    Get loan status for an order
// @access  Private
router.get('/loan-status/:orderId', authMiddleware, async (req, res) => {
  try {
    const order = await ExternalOrderBook.findOne({
      _id: req.params.orderId,
      externalPspUserId: req.user._id
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.json({
      orderReference: order.orderReference,
      loanRequested: order.loanRequested,
      loanRequestDate: order.loanRequestDate,
      loanRequestAmount: order.loanRequestAmount,
      loanStatus: order.loanStatus,
      credmateLoanRequestId: order.credmateLoanRequestId
    });
  } catch (error) {
    console.error('Get loan status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/external-psp/webhook/loan-approved
// @desc    Webhook endpoint for CredMate to notify loan approval
// @access  Public (verified by API key)
router.post('/webhook/loan-approved', async (req, res) => {
  try {
    const apiKey = req.header('X-API-Key');
    const apiSecret = req.header('X-API-Secret');

    if (!apiKey || !apiSecret) {
      return res.status(401).json({ message: 'API credentials required' });
    }

    // Verify API credentials
    const user = await ExternalPSPUser.findOne({ apiKey });
    if (!user || !user.verifyApiCredentials(apiKey, apiSecret)) {
      return res.status(403).json({ message: 'Invalid API credentials' });
    }

    const {
      orderId,
      credmateLoanId,
      status,
      approvedAmount,
      message
    } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: 'Order ID is required' });
    }

    // Find and update the order
    const order = await ExternalOrderBook.findOne({
      _id: orderId,
      externalPspUserId: user._id
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Update order status
    order.loanStatus = status || 'Approved';
    order.credmateLoanId = credmateLoanId;
    order.approvedAt = new Date();

    if (approvedAmount) {
      order.approvedAmount = approvedAmount;
    }

    await order.save();

    console.log(`[External PSP Webhook] Order ${orderId} status updated to ${order.loanStatus}`);

    res.json({
      message: 'Webhook received and order updated',
      orderId: order._id,
      orderReference: order.orderReference,
      loanStatus: order.loanStatus
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ message: 'Webhook processing error' });
  }
});

module.exports = router;
