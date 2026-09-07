const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const PSPProfile = require('../models/PSPProfile');
const mongoose = require('mongoose'); // Ensure mongoose is imported
const { createNotification } = require('../services/notificationService');
const { sendEmail } = require('../services/emailService');
const ExternalPSPUser = require('../models/ExternalPSPUser'); // Third-party partner model
const crypto = require('crypto');
const Segment = require('../models/Segment');


// @route   POST /api/auth/register
// @desc    Register new PSP user
// @access  Public

router.post('/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('name').notEmpty(),
    // body('segmentId').notEmpty(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      // 2. Process Registration

      const {
        email, password, name, companyName,
        // Additional company info
        registrationNo, country, yearEstablished,
        contactName, contactEmail, contactPhone,
        uboDetails, pepExposure,
        // Business operations
        sector, transactionVolume, keyProducts, topCustomers, topSuppliers,
        // Financial info
        annualRevenue, rolledOutCreditLines, primaryBank, currentAllocation,
        walletAddress, projectedRevenue, profitMargin, monthlyCashFlow, defaultHistory, segmentId, secondaryCompanies,
        // Registration Details
        licenseType, businessModelDescription, primaryCurrencyPairs, remittanceCorridors, requestedAmount, requestedDuration, fundingCounterparties
      } = req.body;

      // Check if user exists
      let user = await User.findOne({ email });

      if (user) {
        return res.status(400).json({ message: 'User already exists' });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      let segment = null;
      if (segmentId) {
        segment = await Segment.findOne({
          key: segmentId.toUpperCase()
        });

        // Simple auto-seed for development: Create segment if it doesn't exist
        if (!segment) {
          console.log(`Creating missing segment: ${segmentId}`);
          segment = new Segment({
            key: segmentId.toUpperCase(),
            name: segmentId,
            onboardingEnabled: true,
            features: { thirdPartyApi: false }
          });
          await segment.save();
        }

        // Optional but powerful control
        if (!segment.onboardingEnabled) {
          return res.status(403).json({ message: 'Onboarding disabled for this segment' });
        }
      }

      // Create user instance
      user = new User({
        email,
        passwordHash,
        name,
        role: 'PSP',
        companyName,
        segment: segment ? segment._id : undefined
      });

      // 3. Save User
      await user.save();

      // Create PSP profile instance
      const pspProfile = new PSPProfile({
        userId: user._id,
        companyName,
        registrationNo,
        country,
        yearEstablished: yearEstablished ? parseInt(yearEstablished) : undefined,
        keyContact: {
          name: contactName,
          email: contactEmail,
          phone: contactPhone
        },
        uboDetails,
        pepExposure: pepExposure || false,
        sector,
        keyProducts: keyProducts || [],
        topCustomers: topCustomers || [],
        topSuppliers: topSuppliers || [],
        transactionVolume,
        annualRevenue: annualRevenue ? parseFloat(annualRevenue) : undefined,
        rolledOutCreditLines: rolledOutCreditLines ? parseFloat(rolledOutCreditLines) : undefined,
        primaryBank,
        currentAllocation: currentAllocation ? parseFloat(currentAllocation) : undefined,
        walletAddress,
        projectedRevenue: projectedRevenue ? parseFloat(projectedRevenue) : undefined,
        profitMargin: profitMargin ? parseFloat(profitMargin) : undefined,
        monthlyCashFlow: monthlyCashFlow ? parseFloat(monthlyCashFlow) : undefined,
        defaultHistory,
        creditLineStatus: 'None',
        workflowStep: 'KAM_REVIEW',
        onboardingStatus: 'PRE_QUAL_NOT_SUBMITTED',
        secondaryCompanies: secondaryCompanies || [],
        // Registration Details fields (initially empty)
        licenseType: licenseType || "",
        businessModelDescription: businessModelDescription || "",
        primaryCurrencyPairs: primaryCurrencyPairs || "",
        remittanceCorridors: remittanceCorridors || "",
        transactionVolume: transactionVolume || "",
        requestedAmount: requestedAmount || 0,
        requestedDuration: requestedDuration || 0,
        fundingCounterparties: fundingCounterparties || ""
      });

      // 4. Save Profile
      await pspProfile.save();

      // Trigger Notifications and Emails (After commit to ensure DB consistency)
      try {
        // 1. Notify the PSP User (Welcome)
        await createNotification(user._id, {
          title: 'Welcome to PayMate!',
          message: 'Your account has been created successfully. Please apply for a credit line to get started.',
          type: 'success'
        });

        await sendEmail({
          to: user.email,
          subject: 'Welcome to PayMate!',
          title: `Welcome to PayMate, ${name}!`,
          body: `<p>Your registration for <strong>${companyName}</strong> was successful.</p>
                 <p>To start using our services, please log in and complete your profile application for a financing limit.</p>`,
          actionLink: `${process.env.FRONTEND_URL || 'http://localhost:3000'}`,
          actionText: 'Go to Dashboard'
        });

        // 2. Notify Admins (CRO / CFO)
        const admins = await User.find({ role: { $in: ['CRO', 'CFO'] } });
        for (const admin of admins) {
          await createNotification(admin._id, {
            title: 'New PSP Registered',
            message: `${companyName} has just registered in the system and is pending review.`,
            type: 'info'
          });

          await sendEmail({
            to: admin.email,
            subject: 'New PSP Registration - Action Required',
            title: 'New PSP Registration',
            body: `<p>A new PSP <strong>${companyName}</strong> has registered and needs profile verification review.</p>`
          });
        }
      } catch (notifyError) {
        console.error('Failed to send registration notifications:', notifyError);
        // We do not fail the request if notifications fail
      }

      // Generate JWT (Operations outside DB don't need the session)
      const token = jwt.sign(
        { userId: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      });

    } catch (error) {
      console.error("Registration Error:", error);
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login',
  [
    body('email').isEmail(),
    body('password').notEmpty()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      // Check if user exists
      const user = await User.findOne({ email: email });
      if (!user) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      // Validate password
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      let creditLineStatus = null;
      let isExpired = false;
      if (user.role === 'PSP') {
        const profile = await PSPProfile.findOne({ userId: user._id });
        if (profile) {
          creditLineStatus = profile.creditLineStatus;

          // Off-chain expiry check via creditLineEndDate. The Solana pool's
          // tenor is the authoritative source; indexer will reconcile drift.
          if (profile.creditLineEndDate && new Date(profile.creditLineEndDate) < new Date()) {
            isExpired = true;
          }
        } else {
          creditLineStatus = 'None';
        }
      }

      res.json({
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          creditLineStatus, // Added to facilitate redirection
          isExpired // Added to facilitate redirection
        }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-passwordHash');
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});


// =============================================================================
// THIRD-PARTY / PARTNER AUTHENTICATION
// =============================================================================

// @route   POST /api/auth/third-party/login
// @desc    Login for third-party partners (PSPs)
// @access  Public
// @returns { token, apiKey, companyName }
router.post('/third-party/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      // Find partner in USER collection
      // const partner = await ExternalPSPUser.findOne({ email });
      const partner = await User.findOne({ email });
      if (!partner) {
        return res.status(401).json({ message: 'Invalid partner credentials' });
      }

      // Check if partner account is active
      if (partner.isActive === false) {
        return res.status(403).json({ message: 'Partner account is deactivated' });
      }

      // Validate password using the model method
      // Validate password
      const isMatch = await bcrypt.compare(password, partner.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }



      // Generate JWT for the partner
      // We include partner ID and a specific role to distinguish from internal users
      // Added jti (unique ID) to support single-use token enforcement
      const jti = crypto.randomBytes(16).toString('hex');

      const token = jwt.sign(
        {
          partnerId: partner._id,
          role: partner.role,
          company: partner.companyName,
          jti: jti
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' } // Single-use tokens should ideally be short-lived
      );

      res.json({
        success: true,
        message: 'Partner authenticated successfully',
        token,           // The JWT access token
        apiKey: partner.apiKey, // The API key they can use for subsequent webhook/API calls
        companyName: partner.companyName
      });

    } catch (error) {
      console.error('[Auth] Third-party login error:', error);
      res.status(500).json({ message: 'Server error during partner authentication' });
    }
  }
);

// @route   POST /api/auth/forgot-password
// @desc    Request password reset
// @access  Public
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // For security, don't reveal if user exists. Just say email sent if found.
      return res.status(200).json({ success: true, message: 'If an account exists with that email, a reset link has been sent.' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString('hex');

    // Hash token and set to user field
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Set expire (1 hour)
    user.resetPasswordExpire = Date.now() + 3600000;

    await user.save({ validateBeforeSave: false });

    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;

    // Send email
    try {
      await sendEmail({
        to: user.email,
        subject: 'Password Reset Request',
        title: 'Reset Your Password',
        body: `
          <p>You are receiving this email because you (or someone else) have requested the reset of a password.</p>
          <p>Please click on the button below to complete the process. This link is valid for 1 hour.</p>
        `,
        actionLink: resetUrl,
        actionText: 'Reset Password'
      });

      res.status(200).json({ success: true, message: 'Reset email sent' });
    } catch (err) {
      console.error('Email could not be sent', err);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      res.status(500).json({ message: 'Email could not be sent' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/reset-password/:token
// @desc    Reset password
// @access  Public
router.post('/reset-password/:token', async (req, res) => {
  try {
    // Get hashed token
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(req.params.token)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Set new password
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(password, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save({ validateBeforeSave: false });

    res.status(200).json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/change-password
// @desc    Change password for any authenticated user
// @access  Private (any role)
router.post('/change-password', require('../middleware/auth').authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ message: "All fields are required" });
    if (newPassword.length < 6) return res.status(400).json({ message: "New password too short" });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isMatch) return res.status(400).json({ message: "Incorrect old password" });

    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await user.save({ validateBeforeSave: false });

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
