const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
    menuItemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MenuItem',
        required: true
    },
    dailyMenuId: { type: String },
    menuName: { type: String, required: true },
    coverPicture: { type: String },
    qty: { type: Number, required: true, min: 1 },
    basePrice: { type: Number, required: true },
    dealPrice: { type: Number },
    splIns: { type: String },
    Addons: [{
        name: { type: String, required: true },
        price: { type: Number, required: true }
    }]
});

const cartSchema = new mongoose.Schema({
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
    specialInstructions: { type: String },
    items: [cartItemSchema],

    // ── Payment ──────────────────────────────────────────────
    payment: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending'
    },
    payment_id: {
        type: String,   // store gateway transaction / order ID
        default: null
    }
}, {
    timestamps: { createdAt: 'createdDate', updatedAt: 'modifiedDate' }
});

// Indexes for fast lookups
cartSchema.index({ customerId: 1 });
cartSchema.index({ customerId: 1, vendorId: 1 });

module.exports = mongoose.model('Cart', cartSchema);