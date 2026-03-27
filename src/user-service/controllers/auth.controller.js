const jwt = require('jsonwebtoken');
const Users = require('../../models/users.model');
const UserProfile = require('../../models/userProfile.model');
const { sendEmail, sendSmsNotification } = require('../../utils/notification.service');
const { encrypt } = require('../../utils/encryption');
const MESSAGES = require('../../constants/messages');

// Generate random 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const generateToken = (user) => {
    return jwt.sign(
        { id: user._id, role: user.activeRole },
        process.env.JWT_SECRET || 'default_jwt_secret_key_change_me',
        { expiresIn: '30d' }
    );
};

/**
 * Initiate Registration (Step 1)
 * Creates Unverified User or Updates existing Unverified User.
 * Sends OTP via Email and SMS.
 */
exports.initiateRegistration = async (req, res) => {
    try {
        const { mobile, email, password, countryCode, firstName, lastName, firstname, lastname, address, latitude, longitude } = req.body;

        const finalFirstname = firstName || firstname;
        const finalLastname = lastName || lastname;

        if (!mobile || !email || !password || !countryCode) {
            return res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT });
        }

        // Check if user already exists in Users collection
        let user = await Users.findOne({
            $or: [{ phone: mobile }, { email: email }]
        });

        if (user && user.status === 'a') { // Active user
            return res.status(400).json({ success: false, message: MESSAGES.ERROR.USER_ALREADY_EXISTS });
        }

        const otpCode = generateOTP();
        const otpDate = new Date();

        const requestedRole = (req.body.userType || 'user').toUpperCase();
        const isVendor = requestedRole === 'VENDOR';

        if (!user) {
            // Create new User Identity
            user = new Users({
                firstName: finalFirstname,
                lastName: finalLastname,
                email,
                password: encrypt(password), // Legacy encryption utility
                phone: mobile,
                countryCode,
                otp: otpCode,
                otpSent: otpDate,
                otpFirstSent: otpDate,
                otpAttempts: 1,
                status: isVendor ? 'p' : 'a', // Pending verification
                isVendor: isVendor,
                activeRole: isVendor ? 'VENDOR' : 'USER'
            });
            await user.save();

            // Create Linked User Profile
            const userProfile = new UserProfile({
                userId: user._id,
                deliveryAddress: address ? [{
                    address1: address,
                    label: 'Home',
                    isDefault: true
                }] : []
            });
            if (address && latitude && longitude) {
                userProfile.location = [{ lat: latitude, long: longitude, address: address }];
            }
            await userProfile.save();

        } else {
            // Update existing pending user
            user.firstName = finalFirstname;
            user.lastName = finalLastname;
            user.password = encrypt(password);
            user.otp = otpCode;
            user.otpSent = otpDate;
            user.otpAttempts += 1;
            user.isVendor = isVendor || user.isVendor;
            user.activeRole = isVendor ? 'VENDOR' : user.activeRole;
            await user.save();

            // Ensure profile exists (idempotency)
            let userProfile = await UserProfile.findOne({ userId: user._id });
            if (!userProfile) {
                userProfile = new UserProfile({ userId: user._id });
                await userProfile.save();
            }
        }

        // Send Notification
        const templateData = { otp: otpCode, firstname: user.firstName };
        Promise.all([
            sendEmail(user.email, 'OTP_EMAIL', templateData),
            sendSmsNotification(mobile, 'OTP_SMS', templateData)
        ]).catch(err => console.error('Notification Error:', err.message));

        res.status(200).json({ success: true, message: MESSAGES.SUCCESS.REGISTRATION_INITIATED, devOtp: otpCode, mobile: mobile, countryCode: countryCode });

    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Unified Login
 * - If mobile provided: Send OTP
 * - If email + password provided: Validate and return Token
 */
exports.login = async (req, res) => {
    try {
        const { mobile, email, password, deviceType, ip } = req.body;

        // Flow 1: Email + Password Login
        if (email && password) {
            const user = await Users.findOne({ email: email }).select('+password');

            if (!user) {
                return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
            }

            // Verify Password
            // Note: New Users model stores encrypted string directly.
            const decryptedPassword = require('../../utils/encryption').decrypt(user.password);
            if (decryptedPassword !== password) {
                return res.status(401).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT });
            }

            if (user.status !== 'a') {
                return res.status(403).json({ success: false, message: 'Account not active/verified.' });
            }

            // NOTE: Do NOT auto-switch role based on x-role header during login.
            // Role switching should only happen via the explicit /users/switch-role endpoint.

            // Update Login Stats
            user.lastSignedIn = new Date();
            await user.save();

            const token = generateToken(user);
            const userProfile = await UserProfile.findOne({ userId: user._id });

            const responseData = {
                mobile: user.phone, // 'phone' in new schema
                email: user.email,
                role: user.activeRole || 'USER',
                activeRole: user.activeRole || 'USER',
                isVerified: true,
                userType: user.activeRole || 'USER',
                addresses: userProfile ? userProfile.deliveryAddress : [],
                isVendorCreated: user.isVendor
            };

            if (user.isVendor && userProfile) {
                responseData.vendorProfile = userProfile.toObject();

                const ack = userProfile.vendorAck || {};
                responseData.vendorProfile.stepCompleted = {
                    step1: !!userProfile.businessName,
                    step2: !!ack.payment,
                    step3: !!ack.cancellation,
                    step4: !!ack.delivery,
                    step5: !!ack.refund,
                    step6: !!ack.terms
                };

                responseData.kitchenStatus = userProfile.vendorStatus === 'Active' ? 'OPEN' : 'OFFLINE';
                responseData.isLive = userProfile.vendorStatus === 'Active';
            }

            responseData.needsOnboarding = user.isVendor && (!userProfile || !userProfile.businessName);

            return res.status(200).json({
                success: true,
                message: MESSAGES.SUCCESS.LOGIN_SUCCESS,
                token,
                loginType: 'PASSWORD',
                data: responseData
            });
        }

        // Flow 2: Mobile OTP Login
        if (mobile) {
            const user = await Users.findOne({ phone: mobile });
            if (!user) {
                return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
            }

            if (user.status !== 'a' && user.status !== 'p') {
                return res.status(403).json({ success: false, message: 'Account suspended or inactive.' });
            }

            const otpCode = generateOTP();
            const otpDate = new Date();

            user.otp = otpCode;
            user.otpSent = otpDate;
            await user.save();

            const templateData = { otp: otpCode, firstname: user.firstName };
            Promise.all([
                sendEmail(user.email, 'OTP_EMAIL', templateData),
                sendSmsNotification(mobile, 'OTP_SMS', templateData)
            ]).catch(err => console.error('Notification Error:', err.message));

            return res.status(200).json({
                success: true,
                message: MESSAGES.SUCCESS.OTP_SENT,
                devOtp: otpCode,
                loginType: 'OTP',
            });
        }

        return res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT });

    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Resend OTP
 * - Find user by mobile
 * - Generate and send new OTP
 */
exports.resendOtp = async (req, res) => {
    try {
        const { mobile } = req.body;

        if (!mobile) {
            return res.status(400).json({ success: false, message: MESSAGES.ERROR.MOBILE_REQUIRED });
        }

        const user = await Users.findOne({ phone: mobile });

        if (!user) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        const otpCode = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        user.otp = { code: otpCode, expiresAt };
        await user.save();

        const templateData = { otp: otpCode, firstname: user.userProfile.firstname || 'User' };

        // Send OTP via Email and SMS
        Promise.all([
            sendEmail(user.userProfile.email, 'OTP_EMAIL', templateData),
            sendSmsNotification(mobile, 'OTP_SMS', templateData)
        ]).catch(err => console.error('Notification Error:', err.message));

        res.status(200).json({
            success: true,
            message: MESSAGES.SUCCESS.OTP_SENT,
            devOtp: otpCode,
            mobile: mobile,
            countryCode: user.countryCode
        });
    } catch (error) {
        console.error('Resend OTP Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const { mobile, otp, deviceType, ip } = req.body;

        if (!mobile || !otp) {
            return res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_INPUT });
        }

        const user = await Users.findOne({ phone: mobile });

        if (!user) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        // OTP Check
        if (user.otp !== otp) {
            return res.status(400).json({ success: false, message: MESSAGES.ERROR.INVALID_OTP });
        }

        // Expiry Check (10 mins)
        const expiryTime = new Date(new Date(user.otpSent).getTime() + 10 * 60 * 1000);
        if (new Date() > expiryTime) {
            return res.status(400).json({ success: false, message: MESSAGES.ERROR.OTP_EXPIRED });
        }

        const wasPending = user.status === 'p';
        // user.status = 'a'; // REMOVED: User remains pending until Step 1
        user.otp = undefined; // Clear OTP

        // Only set vendor role during INITIAL registration (pending users signing up as vendor).
        // For returning users who log in via OTP, do NOT change their activeRole.
        if (wasPending) {
            const requestedRole = (req.body.userType || 'USER').toUpperCase();
            if (requestedRole === 'VENDOR') {
                user.isVendor = true;
                user.activeRole = 'VENDOR';
            } else {
                user.activeRole = 'USER';
            }
        }

        await user.save();
        const token = generateToken(user);
        if (!user.isVendor) {
            // Send Welcome Email
            const emailSlug = user.isVendor ? 'PARTNER_SIGNUP_CREATED' : 'ACCOUNT_CREATED';
            const templateData = { firstname: user.firstName || 'User' };
            sendEmail(user.email, emailSlug, templateData).catch(err => console.error('Welcome Email Error:', err));
        }

        // Fetch Profile Data
        const userProfile = await UserProfile.findOne({ userId: user._id });

        const responseData = {
            mobile: user.phone,
            email: user.email,
            role: user.activeRole || 'USER',
            activeRole: user.activeRole || 'USER',
            isVerified: true, // Use boolean for frontend compatibility
            userType: user.activeRole || 'USER',
            // Profile Data
            addresses: userProfile && userProfile.deliveryAddress ? userProfile.deliveryAddress : [],
            isVendorCreated: user.isVendor,
            // Vendor Specifics
            vendorDataCompleted: false // To be calculated based on Profile completeness
        };

        if (user.isVendor && userProfile) {
            // Calculate Vendor Completeness
            const ack = userProfile.vendorAck || {};
            responseData.vendorProfile = userProfile.toObject();
            responseData.vendorProfile.stepCompleted = {
                step1: !!userProfile.businessName,
                step2: !!ack.payment,
                step3: !!ack.cancellation,
                step4: !!ack.delivery,
                step5: !!ack.refund,
                step6: !!ack.terms
            };

            responseData.kitchenStatus = userProfile.vendorStatus === 'Active' ? 'OPEN' : 'OFFLINE';
            responseData.isLive = userProfile.vendorStatus === 'Active';
        }

        responseData.needsOnboarding = user.isVendor && (!userProfile || !userProfile.businessName);

        res.status(200).json({
            success: true,
            message: wasPending ? MESSAGES.SUCCESS.ACCOUNT_CREATED : MESSAGES.SUCCESS.LOGIN_SUCCESS,
            token,
            data: responseData
        });

    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};

/**
 * Validate Token & Get Profile
 * Headers: Authorization: Bearer <token>
 */
exports.validateToken = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, message: MESSAGES.ERROR.UNAUTHORIZED });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_jwt_secret_key_change_me');
        const user = await Users.findById(decoded.id);

        if (!user) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        const userProfile = await UserProfile.findOne({ userId: user._id });

        const responseData = {
            mobile: user.phone,
            role: user.activeRole || 'USER',
            activeRole: user.activeRole || 'USER',
            isVerified: true,
            userType: user.activeRole || 'USER',
            addresses: userProfile ? userProfile.deliveryAddress : [],
            isVendorCreated: user.isVendor
        };

        if (user.isVendor && userProfile) {
            responseData.vendorProfile = userProfile.toObject(); // Convert to object to add properties

            const ack = userProfile.vendorAck || {};
            responseData.vendorProfile.stepCompleted = {
                step1: !!userProfile.businessName,
                step2: !!ack.payment,
                step3: !!ack.cancellation,
                step4: !!ack.delivery,
                step5: !!ack.refund,
                step6: !!ack.terms
            };

            responseData.kitchenStatus = userProfile.vendorStatus === 'Active' ? 'OPEN' : 'OFFLINE';
            responseData.isLive = userProfile.vendorStatus === 'Active';
            responseData.vendorDataCompleted = userProfile.vendorStatus === 'Active';
        }

        responseData.needsOnboarding = user.isVendor && (!userProfile || !userProfile.businessName);

        res.status(200).json({
            success: true,
            message: 'Token is valid',
            data: responseData
        });

    } catch (error) {
        console.error('Token Validation Error:', error);
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: MESSAGES.ERROR.UNAUTHORIZED });
        }
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};
