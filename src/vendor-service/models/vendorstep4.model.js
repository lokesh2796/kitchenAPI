const mongoose = require('mongoose');

const vendorStep4Schema = new mongoose.Schema(
    {
        deliveryAvailable: {
            type: String, // 'yes' or 'no'
            enum: ['yes', 'no'],
            required: true,
            default: 'yes'
        },
        minOrderAmount: {
            type: Number,
            required: function () {
                return this.deliveryAvailable === 'yes';
            },
            min: [0, 'Minimum order amount cannot be negative']
        },
        deliveryCharge: {
            type: Number,
            required: function () {
                return this.deliveryAvailable === 'yes';
            },
            min: [0, 'Delivery charge cannot be negative']
        },
        maxDistance: {
            type: String, // Storing ID or value as string based on frontend select
            required: function () {
                return this.deliveryAvailable === 'yes';
            }
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: false
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('VendorStep4', vendorStep4Schema);
