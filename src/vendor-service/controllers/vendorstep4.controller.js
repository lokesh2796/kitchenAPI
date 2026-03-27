const VendorStep4 = require('../models/vendorstep4.model');
const Usersdetail = require('../../models/users.model');
const MESSAGES = require('../../constants/messages');

exports.createStep4 = async (req, res) => {
    try {
        const userId = req.user._id;

        // Ensure singleton
        let existingStep = await VendorStep4.findOne({ userId });
        if (existingStep) {
            return res.status(400).json({ success: false, message: 'Step 4 already created. Use PUT to update.' });
        }

        // Logic: if deliveryAvailable is 'no', clear out other fields
        if (req.body.deliveryAvailable === 'no') {
            req.body.minOrderAmount = null;
            req.body.deliveryCharge = null;
            req.body.maxDistance = null;
        }

        const step4 = new VendorStep4({ ...req.body, userId });
        await step4.save();

        // Sync
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step4 = true;
            user.vendorProfile.onboardingStep.step4Id = step4._id;
            await user.save();
        }

        res.status(201).json({ success: true, data: step4 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

exports.updateStep4 = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        // Logic: if deliveryAvailable is 'no', clear out other fields
        if (updateData.deliveryAvailable === 'no') {
            updateData.minOrderAmount = null;
            updateData.deliveryCharge = null;
            updateData.maxDistance = null;
        }

        const step4 = await VendorStep4.findById(id);
        if (!step4) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        Object.assign(step4, updateData);
        await step4.save();

        // Sync (Ensure True)
        const userId = req.user._id;
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step4 = true;
            await user.save();
        }

        res.status(200).json({ success: true, data: step4 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

// Update Step 4 (Token Based)
exports.updateMyStep4 = async (req, res) => {
    try {
        const userId = req.user._id;
        const updateData = req.body;

        // Logic: if deliveryAvailable is 'no', clear out other fields
        if (updateData.deliveryAvailable === 'no') {
            updateData.minOrderAmount = null;
            updateData.deliveryCharge = null;
            updateData.maxDistance = null;
        }

        const step4 = await VendorStep4.findOne({ userId });
        if (!step4) {
            return res.status(404).json({ success: false, message: 'Step 4 not found. Please create it first.' });
        }

        Object.assign(step4, updateData);
        await step4.save();

        // Sync flags
        const user = await Usersdetail.findById(userId);
        if (user) {
            user.vendorProfile.stepCompleted.step4 = true;
            await user.save();
        }

        res.status(200).json({ success: true, data: step4 });
    } catch (error) {
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

exports.getStep4 = async (req, res) => {
    try {
        const { id } = req.params;
        const step4 = await VendorStep4.findById(id);

        if (!step4) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step4 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

// Get Step 4 (By User Token)
exports.getMyStep4 = async (req, res) => {
    try {
        const userId = req.user._id;
        const step4 = await VendorStep4.findOne({ userId });

        if (!step4) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step4 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

exports.deleteStep4 = async (req, res) => {
    try {
        const { id } = req.params;
        const step4 = await VendorStep4.findByIdAndDelete(id);

        if (!step4) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, message: 'Step 4 deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};
