const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
    slug: {
        type: String,
        required: true,
        unique: true,
        uppercase: true
    },
    type: {
        type: String,
        enum: ['EMAIL', 'SMS'],
        required: true
    },
    subject: {
        type: String,
        default: ''
    },
    content: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Template', templateSchema);
