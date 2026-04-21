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
    // Charge breakdown — kept granular so historical orders can be re-displayed
    // exactly as the user saw them at checkout. `subtotal` is items minus
    // discount; `totalAmount` is the grand total including all charges.
    itemTotal: { type: Number, default: 0 },     // sum of basePrice × qty (+ addons), BEFORE discount
    discount: { type: Number, default: 0 },
    subtotal: { type: Number, required: true },  // itemTotal − discount
    deliveryCharge: { type: Number, default: 0 },
    platformCharge: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true }, // grand total = subtotal + delivery + platform + tax
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

    // ── Dispute Fields ──────────────────────────────────────
    dispute: {
        reason: { type: String, enum: ['wrong_item', 'incorrect_order', 'other', null], default: null },
        description: { type: String, maxlength: 500 },
        raisedAt: { type: Date },
        raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' },
        agreedToPolicy: { type: Boolean, default: false }
    },
    disputeMessages: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' },
        role: { type: String, enum: ['user', 'vendor', 'admin'] },
        message: { type: String, maxlength: 500 },
        createdAt: { type: Date, default: Date.now }
    }],
    disputeRefund: {
        offeredAmount: { type: Number },
        offeredAt: { type: Date },
        status: { type: String, enum: ['pending', 'accepted', 'rejected', null], default: null },
        respondedAt: { type: Date },
        escalatedToAdmin: { type: Boolean, default: false }
    },
    disputeResolvedAt: { type: Date },
    disputeResolutionNote: { type: String },

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

// Indexes for fast lookups and sorting
orderSchema.index({ userId: 1, createdDate: -1 });
orderSchema.index({ vendorId: 1, createdDate: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ orderId: 1 }, { unique: true });
orderSchema.index({ vendorId: 1, status: 1 });
orderSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Order', orderSchema);
