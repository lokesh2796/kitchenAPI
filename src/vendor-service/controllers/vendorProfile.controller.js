const jwt = require('jsonwebtoken');
const UserProfile = require('../../models/userProfile.model');
const Users = require('../../models/users.model');
const MESSAGES = require('../../constants/messages');
const { sendEmail } = require('../../utils/notification.service');
const { computeStepCompletion } = require('../../utils/vendor-steps');

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

        // ────────────────────────────────────────────────────────────────
        // PROMOTION POINT: this is where a buyer-only user actually
        // becomes a vendor. switchRole no longer touches isVendor — it
        // only kicks the user into the stepper. If they fill out and
        // SAVE step 1, that commitment is what flips them to VENDOR. If
        // they back out before saving, this code never runs and they
        // remain a buyer with zero side effects.
        // ────────────────────────────────────────────────────────────────
        const userUpdateData = {
            status: 'a',
            isVendor: true,
            activeRole: 'VENDOR'
        };
        if (req.body.firstName) userUpdateData.firstName = req.body.firstName;
        if (req.body.lastName) userUpdateData.lastName = req.body.lastName;
        if (req.body.email) userUpdateData.email = req.body.email;
        if (req.body.mobileNumber) userUpdateData.phone = req.body.mobileNumber;

        const updatedUser = await Users.findByIdAndUpdate(
            req.user.id,
            userUpdateData,
            { new: true }
        );

        // Issue a fresh JWT carrying role:VENDOR. The Socket.IO handshake
        // middleware reads this on (re)connection to auto-join the
        // `vendor-${id}` private room. The frontend will save this token
        // and call socketService.reconnectWithToken() so the new vendor
        // immediately starts receiving NEW_ORDER events.
        const newToken = jwt.sign(
            { id: updatedUser._id, role: updatedUser.activeRole },
            process.env.JWT_SECRET || 'default_jwt_secret_key_change_me',
            { expiresIn: '30d' }
        );

        // Send Partner Signup Email (with Kitchen Name)
        try {
            if (updatedUser && updatedUser.email) {
                const templateData = {
                    firstname: updatedUser.firstName || 'Partner',
                    kitchenName: businessName || 'Your Kitchen'
                };
                sendEmail(updatedUser.email, 'PARTNER_SIGNUP_CREATED', templateData).catch(err => console.error('Step 1 Email Error:', err));
            }
        } catch (emailErr) {
            console.error('Failed to send Partner Email:', emailErr);
        }

        res.status(200).json({
            success: true,
            message: 'Step 1 Updated',
            token: newToken,
            data: profile
        });
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
        const { termsAccepted } = req.body;

        const updateData = {
            'vendorAck.terms': true,
            'stepCompleted.step6': true
        };

        const profile = await UserProfile.findOneAndUpdate(
            { userId: req.user.id },
            { $set: updateData },
            { new: true }
        );

        // Check if ALL 6 steps are completed — only then activate vendor
        const { allCompleted: allStepsCompleted } = computeStepCompletion(profile);

        if (allStepsCompleted) {
            profile.vendorStatus = 'Active';
            profile.kitchenOpen = true; // Auto-open kitchen when all steps done
            await profile.save();
        }

        await Users.findByIdAndUpdate(req.user.id, { isVendor: true });

        res.status(200).json({
            success: true,
            message: allStepsCompleted ? 'Vendor Profile Completed & Kitchen is Live!' : 'Step 6 Updated. Complete remaining steps to go live.',
            data: profile,
            allStepsCompleted,
            kitchenOpen: profile.kitchenOpen
        });
    } catch (error) {
        console.error('Step 6 Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Toggle Kitchen Open/Close
 * Only allowed when vendorStatus is 'Active' (all steps completed)
 */
exports.toggleKitchen = async (req, res) => {
    try {
        const profile = await getProfileByUserId(req.user.id);
        if (!profile) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        // Compute completeness via the shared helper. This is the single source
        // of truth for "is this vendor done with onboarding?" — readers never
        // touch profile.stepCompleted.stepN directly anymore.
        const { steps: effectiveSteps, allCompleted } = computeStepCompletion(profile);

        if (!allCompleted) {
            return res.status(400).json({
                success: false,
                message: 'Complete all onboarding steps before toggling kitchen status.',
                stepCompleted: effectiveSteps
            });
        }

        // Self-heal: backfill any missing stepCompleted flags and activate
        // the vendor so the DB matches what the helper already considers true.
        const dbSteps = profile.stepCompleted || {};
        let mutated = false;
        for (const k of ['step1', 'step2', 'step3', 'step4', 'step5', 'step6']) {
            if (!dbSteps[k] && effectiveSteps[k]) {
                profile.stepCompleted = profile.stepCompleted || {};
                profile.stepCompleted[k] = true;
                mutated = true;
            }
        }
        if (profile.vendorStatus !== 'Active') {
            profile.vendorStatus = 'Active';
            mutated = true;
        }

        // Toggle kitchen open/close
        profile.kitchenOpen = !profile.kitchenOpen;
        if (!profile.kitchenOpen) {
            profile.vendorCloseDate = new Date();
        } else {
            profile.vendorCloseDate = null;
        }
        // Mark nested paths as modified so Mongoose persists them.
        if (mutated) profile.markModified('stepCompleted');
        await profile.save();

        res.status(200).json({
            success: true,
            message: profile.kitchenOpen ? 'Kitchen is now OPEN' : 'Kitchen is now CLOSED',
            data: {
                kitchenOpen: profile.kitchenOpen,
                vendorStatus: profile.vendorStatus
            }
        });
    } catch (error) {
        console.error('Toggle Kitchen Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR });
    }
};

/**
 * Get Vendor Onboarding Progress
 */
exports.getOnboardingProgress = async (req, res) => {
    try {
        const profile = await getProfileByUserId(req.user.id);
        if (!profile) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        const { steps, allCompleted: allStepsCompleted, completedCount } = computeStepCompletion(profile);

        res.status(200).json({
            success: true,
            data: {
                stepCompleted: steps,
                allStepsCompleted,
                completedCount,
                totalSteps: 6,
                vendorStatus: profile.vendorStatus,
                kitchenOpen: profile.kitchenOpen,
                needsOnboarding: !steps.step1
            }
        });
    } catch (error) {
        console.error('Get Progress Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR });
    }
};
