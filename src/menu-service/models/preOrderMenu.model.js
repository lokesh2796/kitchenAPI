const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PreOrderMenuSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'Users', required: true },
    menuItemId: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    menuName: { type: String },
    maxQty: { type: Number, required: true },
    soldQty: { type: Number, default: 0 }, // Standardized to Number to match TodayMenu and prevent CastErrors
    balanceQty: { type: Number, default: 0 }, // Maybe concept is per-day balance? Schema shows generic number.
    availFrom: { type: String },
    availTo: { type: String },
    advanceNotice: { type: String }, // e.g., "24 hours"
    basePrice: { type: Number, required: true },
    dealPrice: { type: Number },
    isHidden: { type: Boolean, default: false },
}, {
    timestamps: true
});

// Indexes for fast lookups
PreOrderMenuSchema.index({ userId: 1 });
PreOrderMenuSchema.index({ menuItemId: 1 });

module.exports = mongoose.model('PreOrderMenu', PreOrderMenuSchema);
