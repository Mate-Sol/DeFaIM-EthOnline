const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const SupportTicket = require('../models/SupportTicket');
const { createNotification } = require('../services/notificationService');

// Apply authentication to all support routes
router.use(authMiddleware);

// Helper to generate a human-readable Ticket ID
const generateTicketId = () => {
  return `ST-${Math.floor(1000 + Math.random() * 9000)}-${Date.now().toString().slice(-4)}`;
};

// @route   GET /support/tickets
// @desc    Get all tickets (filtered by user if PSP, all for Admin)
// @access  Private
router.get('/tickets', async (req, res) => {
  try {
    let query = {};
    
    // If not an admin role, only show user's own tickets
    if (req.user.role === 'PSP') {
      query.creatorId = req.user.userId;
    }

    const tickets = await SupportTicket.find(query)
      .populate('creatorId', 'name email companyName')
      .sort({ updatedAt: -1 });

    res.json(tickets);
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /support/tickets/:id
// @desc    Get single ticket with messages
// @access  Private
router.get('/tickets/:id', async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id)
      .populate('creatorId', 'name email companyName')
      .populate('messages.senderId', 'name email role');

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Authorization check: Only creator or admin can view
    if (req.user.role === 'PSP' && ticket.creatorId._id.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ message: 'Not authorized to view this ticket' });
    }

    res.json(ticket);
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /support/tickets
// @desc    Create new support ticket
// @access  Private (PSP Only)
router.post('/tickets', async (req, res) => {
  try {
    const { subject, message } = req.body;

    if (!subject || !message) {
      return res.status(400).json({ message: 'Subject and message are required' });
    }

    const ticketId = generateTicketId();

    const newTicket = new SupportTicket({
      ticketId,
      creatorId: req.user.userId,
      subject,
      status: 'open',
      messages: [{
        senderId: req.user.userId,
        senderType: 'user',
        message,
        timestamp: new Date()
      }],
      logs: [{
        action: 'created',
        actorId: req.user.userId,
        timestamp: new Date()
      }]
    });

    await newTicket.save();

    // Notify admins
    try {
      // Assuming createNotification handles admin notification or we use notifyAdmins if available
      const { notifyAdmins } = require('../services/notificationService');
      await notifyAdmins(req.user.userId, {
        title: 'New Support Ticket',
        message: `New ticket ${ticketId} created by ${req.user.name}: ${subject}`,
        type: 'info'
      });
    } catch (err) {
      console.warn('Admin notification failed:', err.message);
    }

    res.status(201).json(newTicket);
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /support/tickets/:id/message
// @desc    Add a message to a ticket (reply)
// @access  Private
router.post('/tickets/:id/message', async (req, res) => {
  try {
    const { message } = req.body;
    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    if (ticket.status === 'closed') {
      return res.status(400).json({ message: 'Cannot reply to a closed ticket' });
    }

    // Role check
    const senderType = ['KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN'].includes(req.user.role) ? 'admin' : 'user';

    // If user is PSP, ensure they own the ticket
    if (senderType === 'user' && ticket.creatorId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ message: 'Not authorized to reply to this ticket' });
    }

    ticket.messages.push({
      senderId: req.user.userId,
      senderType,
      message,
      timestamp: new Date()
    });

    ticket.logs.push({
      action: 'replied',
      actorId: req.user.userId,
      timestamp: new Date()
    });

    // Update updatedAt
    ticket.updatedAt = new Date();
    await ticket.save();

    // Notify other party
    try {
      if (senderType === 'admin') {
        // Notify the user
        await createNotification(ticket.creatorId, {
          title: 'New Support Reply',
          message: `Admin replied to your ticket: ${ticket.ticketId}`,
          type: 'info'
        });
      } else {
        // Notify admins
        const { notifyAdmins } = require('../services/notificationService');
        await notifyAdmins(req.user.userId, {
          title: 'New Ticket Reply',
          message: `User replied to ticket ${ticket.ticketId}`,
          type: 'info'
        });
      }
    } catch (err) {
      console.warn('Reply notification failed:', err.message);
    }

    res.json(ticket);
  } catch (error) {
    console.error('Error replying to ticket:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /support/tickets/:id/close
// @desc    Close a ticket
// @access  Private
router.post('/tickets/:id/close', async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Authorization: Only owner or admin can close
    const isAdmin = ['KAM', 'CAD', 'CRO', 'CFO', 'VIEW_ONLY_ADMIN'].includes(req.user.role);
    if (!isAdmin && ticket.creatorId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ message: 'Not authorized to close this ticket' });
    }

    ticket.status = 'closed';
    ticket.logs.push({
      action: 'closed',
      actorId: req.user.userId,
      timestamp: new Date()
    });

    ticket.updatedAt = new Date();
    await ticket.save();

    // Notify user if admin closed it
    if (isAdmin && ticket.creatorId.toString() !== req.user.userId.toString()) {
      try {
        await createNotification(ticket.creatorId, {
          title: 'Support Ticket Closed',
          message: `Your ticket ${ticket.ticketId} has been closed by an admin.`,
          type: 'info'
        });
      } catch (err) {
        console.warn('Closing notification failed:', err.message);
      }
    }

    res.json(ticket);
  } catch (error) {
    console.error('Error closing ticket:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
