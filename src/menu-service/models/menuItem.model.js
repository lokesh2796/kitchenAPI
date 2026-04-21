const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AddOnSchema = new Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    label: { type: String }, // e.g., "addon1"
    _id: { type: mongoose.Schema.Types.ObjectId, auto: true }
});

const MenuItemSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'Users', required: true }, // Reference to the Vendor
    menuName: { type: String, required: true },
    cuisine: { type: String }, // e.g., Indian, European, Arabian
    category: { type: String }, // e.g., Main Course, Desserts
    menuItemType: [{ type: String }], // e.g., [healthy, burger, veg]
    coverPicture: { type: String }, // URL
    otherPictures: [{ type: String }], // URLs
    basePrice: { type: Number, required: true }, // Using Number for calculations
    ingredients: [{ type: String }],
    aboutItem: [{ type: String }], // Description points
    addOnsAvail: { type: Boolean, default: false },
    addOns: [AddOnSchema],
    maxAddonsAllowed: { type: Number, default: 0 }
}, {
    timestamps: true // Creates createdDate (createdAt) and modifiedDate (updatedAt)
});

// Indexes for fast lookups
MenuItemSchema.index({ userId: 1 });
MenuItemSchema.index({ userId: 1, cuisine: 1 });
MenuItemSchema.index({ category: 1 });

module.exports = mongoose.model('MenuItem', MenuItemSchema);
