const mongoose = require('mongoose');

const statusLookupSchema = new mongoose.Schema({
    category: { type: String, index: true }, // e.g. 'order_status', 'payment_method', 'food_type'
    name: { type: String, required: true },
    value: { type: String, required: true },
    displayName: { type: String },
    sortOrder: { type: Number, default: 0 },
    delete: { type: Number, default: 0 }
}, {
    timestamps: true
});

module.exports = mongoose.model('StatusLookup', statusLookupSchema);
