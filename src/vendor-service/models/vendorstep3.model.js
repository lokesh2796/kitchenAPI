const mongoose = require('mongoose');

const vendorStep3Schema = new mongoose.Schema(
    {
        offerFreeCancellation: {
            type: String,
            enum: ['yes', 'no'],
            required: true,
            default: 'yes'
        },
        freeCancellationDuration: {
            type: String,
            required: false // Optional if offerFreeCancellation is 'no'
        },
        offerPenaltyCancellation: {
            type: String,
            enum: ['yes', 'no'],
            required: true,
            default: 'yes'
        },
        penaltyTimeframe: {
            type: String,
            required: false // Optional
        },
        penaltyFee: {
            type: String,
            required: false // Optional
        },
        preOrderFreeCancellation: {
            type: String,
            enum: ['yes', 'no'],
            required: true,
            default: 'yes'
        },
        preOrderFreeDuration: {
            type: String,
            required: false // Optional
        },
        preOrderPenaltyCancellation: {
            type: String,
            enum: ['yes', 'no'],
            required: true,
            default: 'yes'
        },
        preOrderPenaltyDuration: {
            type: String,
            required: false // Optional
        },
        preOrderPenaltyFee: {
            type: String,
            required: false // Optional
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: false
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('VendorStep3', vendorStep3Schema);
