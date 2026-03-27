const mongoose = require('mongoose');

const vendorStep5Schema = new mongoose.Schema(
    {
        agreedToTerms: {
            type: Boolean,
            required: true,
            default: false
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: false
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('VendorStep5', vendorStep5Schema);
