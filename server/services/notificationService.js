const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendEmail } = require('./emailService');

/**
 * Create a new in-app notification for a user
 * @param {String} userId - User ID to notify
 * @param {Object} data - Notification details
 * @param {String} data.title - Title of the notification
 * @param {String} data.message - Message content
 * @param {String} data.type - Type ('info', 'success', 'warning', 'danger')
 */
const createNotification = async (userId, { type, title, message }) => {
  try {
    const notification = new Notification({
      userId,
      title,
      message,
      type
    });

    await notification.save();
    console.log(`[Notification Service] Created notification for user ${userId}: ${title}`);
    return notification;
  } catch (error) {
    console.error(`[Notification Service] Error creating notification for user ${userId}:`, error);
    // Don't throw error to avoid crashing main flow, just log it
    return null;
  }
};

/**
 * Broadcast a notification to all admins
 * @param {String} senderId - ID of user triggering the action
 * @param {Object} data - Notification data
 */
const notifyAdmins = async (senderId, { type, title, message }) => {
  try {
    const admins = await User.find({ role: { $in: ['KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN'] } });
    
    const notificationPromises = admins.map(admin => {
      // Don't notify the sender themselves
      if (senderId && admin._id.toString() === senderId.toString()) return null;
      
      return new Notification({
        userId: admin._id,
        title,
        message,
        type
      }).save();
    });

    await Promise.all(notificationPromises.filter(p => p !== null));
    console.log(`[Notification Service] Broadcasted notification to ${admins.length} admins: ${title}`);

    // Also send emails to these admins
    const emailPromises = admins.map(admin => {
      if (senderId && admin._id.toString() === senderId.toString()) return null;
      return sendEmail({
        to: admin.email,
        subject: title,
        title: title,
        body: `<p>${message}</p>`,
        actionLink: `${process.env.FRONTEND_URL}/admin/applications`
      });
    });
    await Promise.all(emailPromises.filter(p => p !== null));

  } catch (error) {
    console.error(`[Notification Service] Error broadcasting to admins:`, error);
  }
};

/**
 * Notify a specific user with both in-app notification and email
 * @param {String} userId - User ID to notify
 * @param {Object} data - Notification details
 */
const notifyUserWithEmail = async (userId, { type, title, message, actionLink, actionText }) => {
  try {
    // 1. Create in-app notification
    await createNotification(userId, { type, title, message });

    // 2. Fetch user to get email
    const user = await User.findById(userId);
    if (user && user.email) {
      // 3. Send email
      await sendEmail({
        to: user.email,
        subject: title,
        title: title,
        body: `<p>${message}</p>`,
        actionLink: actionLink || `${process.env.FRONTEND_URL}/login`,
        actionText: actionText || 'View Details'
      });
    }
  } catch (error) {
    console.error(`[Notification Service] Error in notifyUserWithEmail:`, error);
  }
};

module.exports = {
  createNotification,
  notifyAdmins,
  notifyUserWithEmail
};
