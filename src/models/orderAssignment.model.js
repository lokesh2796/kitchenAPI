const mongoose = require('mongoose');

/**
 * Tracks every vendor assignment attempt for an order.
 * One document per order; attempts[] grows with each retry.
 */
const attemptSchema = new mongoose.Schema({
    vendorId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Users', required: true },
    vendorName:   { type: String },
    assignedAt:   { type: Date, default: Date.now },
    timeoutAt:    { type: Date, required: true },   // when the acceptance window expires
    respondedAt:  { type: Date },
    response:     { type: String, enum: ['ACCEPTED', 'REJECTED', 'TIMEOUT', null], default: null },
    rejectReason: { type: String },
    bullJobId:    { type: String },                 // BullJS job ID — used to cancel on accept/reject
    distanceKm:   { type: Number },                 // distance from vendor to delivery address
}, { _id: true });

const orderAssignmentSchema = new mongoose.Schema({
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        unique: true,
        index: true,
    },

    orderCategory: {
        type: String,
        enum: ['today', 'tomorrow', 'preorder'],
        required: true,
    },

    // Current active vendor
    currentVendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' },

    // Full attempt history
    attempts: [attemptSchema],

    // Derived from attempts.length — quick check without counting array
    retryCount: { type: Number, default: 0 },

    // Max retries before auto-cancel (configured per category)
    maxRetries: { type: Number, default: 3 },

    // Cuisine + category of the original order — used to find matching vendors
    cuisines:    [String],
    categories:  [String],

    // Delivery location — used to sort candidates by proximity
    deliveryLat:  { type: Number },
    deliveryLng:  { type: Number },

    // Originating vendorId (the vendor the user originally picked)
    originalVendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' },

    finalStatus: {
        type: String,
        enum: ['PENDING', 'ACCEPTED', 'EXHAUSTED'],
        default: 'PENDING',
    },

    // When finalStatus becomes EXHAUSTED → refund triggered
    refundTriggeredAt: { type: Date },

}, { timestamps: true });

orderAssignmentSchema.index({ currentVendorId: 1 });
orderAssignmentSchema.index({ finalStatus: 1 });

module.exports = mongoose.model('OrderAssignment', orderAssignmentSchema);
