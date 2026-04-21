const Usersdetail = require('../../models/users.model');
const UserProfile = require('../../models/userProfile.model');

exports.createAccount = async (req, res) => {
    try {
        const account = new Usersdetail(req.body);
        await account.save();
        res.status(201).json({ success: true, data: account });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.getAccounts = async (req, res) => {
    try {
        const accounts = await Usersdetail.find();
        res.status(200).json({ success: true, data: accounts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Payment Methods Management

// Get all payment methods for a user
exports.getPaymentMethods = async (req, res) => {
    try {
        const { userId } = req.params;
        const userProfile = await UserProfile.findOne({ userId });

        if (!userProfile) {
            return res.status(404).json({ success: false, message: 'User profile not found' });
        }

        res.status(200).json({ success: true, data: userProfile.userPayment || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Add a new payment method
exports.addPaymentMethod = async (req, res) => {
    try {
        const { userId } = req.params;
        const paymentData = req.body;

        let userProfile = await UserProfile.findOne({ userId });

        if (!userProfile) {
            // Create new user profile if it doesn't exist
            userProfile = new UserProfile({ userId, userPayment: [] });
        }

        // If this is set as default, unset all other defaults
        if (paymentData.isDefault) {
            userProfile.userPayment.forEach(payment => {
                payment.isDefault = false;
            });
        }

        // Add the new payment method
        userProfile.userPayment.push(paymentData);
        await userProfile.save();

        res.status(201).json({
            success: true,
            message: 'Payment method added successfully',
            data: userProfile.userPayment
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

// Update a payment method
exports.updatePaymentMethod = async (req, res) => {
    try {
        const { userId, paymentId } = req.params;
        const updateData = req.body;

        const userProfile = await UserProfile.findOne({ userId });

        if (!userProfile) {
            return res.status(404).json({ success: false, message: 'User profile not found' });
        }

        const paymentIndex = userProfile.userPayment.findIndex(
            payment => payment._id.toString() === paymentId
        );

        if (paymentIndex === -1) {
            return res.status(404).json({ success: false, message: 'Payment method not found' });
        }

        // If this is set as default, unset all other defaults
        if (updateData.isDefault) {
            userProfile.userPayment.forEach((payment, index) => {
                if (index !== paymentIndex) {
                    payment.isDefault = false;
                }
            });
        }

        // Update the payment method
        Object.assign(userProfile.userPayment[paymentIndex], updateData);
        await userProfile.save();

        res.status(200).json({
            success: true,
            message: 'Payment method updated successfully',
            data: userProfile.userPayment
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

// Save FCM token for push notifications
exports.saveFcmToken = async (req, res) => {
    try {
        const userId = req.user._id;
        const { fcmToken } = req.body;
        if (!fcmToken) {
            return res.status(400).json({ success: false, message: 'fcmToken is required' });
        }
        await Usersdetail.findByIdAndUpdate(userId, { fcmToken });
        res.status(200).json({ success: true, message: 'FCM token saved' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Delete a payment method
exports.deletePaymentMethod = async (req, res) => {
    try {
        const { userId, paymentId } = req.params;

        const userProfile = await UserProfile.findOne({ userId });

        if (!userProfile) {
            return res.status(404).json({ success: false, message: 'User profile not found' });
        }

        const paymentIndex = userProfile.userPayment.findIndex(
            payment => payment._id.toString() === paymentId
        );

        if (paymentIndex === -1) {
            return res.status(404).json({ success: false, message: 'Payment method not found' });
        }

        // Remove the payment method
        userProfile.userPayment.splice(paymentIndex, 1);
        await userProfile.save();

        res.status(200).json({
            success: true,
            message: 'Payment method deleted successfully',
            data: userProfile.userPayment
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
