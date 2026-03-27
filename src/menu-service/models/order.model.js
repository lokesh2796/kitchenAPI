const mongoose = require('mongoose');
const { getStatusValue, getStatusName } = require('../../utils/statusLookupCache');

const orderItemSchema = new mongoose.Schema({
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    dailyMenuId: { type: String },
    menuName: { type: String, required: true },
    coverPicture: { type: String },
    basePrice: { type: Number, required: true },
    dealPrice: { type: Number },
    qty: { type: Number, required: true, min: 1 },
    selectedAddons: [{
        name: String,
        price: Number
    }],
    itemTotal: { type: Number, required: true }
});

const orderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Users',
        required: true
    },
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Users',
        required: true
    },
    vendorName: { type: String },
    items: [orderItemSchema],
    subtotal: { type: Number, required: true },
    deliveryCharge: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    orderType: {
        type: String,
        enum: ['pickup', 'delivery'],
        default: 'pickup'
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
    vendorAddress: {
        address1: String,
        address2: String,
        city: String,
        state: String,
        zip: String,
        lat: Number,
        long: Number
    },
    paymentMethod: {
        type: String,
        enum: ['COD', 'CARD', 'UPI', 'WALLET'],
        default: 'COD'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded', 'refund_processed'],
        default: 'pending'
    },
    status: {
        type: String,
        default: 'placed',
        set: (val) => getStatusValue(val),
        get: (val) => getStatusName(val)
    },
    specialInstructions: { type: String },
    deliveryDate: { type: Date, required: true },
    preferredTime: { type: String },
    category: {
        type: String,
        enum: ['today', 'tomorrow', 'preorder'],
        required: true
    },
    estimatedPickupTime: { type: String },
    cancelledBy: {
        type: String,
        enum: ['user', 'vendor', null],
        default: null
    },
    cancelReason: { type: String, default: '' },
    refundAmount: { type: Number, default: 0 },
    refundPercentage: { type: Number, default: 0 },
    orderId: {
        type: String,
        unique: true,
        required: true
    },
    otp: {
        type: String,
        required: true
    }
}, {
    timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' },
    toJSON: { getters: true },
    toObject: { getters: true }
});

module.exports = mongoose.model('Order', orderSchema);
