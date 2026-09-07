const express = require('express');
const router = express.Router();
const Segment = require('../models/Segment');
const { authMiddleware, authorizeRoles } = require('../middleware/auth');

// Apply authentication to all segment routes
// router.use(authMiddleware);

// @route   POST /api/segment
// @desc    Generate/Create a new segment
// @access  Private (CAD, CRO, KAM)
// router.post('/', authorizeRoles('CAD', 'CRO', 'KAM'), async (req, res) => {
router.post('/', async (req, res) => {
    try {
        const { key, onboardingEnabled, features, flowConfig } = req.body;

        if (!key) {
            return res.status(400).json({ message: 'Key are required' });
        }

        // Check if segment with this key already exists
        let segment = await Segment.findOne({ key });
        if (segment) {
            return res.status(400).json({ message: 'Segment with this key already exists' });
        }

        segment = new Segment({
            key: key.toUpperCase(),
            onboardingEnabled: onboardingEnabled !== undefined ? onboardingEnabled : true,
            features: features || { thirdPartyApi: false },
            flowConfig: flowConfig || {}
        });

        await segment.save();

        res.status(201).json({
            message: 'Segment generated successfully',
            segment
        });
    } catch (error) {
        console.error('Error generating segment:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// @route   GET /api/segment
// @desc    Get all segments
// @access  Private (All authenticated users)
router.get('/', async (req, res) => {
    try {
        const segments = await Segment.find().sort({ name: 1 });
        res.json(segments);
    } catch (error) {
        console.error('Error fetching segments:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/segment/:id
// @desc    Get segment by ID
// @access  Private (All authenticated users)
router.get('/:id', async (req, res) => {
    try {
        const segment = await Segment.findById(req.params.id);
        if (!segment) {
            return res.status(404).json({ message: 'Segment not found' });
        }
        res.json(segment);
    } catch (error) {
        console.error('Error fetching segment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PATCH /api/segment/:id
// @desc    Update segment
// @access  Private (CAD, CRO)
router.patch('/:id', authorizeRoles('CAD', 'CRO'), async (req, res) => {
    try {
        const segment = await Segment.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true, runValidators: true }
        );

        if (!segment) {
            return res.status(404).json({ message: 'Segment not found' });
        }

        res.json({
            message: 'Segment updated successfully',
            segment
        });
    } catch (error) {
        console.error('Error updating segment:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

module.exports = router;
