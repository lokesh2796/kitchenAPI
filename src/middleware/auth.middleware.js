const jwt = require('jsonwebtoken');
const MESSAGES = require('../constants/messages');
const Usersdetail = require('../models/users.model');

exports.verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: MESSAGES.ERROR.UNAUTHORIZED });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ success: false, message: MESSAGES.ERROR.UNAUTHORIZED });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_jwt_secret_key_change_me');

        // Check if user exists in DB
        const user = await Usersdetail.findById(decoded.id);
        if (!user) {
            return res.status(404).json({ success: false, message: MESSAGES.ERROR.USER_NOT_FOUND });
        }

        // NOTE: Do NOT auto-switch activeRole or isVendor here based on x-role header.
        // Role switching must only happen through the explicit /users/switch-role endpoint.
        // The middleware should be read-only — it authenticates and attaches the user, nothing more.

        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: MESSAGES.ERROR.UNAUTHORIZED });
    }
};

exports.isVendor = (req, res, next) => {
    // Check if user is actually a vendor (isVendor=true) AND active role is VENDOR
    // For Onboarding (Step 1), they might be isVendor=false/undefined?
    // Step 2230: verifyOtp sets isVendor=true IF header is VENDOR.
    // So usually isVendor is true for pending vendors.
    if (req.user && req.user.isVendor && req.user.activeRole === 'VENDOR') {
        next();
    } else {
        return res.status(403).json({ success: false, message: MESSAGES.ERROR.UNAUTHORIZED });
    }
};
