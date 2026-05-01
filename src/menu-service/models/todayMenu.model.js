const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TodayMenuSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'Users', required: true },
    menuItemId: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    menuName: { type: String }, // Snapshot of name for faster reads
    maxQty: { type: Number, required: true },
    soldQty: { type: Number, default: 0 },
    balanceQty: { type: Number, default: 0 },
    availFrom: { type: String }, // e.g., "10:00 AM"
    availTo: { type: String },   // e.g., "10:00 PM"
    menuDate: { type: Date, required: true }, // Only date, not time
    basePrice: { type: Number, required: true },
    dealPrice: { type: Number },
    isHidden: { type: Boolean, default: false },
}, {
    timestamps: true
});

// Indexes for fast lookups
TodayMenuSchema.index({ userId: 1, menuDate: 1 });
TodayMenuSchema.index({ menuItemId: 1 });
TodayMenuSchema.index({ menuDate: 1 });

module.exports = mongoose.model('TodayMenu', TodayMenuSchema);
