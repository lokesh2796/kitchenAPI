const Cart = require('../models/cart.model');
const TodayMenu = require('../../menu-service/models/todayMenu.model');
const PreOrderMenu = require('../../menu-service/models/preOrderMenu.model');
const { computeCharges } = require('../../utils/order-charges');

/**
 * Check if the requested quantity is available for the given menu items.
 * @param {Array} items - List of items to check. [{ dailyMenuId, qty }]
 * @returns {Promise<string|null>} - Returns error message if insufficient stock, else null.
 */
async function checkStock(items) {
    for (const item of items) {
        if (!item.dailyMenuId) continue;

        let menuEntry = await TodayMenu.findById(item.dailyMenuId);
        if (!menuEntry) {
            menuEntry = await PreOrderMenu.findById(item.dailyMenuId);
        }

        if (!menuEntry) {
            return `Menu item '${item.menuName || 'Unknown'}' not found.`;
        }

        if (menuEntry.balanceQty < item.qty) {
            return `Only ${menuEntry.balanceQty} left for '${item.menuName || menuEntry.menuName}'. You requested ${item.qty}.`;
        }
    }
    return null;
}


/* ─────────────────────────────────────────────────────────────────────────────
   POST /cart/add
   Uses req.user._id (from verifyToken middleware) as customerId.
   action = 'add'    → merge qty  (menu page)
   action = 'update' → full replace (cart page)
───────────────────────────────────────────────────────────────────────────── */
exports.addToCart = async (req, res) => {
    try {
        const { vendorId, items, deliveryDate, preferredTime, specialInstructions, action = 'add' } = req.body;
        const customerId = req.user._id; // set by verifyToken middleware

        if (!customerId) {
            return res.status(401).json({ message: 'Unauthorized: user not found in request' });
        }
        if (!items || items.length === 0) {
            return res.status(400).json({ message: 'Missing required: items' });
        }
        if (action === 'add' && !vendorId) {
            return res.status(400).json({ message: 'Missing required: vendorId' });
        }

        let cart = await Cart.findOne({ customerId });

        // ── UPDATE: full replace from cart page ─────────────────────────────
        if (action === 'update') {
            if (!cart) return res.status(404).json({ message: 'Cart not found' });

            // Validate Stock for ALL items in the update request
            const stockError = await checkStock(items);
            if (stockError) {
                return res.status(400).json({ message: stockError });
            }

            cart.items = items;
            if (deliveryDate) cart.deliveryDate = deliveryDate;
            if (preferredTime !== undefined) cart.preferredTime = preferredTime;
            if (specialInstructions !== undefined) cart.specialInstructions = specialInstructions;
            await cart.save();

            return res.status(200).json({ message: 'Cart updated successfully', data: cart });
        }

        // ── ADD: merge qty from menu page ───────────────────────────────────
        if (cart) {
            // ... (vendor/date mismatch logic)
            if (cart.vendorId.toString() !== vendorId) {
                return res.status(409).json({
                    message: 'Your cart contains items from another kitchen. Would you like to clear it?',
                    code: 'VENDOR_MISMATCH'
                });
            }

            if (deliveryDate) {
                const existingDate = new Date(cart.deliveryDate).toISOString().split('T')[0];
                const incomingDate = new Date(deliveryDate).toISOString().split('T')[0];
                if (existingDate !== incomingDate) {
                    return res.status(409).json({
                        message: `Your cart contains items scheduled for ${existingDate}. Would you like to clear it to order for ${incomingDate}?`,
                        code: 'DATE_MISMATCH',
                        existingDate,
                        incomingDate
                    });
                }
            }

            // Validate Stock for the items being merged
            // Calculate potential total qty for each item being added
            const itemsToValidate = [];
            for (const incoming of items) {
                const existing = cart.items.find(
                    (i) => i.menuItemId.toString() === incoming.menuItemId.toString()
                );
                itemsToValidate.push({
                    dailyMenuId: incoming.dailyMenuId,
                    menuName: incoming.menuName,
                    qty: (existing ? existing.qty : 0) + incoming.qty
                });
            }

            const stockError = await checkStock(itemsToValidate);
            if (stockError) {
                return res.status(400).json({ message: stockError });
            }

            for (const incoming of items) {
                const existing = cart.items.find(
                    (i) => i.menuItemId.toString() === incoming.menuItemId.toString()
                );
                if (existing) {
                    existing.qty += incoming.qty;
                    if (incoming.splIns !== undefined) existing.splIns = incoming.splIns;
                    if (incoming.Addons !== undefined) existing.Addons = incoming.Addons;
                    if (incoming.dealPrice !== undefined) existing.dealPrice = incoming.dealPrice;
                } else {
                    cart.items.push(incoming);
                }
            }

            if (deliveryDate) cart.deliveryDate = deliveryDate;
            if (preferredTime) cart.preferredTime = preferredTime;
            await cart.save();

        } else {
            // New cart — Validate Stock first
            const stockError = await checkStock(items);
            if (stockError) {
                return res.status(400).json({ message: stockError });
            }

            // New cart — fallback deliveryDate to tomorrow if not provided
            const resolvedDate = deliveryDate || (() => {
                const d = new Date();
                d.setDate(d.getDate() + 1);
                return d;
            })();

            cart = new Cart({
                customerId,
                vendorId,
                items,
                deliveryDate: resolvedDate,
                preferredTime: preferredTime || '',
                specialInstructions: specialInstructions || '',
                payment: 'pending',
                payment_id: null
            });
            await cart.save();
        }

        return res.status(200).json({ message: 'Cart updated successfully', data: cart });

    } catch (err) {
        console.error('addToCart Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   GET /cart
   Returns the authenticated user's cart with all menuItem fields populated.
   No need to pass customerId in the URL — it comes from the JWT via middleware.

   Response shape:
   {
     data: {
       _id, customerId, vendorId, deliveryDate, preferredTime, payment, payment_id,
       items: [
         {
           _id,           ← sub-doc id (used for delete)
           menuItemId: {  ← fully populated MenuItem document
             _id, menuName, cuisine, category, coverPicture,
             basePrice, addOns, maxAddonsAllowed, ...
           },
           menuName, qty, basePrice, dealPrice, splIns, Addons
         }
       ]
     }
   }
───────────────────────────────────────────────────────────────────────────── */
exports.getCart = async (req, res) => {
    try {
        const customerId = req.user._id; // from verifyToken middleware

        if (!customerId) {
            return res.status(401).json({ message: 'Unauthorized: user not found in request' });
        }

        const cart = await Cart.findOne({ customerId })
            .populate({
                path: 'items.menuItemId',
                select: 'menuName cuisine category coverPicture otherPictures basePrice aboutItem addOnsAvail addOns maxAddonsAllowed'
            })
            .populate({
                path: 'vendorId',
                select: 'firstName lastName'
            });

        if (!cart) {
            return res.status(200).json({ data: { items: [], totalItems: 0, totalAmount: 0 } });
        }

        // Compute totals and categories server-side
        const TodayMenu = require('../../menu-service/models/todayMenu.model');
        const PreOrderMenu = require('../../menu-service/models/preOrderMenu.model');

        const totalItems = cart.items.reduce((sum, i) => sum + i.qty, 0);
        let maxDaysLead = 0; // 0=today, 1=tomorrow, 3=preorder

        const itemsWithCategory = await Promise.all(cart.items.map(async (i) => {
            const itemObj = i.toObject();
            
            // Determine category
            const todayMenuEntry = await TodayMenu.findById(i.dailyMenuId);
            const isPreorder = await PreOrderMenu.exists({ _id: i.dailyMenuId });
            
            const nowIST = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
            const todayISTStr = nowIST.toISOString().split('T')[0];

            if (todayMenuEntry) {
                const itemDateStr = new Date(todayMenuEntry.menuDate).toISOString().split('T')[0];
                if (itemDateStr > todayISTStr) {
                    itemObj.category = 'tomorrow';
                    maxDaysLead = Math.max(maxDaysLead, 1);
                } else {
                    itemObj.category = 'today';
                }
            } else if (isPreorder) {
                itemObj.category = 'preorder';
                maxDaysLead = Math.max(maxDaysLead, 3);
            } else {
                // Fallback for scheduled items or older carts
                itemObj.category = 'scheduled';
                maxDaysLead = Math.max(maxDaysLead, 1);
            }
            return itemObj;
        }));

        const cartObj = cart.toObject();
        const vendorIdStr = cartObj.vendorId?._id || cartObj.vendorId;

        // Look up businessName + delivery policy + location + cancellation
        // policies from vendor profile so the cart screen can show the same
        // delivery charge the order will use, the vendor's pickup address
        // when the user picks pickup, AND the vendor-specific cancellation
        // terms in the "View Cancellation Policy" sheet.
        const UserProfile = require('../../models/userProfile.model');
        const vendorProfile = await UserProfile.findOne({ userId: vendorIdStr })
            .select('businessName deliveryPolicy vendorLocation todayCancelPolicy preOrderCancelPolicy')
            .lean();
        const vendorName = vendorProfile?.businessName
            || `${cartObj.vendorId?.firstName || ''} ${cartObj.vendorId?.lastName || ''}`.trim()
            || '';

        // Build the charge breakdown via the shared helper. The cart UI shows
        // delivery as if the user picked the delivery option; if they switch
        // to pickup at checkout the order endpoint will recompute correctly.
        const orderType = cartObj.orderType || 'pickup';
        const charges = computeCharges(cart.items, {
            orderType,
            deliveryCharge: vendorProfile?.deliveryPolicy?.deliveryCharge || 0
        });

        return res.status(200).json({
            data: {
                ...cartObj,
                vendorId: vendorIdStr,
                vendorName,
                vendorLocation: vendorProfile?.vendorLocation || null,
                vendorCancelPolicy: {
                    today: vendorProfile?.todayCancelPolicy || null,
                    preOrder: vendorProfile?.preOrderCancelPolicy || null
                },
                items: itemsWithCategory,
                totalItems,
                requiredMinDays: maxDaysLead,
                // Backwards-compat: old clients still read totalAmount
                totalAmount: charges.grandTotal,
                charges
            }
        });

    } catch (err) {
        console.error('getCart Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   DELETE /cart/item/:itemId
   Remove a single item by its sub-document _id.
   If no items remain → delete the entire cart document.
───────────────────────────────────────────────────────────────────────────── */
exports.removeCartItem = async (req, res) => {
    try {
        const customerId = req.user._id;
        const { itemId } = req.params;

        const cart = await Cart.findOne({ customerId });
        if (!cart) return res.status(404).json({ message: 'Cart not found' });

        const beforeCount = cart.items.length;
        cart.items = cart.items.filter((i) => i._id.toString() !== itemId);

        if (cart.items.length === beforeCount) {
            return res.status(404).json({ message: 'Item not found in cart' });
        }

        if (cart.items.length === 0) {
            await Cart.findOneAndDelete({ customerId });
            return res.status(200).json({ message: 'Cart is now empty and has been cleared.', data: null });
        }

        await cart.save();
        return res.status(200).json({ message: 'Item removed successfully', data: cart });

    } catch (err) {
        console.error('removeCartItem Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   DELETE /cart
   Wipe the entire cart for the authenticated user.
───────────────────────────────────────────────────────────────────────────── */
exports.clearCart = async (req, res) => {
    try {
        const customerId = req.user._id;
        await Cart.findOneAndDelete({ customerId });
        return res.status(200).json({ message: 'Cart cleared successfully' });
    } catch (err) {
        console.error('clearCart Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   PATCH /cart/payment
   Stamp the cart with payment result after gateway callback.
   Body: { payment: 'paid'|'failed'|'refunded', payment_id: '<txn_id>' }
───────────────────────────────────────────────────────────────────────────── */
exports.updatePayment = async (req, res) => {
    try {
        const customerId = req.user._id;
        const { payment, payment_id } = req.body;

        const VALID = ['pending', 'paid', 'failed', 'refunded'];
        if (!payment || !VALID.includes(payment)) {
            return res.status(400).json({ message: `payment must be one of: ${VALID.join(', ')}` });
        }

        const cart = await Cart.findOneAndUpdate(
            { customerId },
            { $set: { payment, payment_id: payment_id || null } },
            { new: true }
        );

        if (!cart) return res.status(404).json({ message: 'Cart not found' });
        return res.status(200).json({ message: 'Payment status updated', data: cart });

    } catch (err) {
        console.error('updatePayment Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};