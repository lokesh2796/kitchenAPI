const VendorStep1 = require('../models/vendorstep1.model');
const MESSAGES = require('../../constants/messages');

// Create Step 1
exports.createStep1 = async (req, res) => {
    try {
        const { firstName, lastName, businessName, businessAddress, city, state, zipcode, email, mobileNumber, latitude, longitude } = req.body;
        // From verified token
        const userId = req.user._id;

        // 1. Check if Step 1 already exists for this user (Update vs Create logic, or restriction)
        let existingStep1 = await VendorStep1.findOne({ userId });
        if (existingStep1) {
            return res.status(400).json({ success: false, message: 'Step 1 already created. Use PUT to update.' });
        }

        // 2. Uniqueness Check (Mobile / Email in Vendor Collection if needed, but primarily User collection is master)
        // User asked: "vendor step need to be unique use mobile number are email id"
        const existingBusiness = await VendorStep1.findOne({
            businessName: businessName.trim().toLowerCase(),
            zipcode: zipcode,
            userId: { $ne: userId } // exclude self
        });
        if (existingBusiness) {
            return res.status(400).json({ success: false, message: 'Vendor with this business name or zipcode already exists.' });
        }

        const step1 = new VendorStep1({
            businessName,
            businessAddress,
            city,
            state,
            zipcode,
            email,
            mobileNumber,
            userId
        });

        await step1.save();

        // 3. Sync to Usersdetail
        const Usersdetail = require('../../models/users.model');
        const user = await Usersdetail.findById(userId);

        if (user) {
            // A. Set Step Completed and ID
            user.vendorProfile.stepCompleted = user.vendorProfile.stepCompleted || {};
            user.vendorProfile.stepCompleted.step1 = true;

            user.vendorProfile.onboardingStep = user.vendorProfile.onboardingStep || {};
            user.vendorProfile.onboardingStep.step1Id = step1._id;

            // B. Sync Contact Info (Master Sync)
            // "if i update mobile number are email that need to update in all shared db"
            if (mobileNumber) user.mobile = mobileNumber;
            if (email) user.userProfile.email = email;
            if (firstName) user.userProfile.firstname = firstName;
            if (lastName) user.userProfile.lastname = lastName;

            // C. Sync Business Address
            // "if add bussines address that need to add in profiel collection also"
            user.userProfile.addresses = user.userProfile.addresses || [];

            // Remove existing Business address if any
            user.userProfile.addresses = user.userProfile.addresses.filter(a => a.label !== 'Business');

            // Add new Business Address
            user.userProfile.addresses.push({
                label: 'Business',
                addressLine: businessAddress,
                city: city,
                state: state,
                zipCode: zipcode,
                latitude: latitude,
                longitude: longitude,
                isDefault: true // Vendor default
            });

            // When Step 1 is created, the user account is upgraded to a vendor account
            user.isVendorCreated = true;
            user.activeRole = 'VENDOR';

            await user.save();
        }

        res.status(201).json({ success: true, message: MESSAGES.SUCCESS.ACCOUNT_CREATED, data: step1 });
    } catch (error) {
        console.error('Create Step 1 Error:', error);
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

// Update Step 1
exports.updateStep1 = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        const userId = req.user._id;

        // Uniqueness Check for Update
        if (updateData.email || updateData.mobileNumber) {
            const existingVendor = await VendorStep1.findOne({
                $or: [
                    { email: updateData.email },
                    { mobileNumber: updateData.mobileNumber }
                ],
                _id: { $ne: id } // Exclude self
            });
            if (existingVendor) {
                return res.status(400).json({ success: false, message: 'Vendor with this email or mobile already exists.' });
            }
        }

        const step1 = await VendorStep1.findByIdAndUpdate(id, updateData, {
            new: true,
            runValidators: true
        });

        if (!step1) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        // Sync to Usersdetail
        const Usersdetail = require('../../models/users.model');
        const user = await Usersdetail.findById(userId);

        if (user) {
            // Update Contact Info if present in updateData
            if (updateData.mobileNumber) user.mobile = updateData.mobileNumber;
            if (updateData.email) user.userProfile.email = updateData.email;
            if (updateData.firstName) user.userProfile.firstname = updateData.firstName;
            if (updateData.lastName) user.userProfile.lastname = updateData.lastName;

            // Update Business Address if present
            // We reconstruct the address object from the updated step1 doc to be safe
            if (updateData.businessAddress || updateData.city || updateData.state || updateData.zipcode || updateData.latitude || updateData.longitude) {
                user.userProfile.addresses = user.userProfile.addresses || [];
                user.userProfile.addresses = user.userProfile.addresses.filter(a => a.label !== 'Business');
                user.userProfile.addresses.push({
                    label: 'Business',
                    addressLine: step1.businessAddress,
                    city: step1.city,
                    state: step1.state,
                    zipCode: step1.zipcode,
                    latitude: step1.latitude,
                    longitude: step1.longitude,
                    isDefault: true
                });
            }

            // Ensure flags are true and account is converted to Vendor
            user.vendorProfile.stepCompleted = user.vendorProfile.stepCompleted || {};
            user.vendorProfile.stepCompleted.step1 = true;
            user.isVendorCreated = true;
            user.activeRole = 'VENDOR';

            await user.save();
        }

        res.status(200).json({ success: true, data: step1 });
    } catch (error) {
        console.error('Update Step 1 Error:', error);
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

// Update Step 1 (Token Based)
exports.updateMyStep1 = async (req, res) => {
    try {
        const updateData = req.body;
        const userId = req.user._id;

        let step1 = await VendorStep1.findOne({ userId });
        if (!step1) {
            return res.status(404).json({ success: false, message: 'Step 1 not found. Please create it first.' });
        }

        // Uniqueness Check for Update
        if (updateData.email || updateData.mobileNumber) {
            const existingVendor = await VendorStep1.findOne({
                $or: [
                    { email: updateData.email },
                    { mobileNumber: updateData.mobileNumber }
                ],
                _id: { $ne: step1._id }
            });
            if (existingVendor) {
                return res.status(400).json({ success: false, message: 'Vendor with this email or mobile already exists.' });
            }
        }

        // Apply Updates
        Object.assign(step1, updateData);
        await step1.save();

        // Sync to Usersdetail
        const Usersdetail = require('../../models/users.model');
        const user = await Usersdetail.findById(userId);

        if (user) {
            if (updateData.mobileNumber) user.mobile = updateData.mobileNumber;
            if (updateData.email) user.userProfile.email = updateData.email;
            if (updateData.firstName) user.userProfile.firstname = updateData.firstName;
            if (updateData.lastName) user.userProfile.lastname = updateData.lastName;

            if (updateData.businessAddress || updateData.city || updateData.state || updateData.zipcode || updateData.latitude || updateData.longitude) {
                user.userProfile.addresses = user.userProfile.addresses || [];
                user.userProfile.addresses = user.userProfile.addresses.filter(a => a.label !== 'Business');
                user.userProfile.addresses.push({
                    label: 'Business',
                    addressLine: step1.businessAddress,
                    city: step1.city,
                    state: step1.state,
                    zipCode: step1.zipcode,
                    latitude: step1.latitude,
                    longitude: step1.longitude,
                    isDefault: true
                });
            }
            user.vendorProfile.stepCompleted.step1 = true;
            user.isVendorCreated = true;
            user.activeRole = 'VENDOR';
            await user.save();
        }

        res.status(200).json({ success: true, data: step1 });
    } catch (error) {
        console.error('Update My Step 1 Error:', error);
        res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT, error: error.message });
    }
};

// Get Step 1 (By ID)
exports.getStep1 = async (req, res) => {
    try {
        const { id } = req.params;
        const step1 = await VendorStep1.findById(id);

        if (!step1) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step1 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

// Get Step 1 (By User Token)
exports.getMyStep1 = async (req, res) => {
    try {
        const userId = req.user._id;
        const step1 = await VendorStep1.findOne({ userId });

        if (!step1) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, data: step1 });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

// Delete Step 1
exports.deleteStep1 = async (req, res) => {
    try {
        const { id } = req.params;
        const step1 = await VendorStep1.findByIdAndDelete(id);

        if (!step1) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.NOT_FOUND });
        }

        res.status(200).json({ success: true, message: 'Step 1 deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};
