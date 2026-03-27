const mongoose = require('mongoose');

const vendorStep1Schema = new mongoose.Schema(
    {
        businessName: {
            type: String,
            required: true,
            trim: true
        },
        businessAddress: {
            type: String,
            required: true,
            trim: true
        },
        addressLine2: {
            type: String,
            trim: true,
            default: ''
        },
        city: {
            type: String,
            required: true,
            trim: true
        },
        state: {
            type: String,
            required: true,
            trim: true
        },
        zipcode: {
            type: String,
            required: true,
            trim: true,
            match: [/^[0-9]{5,6}$/, 'Please fill a valid zipcode']
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            match: [
                /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
                'Please fill a valid email address'
            ]
        },
        mobileNumber: {
            type: String,
            required: true,
            trim: true,
            match: [/^[0-9]{10}$/, 'Please fill a valid 10-digit mobile number']
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: false
        },
        latitude: { type: String },
        longitude: { type: String }
    },
    { timestamps: true }
);

module.exports = mongoose.model('VendorStep1', vendorStep1Schema);
