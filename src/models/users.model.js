const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        trim: true,
        default: ''
    },
    lastName: {
        type: String,
        trim: true,
        default: ''
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        select: false // Hide by default
    },
    countryCode: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true,
        unique: true
    },
    isVendor: {
        type: Boolean,
        default: false
    },
    loginType: {
        type: String,
        enum: ['su', 'gu', 'fu', 'au'], // Signup, Google, Facebook, Apple
        default: 'su'
    },
    userData: {
        type: Object, // Stores 3rd party info like tokens/metadata
        default: {}
    },
    activeRole: {
        type: String, // 'USER' or 'VENDOR'
        default: 'USER'
    },
    // OTP Management
    otp: {
        type: String
    },
    otpSent: {
        type: Date
    },
    otpAttempts: {
        type: Number,
        default: 0
    },
    otpFirstSent: {
        type: Date
    },
    // Account Status
    status: {
        type: String,
        enum: ['a', 'i', 'p', 'd'], // Active, Inactive, Pending, Deleted
        default: 'p'
    },
    lastSignedIn: {
        type: Date
    }
}, {
    timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' }
});

module.exports = mongoose.model('Users', userSchema);
