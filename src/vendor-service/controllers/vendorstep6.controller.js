const VendorStep6 = require('../models/vendorstep6.model');
const Usersdetail = require('../../models/users.model');
const MESSAGES = require('../../constants/messages');

exports.createStep6 = async (req, res) => {
    try {
        const userId = req.user._id;

        // Ensure singleton
        let existingStep = await VendorStep6.findOne({ userId });
        if (existingStep) {
            return res.status(400).json({ success: false, message: 'Step 6 already created. Use PUT to update.' });
        }

        const step6 = new VendorStep6({ ...req.body, userId });
        await step6.save();

        // Final completion logic
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step6 = true;
            user.vendorProfile.onboardingStep.step6Id = step6._id;
            user.isVendorCreated = true;
            user.activeRole = 'VENDOR';
            await user.save();
        }

        res.status(201).json({ success: true, data: step6 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

exports.updateStep6 = async (req, res) => {
    try {
        const { id } = req.params;
        const step6 = await VendorStep6.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });

        if (!step6) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        // Sync (Ensure True)
        const Usersdetail = require('../../models/users.model');
        const userId = req.user._id;
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step6 = true;
            user.isVendorCreated = true;
            await user.save();
        }

        res.status(200).json({ success: true, data: step6 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

// Update Step 6 (Token Based)
exports.updateMyStep6 = async (req, res) => {
    try {
        const userId = req.user._id;
        const updateData = req.body;

        const step6 = await VendorStep6.findOneAndUpdate({ userId }, updateData, { new: true, runValidators: true });

        if (!step6) {
            return res.status(404).json({ success: false, message: 'Step 6 not found. Please create it first.' });
        }

        // Sync flags
        const Usersdetail = require('../../models/users.model');
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step6 = true;
            user.isVendorCreated = true;
            await user.save();
        }

        res.status(200).json({ success: true, data: step6 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

exports.getStep6 = async (req, res) => {
    try {
        const { id } = req.params;
        const step6 = await VendorStep6.findById(id);

        if (!step6) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step6 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

// Get Step 6 (By User Token)
exports.getMyStep6 = async (req, res) => {
    try {
        const userId = req.user._id;
        const step6 = await VendorStep6.findOne({ userId });

        if (!step6) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step6 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

exports.deleteStep6 = async (req, res) => {
    try {
        const { id } = req.params;
        const step6 = await VendorStep6.findByIdAndDelete(id);

        if (!step6) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, message: 'Step 6 deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};
