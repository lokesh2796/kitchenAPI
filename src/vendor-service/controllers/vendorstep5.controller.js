const VendorStep5 = require('../models/vendorstep5.model');
const Usersdetail = require('../../models/users.model');
const MESSAGES = require('../../constants/messages');

exports.createStep5 = async (req, res) => {
    try {
        const userId = req.user._id;

        // Ensure singleton
        let existingStep = await VendorStep5.findOne({ userId });
        if (existingStep) {
            return res.status(400).json({ success: false, message: 'Step 5 already created. Use PUT to update.' });
        }

        const step5 = new VendorStep5({ ...req.body, userId });
        await step5.save();

        // Sync
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step5 = true;
            user.vendorProfile.onboardingStep.step5Id = step5._id;
            await user.save();
        }

        res.status(201).json({ success: true, data: step5 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

exports.updateStep5 = async (req, res) => {
    try {
        const { id } = req.params;
        const step5 = await VendorStep5.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });

        if (!step5) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        // Sync (Ensure True)
        const userId = req.user._id;
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step5 = true;
            await user.save();
        }

        res.status(200).json({ success: true, data: step5 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

// Update Step 5 (Token Based)
exports.updateMyStep5 = async (req, res) => {
    try {
        const userId = req.user._id;
        const updateData = req.body;

        const step5 = await VendorStep5.findOneAndUpdate({ userId }, updateData, { new: true, runValidators: true });

        if (!step5) {
            return res.status(404).json({ success: false, message: 'Step 5 not found. Please create it first.' });
        }

        // Sync flags
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step5 = true;
            await user.save();
        }

        res.status(200).json({ success: true, data: step5 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

exports.getStep5 = async (req, res) => {
    try {
        const { id } = req.params;
        const step5 = await VendorStep5.findById(id);

        if (!step5) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step5 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

// Get Step 5 (By User Token)
exports.getMyStep5 = async (req, res) => {
    try {
        const userId = req.user._id;
        const step5 = await VendorStep5.findOne({ userId });

        if (!step5) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step5 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

exports.deleteStep5 = async (req, res) => {
    try {
        const { id } = req.params;
        const step5 = await VendorStep5.findByIdAndDelete(id);

        if (!step5) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, message: 'Step 5 deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};
