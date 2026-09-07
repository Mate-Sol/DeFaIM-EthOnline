const AuditLog = require('../models/AuditLog');

/**
 * Log an administrative action
 * @param {string} userId - ID of the user performing the action
 * @param {string} action - Description of the action (e.g., 'APPROVE_PROFILE')
 * @param {string} entityType - Type of entity (e.g., 'PSPProfile')
 * @param {string} entityId - ID of the entity
 * @param {Object} details - Additional details/metadata
 * @param {string} ipAddress - IP address of the requester
 */
const logAction = async (userId, action, entityType, entityId, details = {}, ipAddress = null) => {
  try {
    const log = new AuditLog({
      userId,
      action,
      entityType,
      entityId,
      details,
      ipAddress
    });
    await log.save();
    return log;
  } catch (error) {
    console.error('Failed to log audit action:', error);
    // Don't throw error to avoid breaking the main request flow
  }
};

module.exports = {
  logAction
};
