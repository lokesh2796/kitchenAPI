const jwt = require('jsonwebtoken');
const Users = require('../../models/users.model');
const UserProfile = require('../../models/userProfile.model');
const { sendEmail, sendSmsNotification } = require('../../utils/notification.service');
const { encrypt } = require('../../utils/encryption');
const MESSAGES = require('../../constants/messages');
const { computeStepCompletion } = require('../../utils/vendor-steps');

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

        // ALL signups create a regular buyer in the pending-OTP state. The
        // `userType: VENDOR` request is treated as a *routing hint* — the
        // frontend reads it back from the OTP response to decide whether to
        // drop the new user into /mainstep right after verification. The
        // actual vendor promotion (isVendor=true, activeRole='VENDOR')
        // happens only when /vendor/step1 is saved. This way, a user who
        // signs up "as a vendor" but skips step 1 still has a perfectly
        // valid buyer account they can sign back into.
        const requestedRole = (req.body.userType || 'user').toUpperCase();
        const wantsVendor = requestedRole === 'VENDOR';

        if (!user) {
            // Create new User Identity — always as a buyer.
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
                status: 'p',          // Pending OTP verification (set to 'a' in verifyOtp)
                isVendor: false,
                activeRole: 'USER'
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
            // Update existing pending user — never re-stamp them as a vendor
            // here. Vendor promotion is exclusively done by /vendor/step1.
            user.firstName = finalFirstname;
            user.lastName = finalLastname;
            user.password = encrypt(password);
            user.otp = otpCode;
            user.otpSent = otpDate;
            user.otpAttempts += 1;
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

            // Anyone who is a vendor should land back in the vendor view on
            // every fresh login, even if they were last viewing as USER. This
            // matters because:
            //   1) socket auto-join uses the JWT role to enter vendor-${id}
            //   2) the mobile alert handler keys off `activerole === 'vendor'`
            //   3) the orders page picks vendor vs user endpoint by activeRole
            // If a vendor wants to see the buyer view they can still flip via
            // /users/switch-role from inside the app.
            if (user.isVendor) {
                user.activeRole = 'VENDOR';
            }

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

                const { steps, allCompleted: allStepsCompleted } = computeStepCompletion(userProfile);
                responseData.vendorProfile.stepCompleted = steps;
                responseData.stepCompleted = steps;
                responseData.allStepsCompleted = allStepsCompleted;
                responseData.kitchenOpen = userProfile.kitchenOpen || false;
                responseData.kitchenStatus = !allStepsCompleted ? 'PENDING' : (userProfile.kitchenOpen ? 'OPEN' : 'CLOSED');
                responseData.isLive = allStepsCompleted && userProfile.kitchenOpen;
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
        user.otp = undefined; // Clear OTP

        // Activate the account on first OTP verification. Previously this
        // line was commented out and `status` only got flipped to 'a' inside
        // updateStep1, which meant a user who signed up as a vendor and
        // skipped step 1 was permanently locked out (login.controller checks
        // status === 'a' before issuing a token).
        if (wasPending) {
            user.status = 'a';
        }

        // Vendor promotion is exclusively the job of /vendor/step1. Even
        // when the signup payload requested userType:VENDOR, we never set
        // isVendor here — the user becomes a regular buyer until they
        // actually save step 1. The original `userType` request is echoed
        // back in the response below as a routing hint so the frontend can
        // optionally drop them straight into /mainstep.
        const requestedRole = (req.body.userType || '').toUpperCase();
        const wantsVendor = requestedRole === 'VENDOR';

        if (!wasPending && user.isVendor) {
            // Returning vendor — always restore the vendor view on re-login
            // (mirrors the email/password login flow). They can still flip
            // back to USER from inside the app via /users/switch-role.
            user.activeRole = 'VENDOR';
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
            responseData.vendorProfile = userProfile.toObject();

            const { steps, allCompleted: allStepsCompleted } = computeStepCompletion(userProfile);
            responseData.vendorProfile.stepCompleted = steps;
            responseData.stepCompleted = steps;
            responseData.allStepsCompleted = allStepsCompleted;
            responseData.kitchenOpen = userProfile.kitchenOpen || false;
            responseData.kitchenStatus = !allStepsCompleted ? 'PENDING' : (userProfile.kitchenOpen ? 'OPEN' : 'CLOSED');
            responseData.isLive = allStepsCompleted && userProfile.kitchenOpen;
        }

        responseData.needsOnboarding = user.isVendor && (!userProfile || !userProfile.businessName);
        // Routing hint for the frontend: if this OTP verify is the tail end
        // of a `userType: VENDOR` signup AND the user isn't yet a vendor,
        // the signin / OTP screen should drop them into /mainstep so they
        // can complete step 1. If they back out of step 1 they remain a
        // perfectly valid buyer (status='a', isVendor=false) who can sign
        // back in normally.
        responseData.wantsVendor = wantsVendor && !user.isVendor;

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

        // Self-heal ONLY when activeRole is missing entirely (legacy data).
        // Do NOT override an explicit USER selection — within the same
        // session, users who switched to USER mode must stay in USER mode.
        // The fresh-login endpoints (login + verifyOtp) are responsible for
        // resetting vendors back to VENDOR view at re-login time.
        if (user.isVendor && !user.activeRole) {
            user.activeRole = 'VENDOR';
            await user.save();
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
            responseData.vendorProfile = userProfile.toObject();

            const { steps, allCompleted: allStepsCompleted } = computeStepCompletion(userProfile);
            responseData.vendorProfile.stepCompleted = steps;
            responseData.stepCompleted = steps;
            responseData.allStepsCompleted = allStepsCompleted;
            responseData.kitchenOpen = userProfile.kitchenOpen || false;
            responseData.kitchenStatus = !allStepsCompleted ? 'PENDING' : (userProfile.kitchenOpen ? 'OPEN' : 'CLOSED');
            responseData.isLive = allStepsCompleted && userProfile.kitchenOpen;
            responseData.vendorDataCompleted = allStepsCompleted;
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

const PROVIDER_LOGIN_TYPE = { google: 'gu', facebook: 'fu', apple: 'au' };

exports.socialLogin = async (req, res) => {
    try {
        const { provider, idToken, email, name } = req.body;

        if (!provider || !idToken || !email) {
            return res.status(400).json({ success: false, message: 'provider, idToken, and email are required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        let user = await Users.findOne({ email: normalizedEmail });

        if (!user) {
            const nameParts = (name || '').split(' ');
            user = await Users.create({
                email: normalizedEmail,
                firstName: nameParts[0] || '',
                lastName: nameParts.slice(1).join(' ') || '',
                phone: `SOCIAL_${provider.toUpperCase()}_${Date.now()}`,
                countryCode: 'SOCIAL',
                status: 'a',
                activeRole: 'USER',
                loginType: PROVIDER_LOGIN_TYPE[provider] || 'su',
                userData: { provider },
            });
        } else if (user.status !== 'a') {
            user.status = 'a';
        }

        user.lastSignedIn = new Date();
        await user.save();

        const token = generateToken(user);
        return res.json({ success: true, token, message: 'Social login successful' });
    } catch (error) {
        console.error('[socialLogin]', error);
        res.status(500).json({ success: false, message: MESSAGES.ERROR.INTERNAL_SERVER_ERROR, error: error.message });
    }
};
