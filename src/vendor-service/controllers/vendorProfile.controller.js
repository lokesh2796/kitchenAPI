const UserProfile = require('../../models/userProfile.model');
const Users = require('../../models/users.model');
const MESSAGES = require('../../constants/messages');
const { sendEmail } = require('../../utils/notification.service');

// Helper to get profile
const getProfileByUserId = async (userId) => {
    return await UserProfile.findOne({ userId });
};

/**
 * Get Full Vendor Profile
 */
exports.getMyVendorProfile = async (req, res) => {
    try {
        const profile = await getProfileByUserId(req.user.id);
        if (!profile) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }
        res.status(200).json({ success: true, data: profile });
    } catch (error) {
        console.error('Get Profile Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR });
    }
};

/**
 * Step 1: Business Info & Location
 */
exports.updateStep1 = async (req, res) => {
    try {
        const {
            businessName,
            address1, businessAddress, // Map businessAddress -> address1
            address2, addressLine2,    // Map addressLine2 -> address2 (if needed)
            city,
            state,
            zip, zipcode,              // Map zipcode -> zip
            latitude, longitude
        } = req.body;

        const updateData = {
            businessName,
            vendorLocation: {
                address1: address1 || businessAddress,
                address2: address2 || addressLine2,
                city,
                state,
                zip: zip || zipcode,
                lat: latitude,
                long: longitude
            },
            'stepCompleted.step1': true // Mark Step 1 as completed
        };

        const profile = await UserProfile.findOneAndUpdate(
            { userId: req.user.id },
            { $set: updateData },
            { new: true, upsert: true } // Create if doesn't exist (though it should)
        );

        // ACTIVATE USER ACCOUNT and UPDATE PERSONAL INFO
        const userUpdateData = {
            status: 'a'
        };
        if (req.body.firstName) userUpdateData.firstName = req.body.firstName;
        if (req.body.lastName) userUpdateData.lastName = req.body.lastName;
        if (req.body.email) userUpdateData.email = req.body.email;
        if (req.body.mobileNumber) userUpdateData.phone = req.body.mobileNumber;

        await Users.findByIdAndUpdate(req.user.id, userUpdateData);

        // Send Partner Signup Email (with Kitchen Name)
        try {
            const user = await Users.findById(req.user.id);
            if (user && user.email) {
                const templateData = {
                    firstname: user.firstName || 'Partner',
                    kitchenName: businessName || 'Your Kitchen'
                };
                sendEmail(user.email, 'PARTNER_SIGNUP_CREATED', templateData).catch(err => console.error('Step 1 Email Error:', err));
            }
        } catch (emailErr) {
            console.error('Failed to send Partner Email:', emailErr);
        }

        res.status(200).json({ success: true, message: 'Step 1 Updated', data: profile });
    } catch (error) {
        console.error('Step 1 Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Step 2: Financial Info
 */
exports.updateStep2 = async (req, res) => {
    try {
        const { fullName, paypalId } = req.body;

        const updateData = {
            vendorPayment: {
                fullName,
                paypalId
            },
            'vendorAck.payment': true, // Mark Payment step as acknowledged/completed
            'stepCompleted.step2': true
        };

        const profile = await UserProfile.findOneAndUpdate(
            { userId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        res.status(200).json({ success: true, message: 'Step 2 Updated', data: profile });
    } catch (error) {
        console.error('Step 2 Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Step 3: Cancellation Policies
 */
exports.updateStep3 = async (req, res) => {
    try {
        const {
            offerFreeCancellation, freeCancellationDuration,
            offerPenaltyCancellation, penaltyTimeframe, penaltyFee,
            preOrderFreeCancellation, preOrderFreeDuration,
            preOrderPenaltyCancellation, preOrderPenaltyDuration, preOrderPenaltyFee
        } = req.body;

        const updateData = {
            todayCancelPolicy: {
                freeCancellation: offerFreeCancellation === 'yes',
                freeCancellationTime: freeCancellationDuration,
                paidCancellation: offerPenaltyCancellation === 'yes',
                paidCancelTime: penaltyTimeframe,
                paidCancelPenalty: penaltyFee
            },
            'vendorAck.cancellation': true,
            preOrderCancelPolicy: {
                freeCancellation: preOrderFreeCancellation === 'yes',
                freeCancellationTime: preOrderFreeDuration,
                paidCancellation: preOrderPenaltyCancellation === 'yes',
                paidCancelTime: preOrderPenaltyDuration,
                paidCancelPenalty: preOrderPenaltyFee
            },
            'stepCompleted.step3': true
        };

        const profile = await UserProfile.findOneAndUpdate(
            { userId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        res.status(200).json({ success: true, message: 'Step 3 Updated', data: profile });
    } catch (error) {
        console.error('Step 3 Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Step 4: Delivery Configuration
 */
exports.updateStep4 = async (req, res) => {
    try {
        // Expecting simplified delivery object or individual fields
        const {
            delivery, deliveryAvailable, // Map deliveryAvailable -> delivery
            deliveryMinAmt, minOrderAmount, // Map minOrderAmount -> deliveryMinAmt
            deliveryCharge,
            deliveryDistance, maxDistance // Map maxDistance -> deliveryDistance
        } = req.body;

        // Parse maxDistance (e.g. "10km" -> 10)
        let distanceVal = deliveryDistance;
        if (maxDistance) {
            distanceVal = parseInt(maxDistance) || 0;
        }

        const updateData = {
            deliveryPolicy: {
                delivery: (delivery === 'yes' || delivery === true) || (deliveryAvailable === 'yes' || deliveryAvailable === true),
                deliveryMinAmt: deliveryMinAmt || minOrderAmount,
                deliveryCharge,
                deliveryDistance: distanceVal
            },
            'vendorAck.delivery': true,
            'stepCompleted.step4': true
        };

        const profile = await UserProfile.findOneAndUpdate(
            { userId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        res.status(200).json({ success: true, message: 'Step 4 Updated', data: profile });
    } catch (error) {
        console.error('Step 4 Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Step 5: Terms Acknowledgement
 */
exports.updateStep5 = async (req, res) => {
    try {
        const { payment, cancellation, delivery, refund, terms } = req.body;

        const updateData = {
            'vendorAck.payment': payment,
            'vendorAck.cancellation': cancellation,
            'vendorAck.delivery': delivery,
            'vendorAck.refund': true, // Explicitly mark Refund policy as acknowledged
            // 'vendorAck.terms': true   // Explicitly mark Terms as acknowledged
            'stepCompleted.step5': true
        };

        const profile = await UserProfile.findOneAndUpdate(
            { userId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        res.status(200).json({ success: true, message: 'Step 5 Updated', data: profile });
    } catch (error) {
        console.error('Step 5 Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Step 6: Final Agreement & Activation
 */
exports.updateStep6 = async (req, res) => {
    try {
        // Assuming Step 6 is essentially final confirmation similar to Step 5 or just a "Complete" signal
        const { termsAccepted } = req.body;

        // If terms accepted, we might mark vendor as Active
        const updateData = {
            'vendorAck.terms': true, // Reinforce terms
            vendorStatus: 'Active',   // Activate Vendor
            // vendorCloseDate could be managed here if needed
            'stepCompleted.step6': true
        };

        const profile = await UserProfile.findOneAndUpdate(
            { userId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        // Also update the User identity status if needed
        await Users.findByIdAndUpdate(req.user.id, { isVendor: true });

        res.status(200).json({ success: true, message: 'Vendor Profile Completed & Activated', data: profile });
    } catch (error) {
        console.error('Step 6 Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
