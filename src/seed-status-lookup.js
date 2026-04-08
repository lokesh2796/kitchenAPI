/**
 * Seed script — populates the StatusLookup table with all lookup values
 * used across the application. Run with:  node src/seed-status-lookup.js
 *
 * Behaviour:
 *  - Idempotent: uses upsert keyed on (category, value) so re-running is safe
 *  - Won't overwrite manually edited displayName/sortOrder unless you pass --force
 *  - Records are stored in the same shape as the existing data:
 *      { category, name, value, displayName, sortOrder, delete: 0 }
 */

require('dotenv').config();
const mongoose = require('mongoose');
const StatusLookup = require('./models/statusLookup.model');

const FORCE = process.argv.includes('--force');

const LOOKUPS = [
    // ──────────────────────────────────────────────────────────────
    // ORDER STATUSES
    // ──────────────────────────────────────────────────────────────
    { category: 'order_status', name: 'placed',           value: 'p',   displayName: 'Placed',           sortOrder: 1 },
    { category: 'order_status', name: 'confirmed',        value: 'c',   displayName: 'Confirmed',        sortOrder: 2 },
    { category: 'order_status', name: 'preparing',        value: 'pr',  displayName: 'Preparing',        sortOrder: 3 },
    { category: 'order_status', name: 'ready',            value: 'r',   displayName: 'Ready',            sortOrder: 4 },
    { category: 'order_status', name: 'out_for_delivery', value: 'od',  displayName: 'Out for Delivery', sortOrder: 5 },
    { category: 'order_status', name: 'delivered',        value: 'd',   displayName: 'Delivered',        sortOrder: 6 },
    { category: 'order_status', name: 'cancelled',        value: 'cx',  displayName: 'Cancelled',        sortOrder: 7 },

    // ──────────────────────────────────────────────────────────────
    // ORDER TYPE
    // ──────────────────────────────────────────────────────────────
    { category: 'order_type', name: 'pickup',   value: 'pickup',   displayName: 'Pickup',   sortOrder: 1 },
    { category: 'order_type', name: 'delivery', value: 'delivery', displayName: 'Delivery', sortOrder: 2 },

    // ──────────────────────────────────────────────────────────────
    // ORDER CATEGORY
    // ──────────────────────────────────────────────────────────────
    { category: 'order_category', name: 'today',    value: 'today',    displayName: 'Today',     sortOrder: 1 },
    { category: 'order_category', name: 'tomorrow', value: 'tomorrow', displayName: 'Tomorrow',  sortOrder: 2 },
    { category: 'order_category', name: 'preorder', value: 'preorder', displayName: 'Pre-order', sortOrder: 3 },

    // ──────────────────────────────────────────────────────────────
    // PAYMENT METHOD
    // ──────────────────────────────────────────────────────────────
    { category: 'payment_method', name: 'COD',    value: 'COD',    displayName: 'Cash on Delivery', sortOrder: 1 },
    { category: 'payment_method', name: 'CARD',   value: 'CARD',   displayName: 'Card',             sortOrder: 2 },
    { category: 'payment_method', name: 'UPI',    value: 'UPI',    displayName: 'UPI',              sortOrder: 3 },
    { category: 'payment_method', name: 'BANK',   value: 'BANK',   displayName: 'Bank Transfer',    sortOrder: 4 },
    { category: 'payment_method', name: 'WALLET', value: 'WALLET', displayName: 'Wallet',           sortOrder: 5 },

    // ──────────────────────────────────────────────────────────────
    // PAYMENT STATUS
    // ──────────────────────────────────────────────────────────────
    { category: 'payment_status', name: 'pending',          value: 'pending',          displayName: 'Pending',          sortOrder: 1 },
    { category: 'payment_status', name: 'paid',             value: 'paid',             displayName: 'Paid',             sortOrder: 2 },
    { category: 'payment_status', name: 'failed',           value: 'failed',           displayName: 'Failed',           sortOrder: 3 },
    { category: 'payment_status', name: 'refunded',         value: 'refunded',         displayName: 'Refunded',         sortOrder: 4 },
    { category: 'payment_status', name: 'refund_processed', value: 'refund_processed', displayName: 'Refund Processed', sortOrder: 5 },

    // ──────────────────────────────────────────────────────────────
    // USER STATUS (single-char codes)
    // ──────────────────────────────────────────────────────────────
    { category: 'user_status', name: 'active',   value: 'a', displayName: 'Active',   sortOrder: 1 },
    { category: 'user_status', name: 'inactive', value: 'i', displayName: 'Inactive', sortOrder: 2 },
    { category: 'user_status', name: 'pending',  value: 'p', displayName: 'Pending',  sortOrder: 3 },
    { category: 'user_status', name: 'deleted',  value: 'd', displayName: 'Deleted',  sortOrder: 4 },

    // ──────────────────────────────────────────────────────────────
    // LOGIN TYPE
    // ──────────────────────────────────────────────────────────────
    { category: 'login_type', name: 'signup',   value: 'su', displayName: 'Email Signup', sortOrder: 1 },
    { category: 'login_type', name: 'google',   value: 'gu', displayName: 'Google',       sortOrder: 2 },
    { category: 'login_type', name: 'facebook', value: 'fu', displayName: 'Facebook',     sortOrder: 3 },
    { category: 'login_type', name: 'apple',    value: 'au', displayName: 'Apple',        sortOrder: 4 },

    // ──────────────────────────────────────────────────────────────
    // USER ROLE
    // ──────────────────────────────────────────────────────────────
    { category: 'user_role', name: 'USER',   value: 'USER',   displayName: 'Customer', sortOrder: 1 },
    { category: 'user_role', name: 'VENDOR', value: 'VENDOR', displayName: 'Vendor',   sortOrder: 2 },

    // ──────────────────────────────────────────────────────────────
    // VENDOR STATUS
    // ──────────────────────────────────────────────────────────────
    { category: 'vendor_status', name: 'Active',   value: 'Active',   displayName: 'Active',   sortOrder: 1 },
    { category: 'vendor_status', name: 'Inactive', value: 'Inactive', displayName: 'Inactive', sortOrder: 2 },

    // ──────────────────────────────────────────────────────────────
    // KITCHEN STATUS
    // ──────────────────────────────────────────────────────────────
    { category: 'kitchen_status', name: 'PENDING', value: 'PENDING', displayName: 'Pending Setup', sortOrder: 1 },
    { category: 'kitchen_status', name: 'OPEN',    value: 'OPEN',    displayName: 'Open',          sortOrder: 2 },
    { category: 'kitchen_status', name: 'CLOSED',  value: 'CLOSED',  displayName: 'Closed',        sortOrder: 3 },

    // ──────────────────────────────────────────────────────────────
    // ADDRESS LABEL
    // ──────────────────────────────────────────────────────────────
    { category: 'address_label', name: 'Home',     value: 'Home',     displayName: 'Home',     sortOrder: 1 },
    { category: 'address_label', name: 'Work',     value: 'Work',     displayName: 'Work',     sortOrder: 2 },
    { category: 'address_label', name: 'Other',    value: 'Other',    displayName: 'Other',    sortOrder: 3 },
    { category: 'address_label', name: 'Business', value: 'Business', displayName: 'Business', sortOrder: 4 },

    // ──────────────────────────────────────────────────────────────
    // YES/NO (for cancellation policy, delivery available, etc.)
    // ──────────────────────────────────────────────────────────────
    { category: 'yes_no', name: 'yes', value: 'yes', displayName: 'Yes', sortOrder: 1 },
    { category: 'yes_no', name: 'no',  value: 'no',  displayName: 'No',  sortOrder: 2 },

    // ──────────────────────────────────────────────────────────────
    // TEMPLATE TYPE
    // ──────────────────────────────────────────────────────────────
    { category: 'template_type', name: 'EMAIL', value: 'EMAIL', displayName: 'Email', sortOrder: 1 },
    { category: 'template_type', name: 'SMS',   value: 'SMS',   displayName: 'SMS',   sortOrder: 2 },

    // ──────────────────────────────────────────────────────────────
    // CANCELLED BY
    // ──────────────────────────────────────────────────────────────
    { category: 'cancelled_by', name: 'user',   value: 'user',   displayName: 'Customer', sortOrder: 1 },
    { category: 'cancelled_by', name: 'vendor', value: 'vendor', displayName: 'Vendor',   sortOrder: 2 },

    // ──────────────────────────────────────────────────────────────
    // REFUND OFFER STATUS
    // ──────────────────────────────────────────────────────────────
    { category: 'refund_offer_status', name: 'rejected', value: '-1', displayName: 'Rejected', sortOrder: 1 },
    { category: 'refund_offer_status', name: 'pending',  value: '0',  displayName: 'Pending',  sortOrder: 2 },
    { category: 'refund_offer_status', name: 'accepted', value: '1',  displayName: 'Accepted', sortOrder: 3 },

    // ──────────────────────────────────────────────────────────────
    // FOOD TYPE / MENU CATEGORY
    // ──────────────────────────────────────────────────────────────
    { category: 'food_type', name: 'Main Course', value: 'main_course', displayName: 'Main Course', sortOrder: 1 },
    { category: 'food_type', name: 'Appetizers',  value: 'appetizers',  displayName: 'Appetizers',  sortOrder: 2 },
    { category: 'food_type', name: 'Breakfast',   value: 'breakfast',   displayName: 'Breakfast',   sortOrder: 3 },
    { category: 'food_type', name: 'Breads',      value: 'breads',      displayName: 'Breads',      sortOrder: 4 },
    { category: 'food_type', name: 'Desserts',    value: 'desserts',    displayName: 'Desserts',    sortOrder: 5 },
    { category: 'food_type', name: 'Beverages',   value: 'beverages',   displayName: 'Beverages',   sortOrder: 6 },
    { category: 'food_type', name: 'Pizza',       value: 'pizza',       displayName: 'Pizza',       sortOrder: 7 },
    { category: 'food_type', name: 'Burger',      value: 'burger',      displayName: 'Burger',      sortOrder: 8 },
    { category: 'food_type', name: 'Pasta',       value: 'pasta',       displayName: 'Pasta',       sortOrder: 9 },
    { category: 'food_type', name: 'Snacks',      value: 'snacks',      displayName: 'Snacks',      sortOrder: 10 },
    { category: 'food_type', name: 'Salads',      value: 'salads',      displayName: 'Salads',      sortOrder: 11 },

    // ──────────────────────────────────────────────────────────────
    // DIET CATEGORY (Veg / Non-Veg / Egg)
    // ──────────────────────────────────────────────────────────────
    { category: 'diet_category', name: 'Veg',     value: 'veg',     displayName: 'Veg',     sortOrder: 1 },
    { category: 'diet_category', name: 'Non-Veg', value: 'non_veg', displayName: 'Non-Veg', sortOrder: 2 },
    { category: 'diet_category', name: 'Egg',     value: 'egg',     displayName: 'Egg',     sortOrder: 3 },
    { category: 'diet_category', name: 'Vegan',   value: 'vegan',   displayName: 'Vegan',   sortOrder: 4 },

    // ──────────────────────────────────────────────────────────────
    // CUISINE
    // ──────────────────────────────────────────────────────────────
    { category: 'cuisine', name: 'Indian',     value: 'indian',     displayName: 'Indian',     sortOrder: 1 },
    { category: 'cuisine', name: 'Chinese',    value: 'chinese',    displayName: 'Chinese',    sortOrder: 2 },
    { category: 'cuisine', name: 'Italian',    value: 'italian',    displayName: 'Italian',    sortOrder: 3 },
    { category: 'cuisine', name: 'Mexican',    value: 'mexican',    displayName: 'Mexican',    sortOrder: 4 },
    { category: 'cuisine', name: 'Thai',       value: 'thai',       displayName: 'Thai',       sortOrder: 5 },
    { category: 'cuisine', name: 'Continental', value: 'continental', displayName: 'Continental', sortOrder: 6 },
    { category: 'cuisine', name: 'Arabian',    value: 'arabian',    displayName: 'Arabian',    sortOrder: 7 },
    { category: 'cuisine', name: 'Japanese',   value: 'japanese',   displayName: 'Japanese',   sortOrder: 8 },
    { category: 'cuisine', name: 'American',   value: 'american',   displayName: 'American',   sortOrder: 9 },
    { category: 'cuisine', name: 'Home Style', value: 'home_style', displayName: 'Home Style', sortOrder: 10 },

    // ──────────────────────────────────────────────────────────────
    // SIZE LABEL (for product variants - drinks, pizza, etc.)
    // ──────────────────────────────────────────────────────────────
    { category: 'size_label', name: 'Small',       value: 'S',   displayName: 'Small',       sortOrder: 1 },
    { category: 'size_label', name: 'Medium',      value: 'M',   displayName: 'Medium',      sortOrder: 2 },
    { category: 'size_label', name: 'Large',       value: 'L',   displayName: 'Large',       sortOrder: 3 },
    { category: 'size_label', name: 'Extra Large', value: 'XL',  displayName: 'Extra Large', sortOrder: 4 },
    { category: 'size_label', name: 'Family Pack', value: 'FAM', displayName: 'Family Pack', sortOrder: 5 },

    // ──────────────────────────────────────────────────────────────
    // VOLUME UNIT (for liquids — Coke 250ml, Coffee 500ml etc.)
    // ──────────────────────────────────────────────────────────────
    { category: 'volume_unit', name: 'ml',    value: 'ml',    displayName: 'Millilitres', sortOrder: 1 },
    { category: 'volume_unit', name: 'litre', value: 'L',     displayName: 'Litres',      sortOrder: 2 },
    { category: 'volume_unit', name: 'oz',    value: 'oz',    displayName: 'Ounces',      sortOrder: 3 },

    // ──────────────────────────────────────────────────────────────
    // WEIGHT UNIT (for solid items — Biryani 250g, Cake 1kg etc.)
    // ──────────────────────────────────────────────────────────────
    { category: 'weight_unit', name: 'gram',     value: 'g',     displayName: 'Grams',     sortOrder: 1 },
    { category: 'weight_unit', name: 'kilogram', value: 'kg',    displayName: 'Kilograms', sortOrder: 2 },
    { category: 'weight_unit', name: 'piece',    value: 'piece', displayName: 'Pieces',    sortOrder: 3 },

    // ──────────────────────────────────────────────────────────────
    // SPICE LEVEL
    // ──────────────────────────────────────────────────────────────
    { category: 'spice_level', name: 'Mild',     value: 'mild',     displayName: 'Mild',         sortOrder: 1 },
    { category: 'spice_level', name: 'Medium',   value: 'medium',   displayName: 'Medium Spicy', sortOrder: 2 },
    { category: 'spice_level', name: 'Hot',      value: 'hot',      displayName: 'Hot',          sortOrder: 3 },
    { category: 'spice_level', name: 'Extra Hot', value: 'extra_hot', displayName: 'Extra Hot', sortOrder: 4 },

    // ──────────────────────────────────────────────────────────────
    // EXISTING — keep these so old data still resolves
    // ──────────────────────────────────────────────────────────────
    { category: 'misc', name: 'special price applied', value: 'spa', displayName: 'Special Price Applied', sortOrder: 1 }
];

async function seed() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
        console.log('[Seed] Connected to MongoDB');

        let inserted = 0;
        let updated = 0;
        let skipped = 0;

        for (const item of LOOKUPS) {
            const filter = { category: item.category, value: item.value };
            const existing = await StatusLookup.findOne(filter);

            if (existing) {
                if (FORCE) {
                    await StatusLookup.updateOne(filter, { $set: { ...item, delete: 0 } });
                    updated++;
                } else {
                    skipped++;
                }
            } else {
                await StatusLookup.create({ ...item, delete: 0 });
                inserted++;
            }
        }

        console.log('────────────────────────────────────────');
        console.log(`[Seed] Inserted:  ${inserted}`);
        console.log(`[Seed] Updated:   ${updated}  ${FORCE ? '' : '(use --force to overwrite existing)'}`);
        console.log(`[Seed] Skipped:   ${skipped}`);
        console.log(`[Seed] Total:     ${LOOKUPS.length}`);
        console.log('────────────────────────────────────────');

        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error('[Seed] Error:', err);
        process.exit(1);
    }
}

seed();
