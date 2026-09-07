/**
 * Interest Calculator Service
 * Calculates interest accrued on financing based on BIPS and days elapsed
 */

/**
 * Calculate interest for a financing request
 * @param {Object} financing - FinancingRequest object
 * @param {Number} financing.amount - Amount financed
 * @param {Number} financing.approvedAmount - Total approved credit line
 * @param {Number} financing.utilizedBips - Utilized BIPS (basis points)
 * @param {Number} financing.unutilizedBips - Unutilized BIPS (basis points)
 * @param {Date} financing.disbursedAt - Disbursement date
 * @returns {Object} Interest breakdown
 */
function calculateInterest(financing) {
  if (!financing.disbursedAt || !financing.utilizedBips || !financing.unutilizedBips) {
    return {
      utilized: 0,
      unutilized: 0,
      total: 0,
      days: 0
    };
  }

  // Calculate days elapsed
  const now = new Date();
  const diffTime = Math.abs(now - financing.disbursedAt);
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // Utilized interest: (drawdown amount × utilized BIPS × days) / 10000
  const utilizedInterest = (financing.amount * financing.utilizedBips * days) / 10000;

  // Unutilized interest: (unused credit × unutilized BIPS × days) / 10000
  const unusedCredit = financing.approvedAmount - financing.amount;
  const unutilizedInterest = (unusedCredit * financing.unutilizedBips * days) / 10000;

  return {
    utilized: Math.round(utilizedInterest * 100) / 100,
    unutilized: Math.round(unutilizedInterest * 100) / 100,
    total: Math.round((utilizedInterest + unutilizedInterest) * 100) / 100,
    days
  };
}

/**
 * Calculate total exposure across all financings
 * @param {Array} financings - Array of FinancingRequest objects
 * @returns {Object} Exposure summary
 */
function calculateTotalExposure(financings) {
  const activeFinancings = financings.filter(f => f.status === 'Disbursed' || f.status === 'Overdue' || f.status === 'PenaltyApplied');
  // const activeFinancings = financings;

  const totalAmount = activeFinancings.reduce((sum, f) => sum + f.amount, 0);
  const totalUtilizedInterest = activeFinancings.reduce((sum, f) => {
    const interest = calculateInterest(f);
    return sum + interest.utilized;
  }, 0);
  const totalUnutilizedInterest = activeFinancings.reduce((sum, f) => {
    const interest = calculateInterest(f);
    return sum + interest.unutilized;
  }, 0);

  return {
    totalFinancings: activeFinancings.length,
    totalAmount,
    totalUtilizedInterest: Math.round(totalUtilizedInterest * 100) / 100,
    totalUnutilizedInterest: Math.round(totalUnutilizedInterest * 100) / 100,
    totalInterest: Math.round((totalUtilizedInterest) * 100) / 100
  };
}

module.exports = {
  calculateInterest,
  calculateTotalExposure
};
