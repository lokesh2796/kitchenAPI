const VendorStep3 = require('../models/vendorstep3.model');
const Usersdetail = require('../../models/users.model');
const MESSAGES = require('../../constants/messages');

exports.createStep3 = async (req, res) => {
    try {
        const userId = req.user._id;

        // Ensure singleton
        let existingStep = await VendorStep3.findOne({ userId });
        if (existingStep) {
            return res.status(400).json({ success: false, message: 'Step 3 already created. Use PUT to update.' });
        }

        const step3 = new VendorStep3({ ...req.body, userId });
        await step3.save();

        // Sync
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step3 = true;
            user.vendorProfile.onboardingStep.step3Id = step3._id;
            await user.save();
        }

        res.status(201).json({ success: true, data: step3 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

exports.updateStep3 = async (req, res) => {
    try {
        const { id } = req.params;
        const step3 = await VendorStep3.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });

        if (!step3) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        // Sync (Ensure True)
        const userId = req.user._id;
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step3 = true;
            await user.save();
        }

        res.status(200).json({ success: true, data: step3 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

// Update Step 3 (Token Based)
exports.updateMyStep3 = async (req, res) => {
    try {
        const userId = req.user._id;
        const updateData = req.body;

        const step3 = await VendorStep3.findOneAndUpdate({ userId }, updateData, { new: true, runValidators: true });

        if (!step3) {
            return res.status(404).json({ success: false, message: 'Step 3 not found. Please create it first.' });
        }

        // Sync flags
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step3 = true;
            await user.save();
        }

        res.status(200).json({ success: true, data: step3 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

exports.getStep3 = async (req, res) => {
    try {
        const { id } = req.params;
        const step3 = await VendorStep3.findById(id);

        if (!step3) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step3 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

// Get Step 3 (By User Token)
exports.getMyStep3 = async (req, res) => {
    try {
        const userId = req.user._id;
        const step3 = await VendorStep3.findOne({ userId });

        if (!step3) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step3 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

exports.deleteStep3 = async (req, res) => {
    try {
        const { id } = req.params;
        const step3 = await VendorStep3.findByIdAndDelete(id);

        if (!step3) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, message: 'Step 3 deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};
