const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
    menuItemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MenuItem',
        required: true
    },
    menuName: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    basePrice: { type: Number, required: true },
    dealPrice: { type: Number },
    splIns: { type: String },
    Addons: [{
        name: { type: String, required: true },
        price: { type: Number, required: true }
    }]
});

const orderSchema = new mongoose.Schema({
    orderId: {
        type: String,
        unique: true,
        required: true
    },
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Users',
        required: true
    },
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Users',
        required: true
    },
    deliveryDate: { type: Date, required: true },
    preferredTime: { type: String },
    items: [orderItemSchema],
    orderType: {
        type: String,
        required: true,
        enum: ['pickup', 'delivery']
    },
    deliveryMode: {
        type: String,
        required: true
    },
    vendorAddress: {
        address1: String,
        address2: String,
        city: String,
        state: String,
        zip: String,
        lat: Number,
        long: Number
    },
    deliveryAddress: {
        address1: String,
        address2: String,
        city: String,
        state: String,
        zip: String,
        phone: String,
        lat: Number,
        long: Number
    },
    deliveryPolicy: {
        deliveryMinAmt: Number,
        deliveryCharge: Number,
        deliveryDistance: Number
    },
    cancelPolicy: {
        freeCancellation: Boolean,
        freeCancellationTime: String,
        paidCancellation: Boolean,
        paidCancelTime: String,
        paidCancelPenalty: Number
    },
    orderTotal: { type: Number, required: true },
    vendorPayment: {
        paymentDate: Date,
        paymentAmt: Number,
        paymentStatus: {
            type: String,
            enum: ['pending', 'paid'],
            default: 'pending'
        },
        orderCompletedDate: Date,
        cancelAmt: Number,
        refundAmt: Number,
        siteAmt: Number
    },
    customerPayment: [{
        transId: String,
        status: String,
        amount: Number,
        createdDate: { type: Date, default: Date.now }
    }],
    orderStatus: {
        name: { type: String, required: true },
        customerDisplay: String,
        vendorDisplay: String,
        modifiedDate: { type: Date, default: Date.now }
    },
    otp: {
        type: String,
        required: true
    },
    statusHistory: [{
        name: String,
        timeStamp: { type: Date, default: Date.now },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' }
    }],
    orderMessage: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' },
        message: { type: String, maxlength: 250 },
        createdDate: { type: Date, default: Date.now }
    }],
    orderDispute: {
        refundAmt: Number,
        refundOfferStatus: { type: Number, enum: [-1, 0, 1], default: 0 },
        refundOfferedDate: Date,
        refundAcceptedDate: Date,
        refundType: String,
        refundPercent: Number
    },
    disputeMessage: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' },
        message: { type: String, maxlength: 250 },
        createdDate: { type: Date, default: Date.now }
    }]
}, {
    timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' }
});

// Indexes for fast lookups and sorting
orderSchema.index({ customerId: 1, createdDate: -1 });
orderSchema.index({ vendorId: 1, createdDate: -1 });
orderSchema.index({ orderId: 1 }, { unique: true });
orderSchema.index({ customerId: 1, 'orderStatus.name': 1 });
orderSchema.index({ vendorId: 1, 'orderStatus.name': 1 });

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);
