require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const FinancingRequest = require('../models/FinancingRequest');
const RepaymentRecord = require('../models/RepaymentRecord');
const PSPProfile = require('../models/PSPProfile');

async function cleanup() {
  try {
    await connectDB();
    console.log('Starting cleanup of orphaned financing and repayment records...');

    // 1. Get all PSP profiles that have a linked userId
    const pspProfilesWithUser = await PSPProfile.find({ userId: { $exists: true, $ne: null } }).select('_id');
    const validPspIds = pspProfilesWithUser.map(psp => psp._id);

    console.log(`Found ${validPspIds.length} PSP profiles with valid user IDs.`);

    // 2. Delete FinancingRequest records with no linked pspId or pspId not in the valid list
    const financingDeleteResult = await FinancingRequest.deleteMany({
      $or: [
        { pspId: { $exists: false } },
        { pspId: null },
        { pspId: { $nin: validPspIds } }
      ]
    });
    console.log(`Deleted ${financingDeleteResult.deletedCount} orphaned FinancingRequest records.`);

    // 3. Delete RepaymentRecord records with no linked pspId or pspId not in the valid list
    const repaymentDeleteResult = await RepaymentRecord.deleteMany({
      $or: [
        { pspId: { $exists: false } },
        { pspId: null },
        { pspId: { $nin: validPspIds } }
      ]
    });
    console.log(`Deleted ${repaymentDeleteResult.deletedCount} orphaned RepaymentRecord records.`);

    // Additional check: Delete repayments where the financing request they link to is gone
    const currentFinancingIds = await FinancingRequest.distinct('_id');
    const orphanedRepaymentsByFinancing = await RepaymentRecord.deleteMany({
      financingRequestId: { $nin: currentFinancingIds }
    });
    console.log(`Deleted ${orphanedRepaymentsByFinancing.deletedCount} RepaymentRecord records linked to non-existent FinancingRequests.`);

    console.log('Cleanup completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exit(1);
  }
}

cleanup();
