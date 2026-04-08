const jwt = require('jsonwebtoken');
const Users = require('../../models/users.model');
const UserProfile = require('../../models/userProfile.model');
const MESSAGES = require('../../constants/messages');
const { sendEmail, sendSmsNotification } = require('../../utils/notification.service');
const { computeStepCompletion } = require('../../utils/vendor-steps');

/**
 * Get User Profile (including Addresses)
 */
exports.getProfile = async (req, res) => {
    try {
        const userId = req.user.id; // Corrected from _id to id (middleware usually attaches id)
        const user = await Users.findById(userId);

        if (!user) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        let userProfile = await UserProfile.findOne({ userId: user._id });
        if (!userProfile) {
            // Create empty profile if missing
            userProfile = new UserProfile({ userId: user._id });
            await userProfile.save();
        }

        const activeRole = user.activeRole || (user.isVendor ? 'VENDOR' : 'USER');

        // Base profile data
        const profileData = {
            id: user._id,
            _id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            firstname: user.firstName,
            lastname: user.lastName,
            email: user.email,
            mobile: user.phone,
            phone: user.phone,
            countryCode: user.countryCode,
            activeRole: activeRole,
            role: activeRole,
            userType: activeRole,

            // Vendor capability flags — exposed so the frontend can detect
            // a user who CAN be a vendor even when their activeRole is
            // currently flipped to USER. The orders page uses these to
            // decide whether to call /orders/vendor vs /orders/my.
            isVendor: !!user.isVendor,
            isVendorCreated: !!user.isVendor,

            // Addresses from UserProfile
            addresses: userProfile.deliveryAddress || [],
            paymentMethods: userProfile.userPayment || []
        };

        if (activeRole === 'VENDOR') {
            profileData.vendorProfile = userProfile.toObject();

            // Single source of truth for step completion (handles legacy data
            // where stepCompleted flags weren't persisted).
            const { steps, allCompleted: allStepsCompleted } = computeStepCompletion(userProfile);
            profileData.vendorProfile.stepCompleted = steps;
            profileData.stepCompleted = steps;
            profileData.allStepsCompleted = allStepsCompleted;

            profileData.kitchenStatus = !allStepsCompleted ? 'PENDING'
                : (userProfile.kitchenOpen ? 'OPEN' : 'CLOSED');
            profileData.isLive = allStepsCompleted && userProfile.kitchenOpen;
            profileData.kitchenOpen = userProfile.kitchenOpen || false;
            profileData.needsOnboarding = !steps.step1;
        } else {
            profileData.isLive = false;
            profileData.kitchenOpen = false;
        }

        res.status(200).json({ success: true, data: profileData });
    } catch (error) {
        console.error('Get Profile Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Update Profile (Name)
 */
exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { firstName, lastName, firstname, lastname } = req.body;

        const finalFirstname = firstName || firstname;
        const finalLastname = lastName || lastname;

        const updatedUser = await Users.findByIdAndUpdate(
            userId,
            {
                $set: {
                    ...(finalFirstname && { firstName: finalFirstname }),
                    ...(finalLastname && { lastName: finalLastname })
                }
            },
            { new: true } // Return updated
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }
        res.status(200).json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Add Address
 */
exports.addAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const { label, addressLine, addressLine2, city, state, zipCode, country, latitude, longitude, mobile, isDefault } = req.body;

        const userProfile = await UserProfile.findOne({ userId });
        if (!userProfile) return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });

        const newAddress = {
            label: label || 'Home',
            address1: addressLine, // Schema uses address1
            address2: addressLine2,
            lat: latitude,
            long: longitude,
            city,
            state,
            zip: zipCode, // Schema uses zip
            country,
            phone: mobile,
            isDefault: isDefault || false
        };
        // Note: lat/long for user address not in sub-schema? userProfileSchema.deliveryAddress doesn't have lat/long. 
        // userProfileSchema.location HAS lat/long. 
        // If frontend sends lat/long for address, we might strictly lose it unless schema updated. 
        // Proceeding with available schema fields.

        if (isDefault && userProfile.deliveryAddress) {
            userProfile.deliveryAddress.forEach(a => a.isDefault = false);
        }

        if (!userProfile.deliveryAddress) userProfile.deliveryAddress = [];
        userProfile.deliveryAddress.push(newAddress);

        await userProfile.save();

        res.status(201).json({ success: true, message: 'Address added', data: userProfile.deliveryAddress });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Edit Address
 */
exports.editAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const { addressId } = req.params;
        const updateData = req.body;

        const userProfile = await UserProfile.findOne({ userId });
        if (!userProfile) return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });

        const address = userProfile.deliveryAddress.id(addressId);
        if (!address) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        // Map fields from frontend to backend schema
        if (updateData.label !== undefined) address.label = updateData.label;
        if (updateData.addressLine !== undefined) address.address1 = updateData.addressLine;
        if (updateData.addressLine2 !== undefined) address.address2 = updateData.addressLine2;
        if (updateData.city !== undefined) address.city = updateData.city;
        if (updateData.state !== undefined) address.state = updateData.state;
        if (updateData.zipCode !== undefined) address.zip = updateData.zipCode;
        if (updateData.mobile !== undefined) address.phone = updateData.mobile;
        if (updateData.latitude !== undefined) address.lat = updateData.latitude;
        if (updateData.longitude !== undefined) address.long = updateData.longitude;

        if (updateData.isDefault) {
            userProfile.deliveryAddress.forEach(a => {
                if (a._id.toString() !== addressId) a.isDefault = false;
            });
            address.isDefault = true;
        }

        await userProfile.save();
        res.status(200).json({ success: true, message: 'Address updated', data: address });

    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Get Address By ID
 */
exports.getAddressById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { addressId } = req.params;

        const userProfile = await UserProfile.findOne({ userId });
        if (!userProfile) return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });

        const address = userProfile.deliveryAddress.id(addressId);
        if (!address) {
            return res.status(404).json({ success: false, message: 'Address not found' });
        }

        res.status(200).json({ success: true, data: address });

    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Switch Active Role (USER <-> VENDOR)
 */
exports.switchRole = async (req, res) => {
    try {
        const userId = req.user.id;
        const { role } = req.body;
        const targetRole = role ? role.toUpperCase() : 'USER';

        const user = await Users.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });

        const userProfile = await UserProfile.findOne({ userId });
        const { steps: stepCompleted, allCompleted: allStepsCompleted } = computeStepCompletion(userProfile);

        // ────────────────────────────────────────────────────────────────
        // Promotion gate: a USER becomes a VENDOR ONLY after completing
        // step 1 of the onboarding stepper. Clicking "Become Vendor" is
        // therefore a *request* to start onboarding — it does NOT flip
        // their role or set isVendor. If they back out of the stepper
        // before saving step 1 they remain a buyer with zero side effects.
        //
        // Once step 1 is saved, vendorProfile.controller.js#updateStep1
        // sets user.isVendor=true + user.activeRole='VENDOR' and that is
        // the moment they actually become a vendor. From then on this
        // endpoint is just a view-toggle between buyer and kitchen.
        // ────────────────────────────────────────────────────────────────
        if (targetRole === 'VENDOR' && !user.isVendor) {
            // First-time "Become Vendor" — DO NOT mutate the user record.
            // Tell the frontend to send them to /mainstep. The existing
            // JWT (still role:USER) is fine; they don't yet need vendor
            // socket room access — they have no kitchen, no orders.
            return res.status(200).json({
                success: true,
                message: 'Onboarding required to become a vendor',
                // No new token — existing one stays valid as a USER token
                data: {
                    activeRole: user.activeRole, // unchanged
                    isVendorCreated: false,
                    isLive: false,
                    needsOnboarding: true,
                    stepCompleted,
                    allStepsCompleted: false,
                    kitchenOpen: false,
                    vendorAck: userProfile ? (userProfile.vendorAck || {}) : {}
                }
            });
        }

        // Past this point: either switching back to USER, or switching to
        // VENDOR for someone who is already a vendor (step 1 done before).
        user.activeRole = targetRole;
        await user.save();

        const vendorAck = userProfile ? (userProfile.vendorAck || {}) : {};
        const needsOnboarding = targetRole === 'VENDOR' && !stepCompleted.step1;
        const kitchenOpen = userProfile ? (userProfile.kitchenOpen || false) : false;

        // Issue a fresh JWT carrying the new role. The Socket.IO handshake
        // middleware uses the JWT's `role` claim to auto-join the
        // `vendor-${id}` private room — without re-issuing the token, a
        // user who switches USER → VENDOR mid-session would never receive
        // NEW_ORDER events because their socket is still in the USER room.
        const newToken = jwt.sign(
            { id: user._id, role: user.activeRole },
            process.env.JWT_SECRET || 'default_jwt_secret_key_change_me',
            { expiresIn: '30d' }
        );

        res.status(200).json({
            success: true,
            message: `Switched to ${targetRole} view`,
            token: newToken,
            data: {
                activeRole: user.activeRole,
                isVendorCreated: user.isVendor,
                isLive: allStepsCompleted && kitchenOpen,
                needsOnboarding,
                stepCompleted,
                allStepsCompleted,
                kitchenOpen,
                vendorAck
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Delete Address
 */
exports.deleteAddress = async (req, res) => {
    try {
        const userId = req.user.id;
        const { addressId } = req.params;

        const userProfile = await UserProfile.findOne({ userId });
        if (!userProfile) return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });

        userProfile.deliveryAddress.pull(addressId);
        await userProfile.save();

        res.status(200).json({ success: true, message: 'Address deleted', data: userProfile.deliveryAddress });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Change Password
 */
exports.changePassword = async (req, res) => {
    try {
        const userId = req.user.id;
        const { oldPassword, newPassword } = req.body;

        const user = await Users.findById(userId).select('+password');
        if (!user) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        // Verify Old Password
        const decryptedPassword = require('../../utils/encryption').decrypt(user.password);
        if (decryptedPassword !== oldPassword) {
            return res.status(401).json({ success: false, message: 'Invalid old password' });
        }

        // Set New Password
        user.password = require('../../utils/encryption').encrypt(newPassword);
        await user.save();

        // Send Email
        sendEmail(user.email, 'PASSWORD_CHANGED', {
            firstname: user.firstName || 'User'
        }).catch(err => console.error('Email Notification Error:', err.message));

        res.status(200).json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change Password Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

// ... Payment methods follow similar pattern to addresses using UserProfile ...

/**
 * Add Payment Method
 */
exports.addPaymentMethod = async (req, res) => {
    try {
        const userId = req.user.id;
        const paymentData = req.body;

        let userProfile = await UserProfile.findOne({ userId });
        if (!userProfile) {
            userProfile = new UserProfile({ userId });
        }

        // If this is set as default, unset all other defaults
        if (paymentData.isDefault) {
            userProfile.userPayment.forEach(payment => {
                payment.isDefault = false;
            });
        }

        // Add the new payment method
        userProfile.userPayment.push({
            methodType: paymentData.methodType,
            provider: paymentData.provider,
            accountName: paymentData.accountName,
            accountNumber: paymentData.accountNumber,
            expiryDate: paymentData.expiryDate,
            isDefault: paymentData.isDefault || false
        });

        await userProfile.save();
        res.status(201).json({
            success: true,
            message: 'Payment method added successfully',
            data: userProfile.userPayment
        });
    } catch (error) {
        console.error('Add Payment Method Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Edit Payment Method
 */
exports.editPaymentMethod = async (req, res) => {
    try {
        const userId = req.user.id;
        const { paymentId } = req.params;
        const updateData = req.body;

        const userProfile = await UserProfile.findOne({ userId });
        if (!userProfile) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        const payment = userProfile.userPayment.id(paymentId);
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment method not found' });
        }

        // Update payment fields
        if (updateData.methodType !== undefined) payment.methodType = updateData.methodType;
        if (updateData.provider !== undefined) payment.provider = updateData.provider;
        if (updateData.accountName !== undefined) payment.accountName = updateData.accountName;
        if (updateData.accountNumber !== undefined) payment.accountNumber = updateData.accountNumber;
        if (updateData.expiryDate !== undefined) payment.expiryDate = updateData.expiryDate;

        // Handle default flag
        if (updateData.isDefault) {
            userProfile.userPayment.forEach(p => {
                if (p._id.toString() !== paymentId) p.isDefault = false;
            });
            payment.isDefault = true;
        } else if (updateData.isDefault === false) {
            payment.isDefault = false;
        }

        await userProfile.save();
        res.status(200).json({
            success: true,
            message: 'Payment method updated successfully',
            data: payment
        });

    } catch (error) {
        console.error('Edit Payment Method Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Delete Payment Method
 */
exports.deletePaymentMethod = async (req, res) => {
    try {
        const userId = req.user.id;
        const { paymentId } = req.params;

        const userProfile = await UserProfile.findOne({ userId });
        if (!userProfile) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        // Remove the payment method using Mongoose pull
        userProfile.userPayment.pull(paymentId);
        await userProfile.save();

        res.status(200).json({
            success: true,
            message: 'Payment method deleted successfully',
            data: userProfile.userPayment
        });

    } catch (error) {
        console.error('Delete Payment Method Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Get Payment Method By ID
 */
exports.getPaymentMethodById = async (req, res) => {
    try {
        const userId = req.user.id;
        const { paymentId } = req.params;

        const userProfile = await UserProfile.findOne({ userId });
        if (!userProfile) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        const payment = userProfile.userPayment.id(paymentId);
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment method not found' });
        }

        res.status(200).json({ success: true, data: payment });

    } catch (error) {
        console.error('Get Payment Method Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

exports.getAddresses = async (req, res) => { exports.getProfile(req, res); }; // Reuse profile fetch for now
exports.getPaymentMethods = async (req, res) => { exports.getProfile(req, res); };
// getAddressById is implemented above at line ~202
exports.getAddressesByIds = async (req, res) => { res.status(501).json({ message: 'Not implemented' }); };
exports.getPaymentMethodsByIds = async (req, res) => { res.status(501).json({ message: 'Not implemented' }); };
exports.initiateMobileChange = async (req, res) => { res.status(501).json({ message: 'Not implemented/Pending Refactor' }); };
exports.verifyMobileChangeOtp = async (req, res) => { res.status(501).json({ message: 'Not implemented/Pending Refactor' }); };

