const VendorStep2 = require('../models/vendorstep2.model');
const Usersdetail = require('../../models/users.model');
const MESSAGES = require('../../constants/messages');

exports.createStep2 = async (req, res) => {
    try {
        const userId = req.user._id;

        // Ensure singleton
        let existingStep = await VendorStep2.findOne({ userId });
        if (existingStep) {
            return res.status(400).json({ success: false, message: 'Step 2 already created. Use PUT to update.' });
        }

        const step2 = new VendorStep2({ ...req.body, userId });
        await step2.save();

        // Sync to Usersdetail
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step2 = true;
            user.vendorProfile.onboardingStep.step2Id = step2._id;
            await user.save();
        }

        res.status(201).json({ success: true, data: step2 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

exports.updateStep2 = async (req, res) => {
    try {
        const { id } = req.params;
        const step2 = await VendorStep2.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });

        if (!step2) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        // Sync (Ensure True)
        const userId = req.user._id;
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step2 = true;
            await user.save();
        }

        res.status(200).json({ success: true, data: step2 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

// Update Step 2 (Token Based)
exports.updateMyStep2 = async (req, res) => {
    try {
        const userId = req.user._id;
        const updateData = req.body;

        const step2 = await VendorStep2.findOneAndUpdate({ userId }, updateData, { new: true, runValidators: true });

        if (!step2) {
            return res.status(404).json({ success: false, message: 'Step 2 not found. Please create it first.' });
        }

        // Sync flags
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step2 = true;
            await user.save();
        }

        res.status(200).json({ success: true, data: step2 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

exports.getStep2 = async (req, res) => {
    try {
        const { id } = req.params;
        const step2 = await VendorStep2.findById(id);

        if (!step2) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step2 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

// Get Step 2 (By User Token)
exports.getMyStep2 = async (req, res) => {
    try {
        const userId = req.user._id;
        const step2 = await VendorStep2.findOne({ userId });

        if (!step2) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step2 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

exports.deleteStep2 = async (req, res) => {
    try {
        const { id } = req.params;
        const step2 = await VendorStep2.findByIdAndDelete(id);

        if (!step2) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, message: 'Step 2 deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};
