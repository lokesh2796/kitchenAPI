const mongoose = require('mongoose');

const statusLookupSchema = new mongoose.Schema({
    name: { type: String, required: true },
    value: { type: String, required: true },
    delete: { type: Number, default: 0 }
}, {
    timestamps: true
});

module.exports = mongoose.model('StatusLookup', statusLookupSchema);
