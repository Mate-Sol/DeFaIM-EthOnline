const express = require('express');
const router = express.Router();
const PSPProfile = require('../models/PSPProfile');
const CreditMaintenanceCharge = require('../models/CreditMaintenanceCharge');
const { processDailyMaintenance, markOverdueCharges } = require('../workers/creditMaintenanceWorker');
const { authMiddleware, authorizeRoles } = require('../middleware/auth');


// Apply authentication to all PSP routes
router.use(authMiddleware);
router.use(authorizeRoles('PSP'));

// @route   GET /api/maintenance/charges
// @desc    Get all maintenance charges for logged-in PSP
// @access  Private (PSP)
router.get('/charges', async (req, res) => {
  try {
    const userId = req.user._id;

    // Find PSP profile
    const psp = await PSPProfile.findOne({ userId });
    if (!psp) {
      return res.status(404).json({ message: 'PSP profile not found' });
    }

    // Get all charges
    const charges = await CreditMaintenanceCharge.find({ pspId: psp._id })
      .sort({ createdAt: -1 });

    res.json({
      charges,
      summary: {
        totalCharges: charges.length,
        pendingCharges: charges.filter(c => c.status === 'Pending').length,
        overdueCharges: charges.filter(c => c.status === 'Overdue').length,
        totalPending: charges
          .filter(c => c.status === 'Pending' || c.status === 'Overdue')
          .reduce((sum, c) => sum + c.chargeAmount, 0)
      }
    });
  } catch (error) {
    console.error('Error fetching maintenance charges:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/maintenance/current
// @desc    Get current pending maintenance charge (if any)
// @access  Private (PSP)
router.get('/current', async (req, res) => {
  try {
    const userId = req.user.userId;

    const psp = await PSPProfile.findOne({ userId });
    if (!psp) {
      return res.status(404).json({ message: 'PSP profile not found' });
    }

    // Find pending or overdue charges
    const pendingCharge = await CreditMaintenanceCharge.findOne({
      pspId: psp._id,
      status: { $in: ['Pending', 'Overdue'] }
    }).sort({ dueDate: 1 }); // Oldest due date first

    if (!pendingCharge) {
      return res.json({
        hasPendingCharge: false,
        accumulatedFee: psp.accumulatedMaintenanceFee || 0,
        nextDueDate: psp.nextMaintenanceDueDate
      });
    }

    res.json({
      hasPendingCharge: true,
      charge: pendingCharge,
      accumulatedFee: psp.accumulatedMaintenanceFee || 0,
      nextDueDate: psp.nextMaintenanceDueDate
    });
  } catch (error) {
    console.error('Error fetching current charge:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/maintenance/pay/:chargeId
// @desc    Pay a maintenance charge
// @access  Private (PSP)
router.post('/pay/:chargeId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { chargeId } = req.params;
    const { txHash } = req.body; // Transaction hash from blockchain payment

    // Find PSP profile
    const psp = await PSPProfile.findOne({ userId });
    if (!psp) {
      return res.status(404).json({ message: 'PSP profile not found' });
    }

    // Find charge
    const charge = await CreditMaintenanceCharge.findOne({
      _id: chargeId,
      pspId: psp._id
    });

    if (!charge) {
      return res.status(404).json({ message: 'Maintenance charge not found' });
    }

    if (charge.status === 'Paid') {
      return res.status(400).json({ message: 'Charge already paid' });
    }

    // TODO: Verify blockchain transaction if txHash provided
    // For now, we'll accept the payment

    // Mark charge as paid
    await charge.markAsPaid(txHash || 'MANUAL_PAYMENT');

    // Reset accumulator if this was the latest charge
    psp.accumulatedMaintenanceFee = 0;
    await psp.save();

    res.json({
      message: 'Maintenance charge paid successfully',
      charge,
      remainingAccumulated: psp.accumulatedMaintenanceFee
    });
  } catch (error) {
    console.error('Error paying maintenance charge:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/maintenance/summary
// @desc    Get maintenance fee summary for PSP
// @access  Private (PSP)
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user.userId;

    const psp = await PSPProfile.findOne({ userId });
    if (!psp) {
      return res.status(404).json({ message: 'PSP profile not found' });
    }

    // Calculate current available credit
    const availableCredit = psp.approvedAmount - (psp.currentlyUtilized || 0);

    // Calculate daily maintenance fee
    const dailyFee = psp.unutilizedBips
      ? (availableCredit * psp.unutilizedBips) / 10000
      : 0;

    // Calculate projected weekly/monthly fees
    const weeklyFee = dailyFee * 7;
    const monthlyFee = dailyFee * 30;

    // Get charge history
    const charges = await CreditMaintenanceCharge.find({ pspId: psp._id });
    const totalPaid = charges
      .filter(c => c.status === 'Paid')
      .reduce((sum, c) => sum + c.chargeAmount, 0);

    res.json({
      creditLine: {
        approved: psp.approvedAmount,
        utilized: psp.currentlyUtilized || 0,
        available: availableCredit
      },
      fees: {
        dailyRate: Math.round(dailyFee * 100) / 100,
        weeklyProjected: Math.round(weeklyFee * 100) / 100,
        monthlyProjected: Math.round(monthlyFee * 100) / 100,
        accumulatedCurrent: psp.accumulatedMaintenanceFee || 0
      },
      schedule: {
        frequency: psp.maintenanceChargeFrequency,
        lastChargeDate: psp.lastMaintenanceChargeDate,
        nextDueDate: psp.nextMaintenanceDueDate
      },
      history: {
        totalCharges: charges.length,
        totalPaid: Math.round(totalPaid * 100) / 100,
        pendingAmount: charges
          .filter(c => c.status === 'Pending' || c.status === 'Overdue')
          .reduce((sum, c) => sum + c.chargeAmount, 0)
      },
      bips: {
        unutilizedBips: psp.unutilizedBips
      }
    });
  } catch (error) {
    console.error('Error fetching maintenance summary:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/maintenance/trigger-calculation
// @desc    Manually trigger daily maintenance calculation (Admin/Testing)
// @access  Private (Admin only - TODO: Add admin check)
router.post('/trigger-calculation', async (req, res) => {
  try {
    console.log('[API] Manual trigger of daily maintenance calculation');

    const result = await processDailyMaintenance();

    res.json({
      message: 'Daily maintenance calculation completed',
      result
    });
  } catch (error) {
    console.error('Error triggering maintenance calculation:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// @route   POST /api/maintenance/mark-overdue
// @desc    Manually mark overdue charges (Admin/Testing)
// @access  Private (Admin only - TODO: Add admin check)
router.post('/mark-overdue', async (req, res) => {
  try {
    console.log('[API] Manual trigger of overdue marking');

    const result = await markOverdueCharges();

    res.json({
      message: 'Overdue charges marked',
      result
    });
  } catch (error) {
    console.error('Error marking overdue:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
