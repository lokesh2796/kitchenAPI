const mongoose = require('mongoose');

const vendorStep6Schema = new mongoose.Schema(
    {
        agreedToTerms: {
            type: Boolean,
            required: true,
            default: false
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: false // Can be linked later
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('VendorStep6', vendorStep6Schema);
