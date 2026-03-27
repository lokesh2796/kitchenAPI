const mongoose = require('mongoose');

const userProfileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Users',
        required: true,
        unique: true
    },
    // User Specific Data
    location: [{
        lat: Number,
        long: Number,
        address: String
    }],
    deliveryAddress: [{
        address1: String,
        address2: String,
        city: String,
        state: String,
        zip: String,
        phone: String,
        lat: Number,
        long: Number,
        label: { type: String, default: 'Home' },
        isDefault: { type: Boolean, default: false }
    }],
    userPayment: [{
        methodType: {
            type: String,
            enum: ['CARD', 'UPI', 'BANK', 'WALLET'],
            required: true
        },
        provider: String, // Visa, Mastercard, RuPay, Bank Name, etc.
        accountName: String, // Cardholder name, Account holder name, UPI name
        accountNumber: String, // Card number, UPI ID, Account number
        expiryDate: String, // For cards (MM/YY format)
        isDefault: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now }
    }],

    // Vendor Specific Data
    businessName: { type: String },

    // Step 1: Vendor Location
    vendorLocation: {
        lat: Number,
        long: Number,
        address1: String,
        address2: String,
        city: String,
        state: String,
        zip: String
    },

    // Step 2: Vendor Payment
    vendorPayment: {
        fullName: String,
        paypalId: String
    },

    // Step 3: Cancellation Policies
    todayCancelPolicy: {
        freeCancellation: { type: Boolean, default: false },
        freeCancellationTime: String,
        paidCancellation: { type: Boolean, default: false },
        paidCancelTime: String,
        paidCancelPenalty: Number // Int20
    },
    preOrderCancelPolicy: {
        freeCancellation: { type: Boolean, default: false },
        freeCancellationTime: String,
        paidCancellation: { type: Boolean, default: false },
        paidCancelTime: String,
        paidCancelPenalty: Number
    },

    // Step 4: Delivery Policy
    deliveryPolicy: {
        delivery: { type: Boolean, default: false },
        deliveryMinAmt: Number, // Int150
        deliveryCharge: Number, // Int15
        deliveryDistance: Number // Int5
    },

    // Step 5 & 6: Acknowledgements & Terms
    vendorAck: {
        payment: { type: Boolean, default: false },
        cancellation: { type: Boolean, default: false },
        delivery: { type: Boolean, default: false },
        refund: { type: Boolean, default: false },
        terms: { type: Boolean, default: false }
    },

    // Vendor Status
    vendorStatus: {
        type: String,
        enum: ['Active', 'Inactive'],
        default: 'Inactive'
    },
    vendorCloseDate: {
        type: Date
    }

}, {
    timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' }
});

module.exports = mongoose.model('UserProfile', userProfileSchema);
