const express = require('express');
const router = express.Router();
const { authMiddleware, authorizeRoles } = require('../middleware/auth');
const PSPProfile = require('../models/PSPProfile');
const FinancingRequest = require('../models/FinancingRequest');
const RepaymentRecord = require('../models/RepaymentRecord');
const { calculateTotalExposure } = require('../services/interestCalculator');

// Apply authentication and authorization
router.use(authMiddleware);
router.use(authorizeRoles('CFO', 'KAM', 'CAD', 'CRO', 'VIEW_ONLY_ADMIN'));

// @route   GET /api/cfo/dashboard-stats
// @desc    Get CFO dashboard statistics
// @access  Private (CFO only)
router.get('/dashboard-stats', async (req, res) => {
  try {
    // Get all PSP profiles
    const allProfiles = await PSPProfile.find({});

    const now = new Date();

    const startOfYear = new Date(now.getFullYear(), 0, 1); // Jan 1, current year
    startOfYear.setHours(0, 0, 0, 0);


    const stats = {
      totalPSPs: 0,
      totalApprovedCredit: 0, // This will be ACTIVE approved credit
      revisionNeededCredit: 0, // This will be Expired or In-Review/NeedMoreInfo credit
      totalActiveCredit: 0,
      totalFinancings: 0,
      pendingApplications: 0,
      totalInterestRevenue: 0
    };

    // Iterate through profiles to calculate credit stats
    for (const profile of allProfiles) {
      const amount = profile.approvedAmount || 0;

      if (profile.creditLineStatus === 'Approved') {
        stats.totalPSPs++;

        // Expiry check is off-chain via creditLineEndDate. The on-chain pool
        // also encodes a tenor; the indexer will reconcile drift in Phase 3.
        const isExpired = profile.creditLineEndDate
          ? new Date(profile.creditLineEndDate) < now
          : false;

        if (isExpired) {
          stats.revisionNeededCredit += amount;
        } else {
          stats.totalApprovedCredit += amount;
        }
      } else if (['NeedMoreInfo', 'UnderReview'].includes(profile.creditLineStatus)) {
        stats.revisionNeededCredit += (profile.approvedAmount || 0) - (profile.currentlyUtilized || 0);
      } else if (profile.creditLineStatus === 'Pending') {
        stats.pendingApplications++;
      }
    }

    // Get all active financings
    const activeFinancings = await FinancingRequest.find({ createdAt: { $gte: startOfYear } });
    stats.totalFinancings = activeFinancings.filter(f => ['Disbursed', 'Overdue', 'PenaltyApplied'].includes(f.status)).length;
    stats.totalActiveCredit = activeFinancings.filter(f => ['Disbursed', 'Overdue', 'PenaltyApplied'].includes(f.status)).reduce((sum, f) => sum + f.amount, 0);

    // Calculate total interest revenue

    activeFinancings.forEach(f => {
      if (f.status === 'Repaid') {
        const interest = f.accruedInterest;
        stats.totalInterestRevenue += (interest.total || 0);
      }

    });


    res.json(stats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/cfo/all-financings
// @desc    Get all financings across all PSPs with calculations
// @access  Private (CFO only)
router.get('/all-financings', async (req, res) => {
  try {
    const financings = await FinancingRequest.find({
      status: { $in: ['Pending', 'Validated', 'Disbursed', 'Overdue', 'PenaltyApplied'] }
    })
      .populate('pspId', 'companyName')
      .sort({ createdAt: -1 });

    // Calculate exposure summary
    const exposure = calculateTotalExposure(financings);

    res.json({
      financings,
      summary: exposure
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/cfo/exposure
// @desc    Get exposure distribution by PSP
// @access  Private (CFO only)
router.get('/exposure', async (req, res) => {
  try {
    const financings = await FinancingRequest.find({ status: { $in: ['Disbursed', 'Overdue', 'PenaltyApplied'] } })
      .populate('pspId', 'companyName');

    // Group by PSP
    const exposureByPSP = {};
    financings.forEach(f => {
      const pspName = f.pspId?.companyName || 'Unknown';
      if (!exposureByPSP[pspName]) {
        exposureByPSP[pspName] = { amount: 0, count: 0, interest: 0 };
      }
      exposureByPSP[pspName].amount += f.amount;
      exposureByPSP[pspName].count += 1;
      exposureByPSP[pspName].interest += f.accruedInterest.total;
    });

    // Convert to array for frontend
    const distribution = Object.keys(exposureByPSP).map(psp => ({
      psp,
      ...exposureByPSP[psp]
    }));

    res.json(distribution);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/cfo/yield-history
// @desc    Get historical yield data (monthly aggregation)
// @access  Private (CFO only)
router.get('/yield-history', async (req, res) => {
  try {
    // Get last 12 months of financings
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const financings = await FinancingRequest.find({
      // status: 'Disbursed',
      disbursedAt: { $gte: twelveMonthsAgo }
    });

    // Group by month
    const monthlyYield = {};
    financings.forEach(f => {
      if (!f.disbursedAt) return;

      const month = f.disbursedAt.toISOString().substring(0, 7); // YYYY-MM
      if (!monthlyYield[month]) {
        monthlyYield[month] = { utilized: 0, unutilized: 0, total: 0 };
      }

      const interest = f.accruedInterest;
      monthlyYield[month].utilized += interest.utilized;
      monthlyYield[month].unutilized += interest.unutilized;
      monthlyYield[month].total += interest.total;
    });

    // Convert to array sorted by month
    const history = Object.keys(monthlyYield)
      .sort()
      .map(month => ({
        month,
        ...monthlyYield[month]
      }));

    res.json(history);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/cfo/earned-yield-history
// @desc    Get earned yield by month (utilized + unutilized)
// @access  Private (CFO only)
router.get('/earned-yield-history', async (req, res) => {
  try {
    // Get all disbursed and active financings
    const financings = await FinancingRequest.find({
      // status: { $in: ['Disbursed', 'Repaid', 'Overdue', 'PenaltyApplied', 'RepaymentPending', 'ProcessingRepayment'] }
      status: { $in: ['Repaid'] }
    })
      .populate('pspId', 'companyName creditLineDuration') // Only need basic info now as we use saved fields
      .sort({ disbursedAt: 1 });

    // Group by month and calculate utilized/unutilized yield
    const monthlyData = {};

    financings.forEach(financing => {
      if (!financing.disbursedAt) return;

      const disbursedDate = new Date(financing.disbursedAt);
      const monthKey = `${disbursedDate.getFullYear()}-${String(disbursedDate.getMonth() + 1).padStart(2, '0')}`;

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: monthKey,
          utilizedYield: 0,
          unutilizedYield: 0,
          totalYield: 0,
          financingsCount: 0
        };
      }

      // Calculate yield for this financing using SAVED fields from the request
      const principal = financing.amount || 0;
      const utilizedBips = financing.utilizedBips || financing.pspId?.utilizedBips || 0;
      const unutilizedBips = financing.unutilizedBips || financing.pspId?.unutilizedBips || 0;
      const creditLimit = financing.approvedAmount || financing.pspId?.approvedAmount || principal;

      // Determine the end date for yield calculation
      const endDate = (financing.status === 'Repaid' || financing.repaidAt)
        ? new Date(financing.repaidAt)
        : new Date();

      // Calculate days held
      const daysHeld = Math.max(0, Math.ceil((endDate - disbursedDate) / (1000 * 60 * 60 * 24)));

      // Calculate utilized yield
      let utilizedYield;
      if (financing.status === 'Repaid') {
        // Use the actual interest paid for settled requests
        utilizedYield = financing.actualInterestPaid || 0;
      } else {
        // Calculate accrued interest for ongoing requests
        utilizedYield = (principal * utilizedBips * daysHeld) / 10000;
      }

      // Calculate unutilized yield (on unused credit)
      const unutilizedAmount = Math.max(0, creditLimit - principal);
      const unutilizedYield = (unutilizedAmount * unutilizedBips * daysHeld) / 10000;

      monthlyData[monthKey].utilizedYield += utilizedYield;
      // monthlyData[monthKey].unutilizedYield += unutilizedYield;
      monthlyData[monthKey].unutilizedYield = 0;
      monthlyData[monthKey].totalYield += (utilizedYield);
      // monthlyData[monthKey].totalYield += (utilizedYield + unutilizedYield);
      monthlyData[monthKey].financingsCount++;
    });

    // Convert to array and sort by month
    const chartData = Object.values(monthlyData).sort((a, b) =>
      a.month.localeCompare(b.month)
    );

    // Format month labels (e.g., "Jan 2024")
    const formattedData = chartData.map(item => ({
      month: new Date(item.month + '-01').toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric'
      }),
      utilizedYield: Math.round(item.utilizedYield * 100) / 100,
      unutilizedYield: Math.round(item.unutilizedYield * 100) / 100,
      totalYield: Math.round(item.totalYield * 100) / 100,
      financingsCount: item.financingsCount
    }));

    res.json({
      success: true,
      data: formattedData,
      summary: {
        totalUtilizedYield: formattedData.reduce((sum, item) => sum + item.utilizedYield, 0),
        totalUnutilizedYield: formattedData.reduce((sum, item) => sum + item.unutilizedYield, 0),
        totalYield: formattedData.reduce((sum, item) => sum + item.totalYield, 0),
        monthsCount: formattedData.length
      }
    });
  } catch (error) {
    console.error('Error fetching earned yield history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earned yield history',
      error: error.message
    });
  }
});


// @route   GET /api/cfo/yield-analytics
// @desc    Get yield analytics comparing expected vs realized yield
// @access  Private (CFO only)
router.get('/yield-analytics', async (req, res) => {
  try {
    // Get all disbursed financings for accrued (expected) yield
    const activeFinancings = await FinancingRequest.find({ status: { $in: ['Disbursed', 'PenaltyApplied', 'Overdue',] } });

    // Calculate total accrued yield (expected)
    let accruedUtilized = 0;
    let accruedUnutilized = 0;
    let accruedPenalties = 0;

    activeFinancings.forEach(financing => {
      const interest = financing.accruedInterest;
      accruedUtilized += interest.utilized || 0;
      accruedUnutilized += interest.unutilized || 0;
      accruedPenalties += financing.penaltyAmount || 0;
    });

    const totalAccruedYield = accruedUtilized + accruedUnutilized + accruedPenalties;

    // Get all repaid financings for realized yield
    const repaidFinancings = await FinancingRequest.find({ status: 'Repaid' });

    let totalInterestReceived = 0;
    let totalPenaltiesReceived = 0;
    let totalExpectedFromRepaid = 0;

    repaidFinancings.forEach(f => {
      totalInterestReceived += (f.totalInterestSettled || f.actualInterestPaid || 0);
      totalPenaltiesReceived += (f.penaltyAmount || 0);
      totalExpectedFromRepaid += (f.expectedInterestAtRepayment || 0);
    });

    const totalRealizedYield = totalInterestReceived + totalPenaltiesReceived;

    const totalRepayments = repaidFinancings.length;
    const averageInterestPerRepayment = totalRepayments > 0 ? totalRealizedYield / totalRepayments : 0;

    // Calculate collection rate (Collected / (Collected + Outstanding Accrued))
    const totalPotentialYield = totalRealizedYield + totalAccruedYield;
    const revenueRate = totalPotentialYield > 0
      ? (totalRealizedYield / totalPotentialYield) * 100
      : 0;

    // Calculate variance (Actual vs Expected for Repaid loans)
    const variance = totalRealizedYield - totalExpectedFromRepaid;
    const variancePercentage = totalExpectedFromRepaid > 0
      ? (variance / totalExpectedFromRepaid) * 100
      : 0;

    let varianceStatus = 'on_target';
    if (variancePercentage > 5) varianceStatus = 'over_target';
    if (variancePercentage < -5) varianceStatus = 'under_target';

    res.json({
      accruedYield: {
        utilized: Math.round(accruedUtilized * 100) / 100,
        unutilized: Math.round(accruedUnutilized * 100) / 100,
        penalties: Math.round(accruedPenalties * 100) / 100,
        total: Math.round(totalAccruedYield * 100) / 100
      },
      realizedYield: {
        totalInterestReceived: Math.round(totalInterestReceived * 100) / 100,
        totalPenaltiesReceived: Math.round(totalPenaltiesReceived * 100) / 100,
        totalRealizedYield: Math.round(totalRealizedYield * 100) / 100,
        totalRepayments,
        averageInterestPerRepayment: Math.round(averageInterestPerRepayment * 100) / 100
      },
      variance: {
        amount: Math.round(variance * 100) / 100,
        percentage: Math.round(variancePercentage * 100) / 100,
        status: varianceStatus
      },
      revenueRate: Math.round(revenueRate * 100) / 100
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/cfo/repayment-history
// @desc    Get repayment history with filters
// @access  Private (CFO only)
router.get('/repayment-history', async (req, res) => {
  try {
    const { startDate, endDate, pspId } = req.query;

    let query = { status: 'Completed' };

    // Apply date filters
    if (startDate || endDate) {
      query.repaymentDate = {};
      if (startDate) query.repaymentDate.$gte = new Date(startDate);
      if (endDate) query.repaymentDate.$lte = new Date(endDate);
    }

    // Apply PSP filter
    if (pspId) {
      query.pspId = pspId;
    }

    const repayments = await RepaymentRecord.find(query)
      .populate('pspId', 'companyName')
      .populate('financingRequestId', 'orderReference')
      .sort({ repaymentDate: -1 });

    // Calculate summary
    const totalPrincipal = repayments.reduce((sum, r) => sum + (r.principalAmount || 0), 0);
    const totalInterestCollected = repayments.reduce((sum, r) => sum + (r.actualInterestPaid || 0), 0);

    const formattedRepayments = repayments.map(r => ({
      _id: r._id,
      psp: r.pspId?.companyName || 'Unknown',
      orderReference: r.financingRequestId?.orderReference || 'N/A',
      principal: r.principalAmount,
      expectedInterest: r.expectedInterest,
      actualInterest: r.actualInterestPaid,
      variance: r.interestVariance,
      variancePercentage: r.variancePercentage,
      repaymentDate: r.repaymentDate,
      txHash: r.txHash
    }));

    res.json({
      repayments: formattedRepayments,
      summary: {
        totalRepayments: repayments.length,
        totalPrincipal: Math.round(totalPrincipal * 100) / 100,
        totalInterestCollected: Math.round(totalInterestCollected * 100) / 100
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
