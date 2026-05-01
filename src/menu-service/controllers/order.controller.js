const Order = require('../models/order.model');
const UserProfile = require('../../models/userProfile.model');
const Users = require('../../models/users.model');
const Cart = require('../../order-service/models/cart.model');
const OrderAssignment = require('../../models/orderAssignment.model');
const { calculateDistance, generateOrderId, generateOTP } = require('../../utils/order-utils');
const { publishEvent, CHANNELS, EVENTS } = require('../../utils/socket');
const { triggerEvent, PUSHER_CHANNELS, PUSHER_EVENTS } = require('../../utils/pusher');
const { sendToVendor, sendToUser } = require('../../utils/firebase-fcm.service');
const { computeCharges } = require('../../utils/order-charges');
const MESSAGES = require('../../constants/messages');
const assignmentService = require('../../services/vendorAssignment.service');

const ORDER_STATUS_TITLES = MESSAGES.ORDER_NOTIFICATION.STATUS_TITLES;
const ORDER_STATUS_MESSAGES = MESSAGES.ORDER_NOTIFICATION.STATUS_MESSAGES;

// ── IST Date Helpers ──────────────────────────────
const getISTDateStr = (date) => {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(date));
};
/* ─────────────────────────────────────────────────────────────────────────────
   POST /orders
   userId comes from the JWT via verifyToken middleware (req.user._id)
   NOT from the request body — body only carries order details.
───────────────────────────────────────────────────────────────────────────── */
exports.placeOrder = async (req, res) => {
    console.log('--- PlaceOrder Start ---');
    try {
        const {
            vendorId, vendorName, items,
            orderType, deliveryAddressId,
            paymentMethod, specialInstructions,
            deliveryDate, preferredTime
        } = req.body;

        const userId = req.user._id;
        console.log('Payload:', { userId, vendorId, itemsCount: items?.length, deliveryDate });

        if (!userId || !vendorId || !items || items.length === 0) {
            return res.status(400).json({ message: 'Missing required fields: vendorId, items' });
        }

        // ── Date/Time Validation ─────────────────────────────────────────────
        const finalDeliveryDate = deliveryDate ? new Date(deliveryDate) : new Date();
        const todayStr = new Date().toISOString().split('T')[0];
        const deliveryDateStr = finalDeliveryDate.toISOString().split('T')[0];
        console.log('Dates:', { deliveryDateStr, todayStr });

        if (deliveryDateStr > todayStr && !preferredTime && !req.body.estimatedPickupTime) {
            return res.status(400).json({ message: 'Please select a preferred delivery time for this future-dated order' });
        }

        const finalPreferredTime = preferredTime || req.body.estimatedPickupTime || (deliveryDateStr === todayStr ? 'ASAP' : '');

        // ── Calculate totals via the shared charge helper ───────────────────
        // Per-line itemTotal is still attached for backwards-compat with the
        // existing order schema (orderItemSchema reads itemTotal).
        const processedItems = items.map((item) => {
            const price = item.dealPrice || item.basePrice;
            const addonsTotal = (item.selectedAddons || []).reduce((s, a) => s + (a.price || 0), 0);
            return { ...item, itemTotal: (price + addonsTotal) * item.qty };
        });

        let deliveryAddress = null;
        let vendorDeliveryCharge = 0;
        if (orderType === 'delivery') {
            const vendorProfile = await UserProfile.findOne({ userId: vendorId });
            vendorDeliveryCharge = vendorProfile?.deliveryPolicy?.deliveryCharge || 0;
        }

        const charges = computeCharges(items, {
            orderType,
            deliveryCharge: vendorDeliveryCharge
        });
        const { itemTotal, discount, deliveryCharge, platformCharge, taxAmount, subtotal, grandTotal } = charges;

        // ── Resolve Delivery Address ──
        const userProfile = await UserProfile.findOne({ userId });
        if (deliveryAddressId) {
            deliveryAddress =
                userProfile?.addresses?.find((a) => a._id.toString() === deliveryAddressId) ||
                userProfile?.deliveryAddress?.find((a) => a._id.toString() === deliveryAddressId) ||
                null;
        } else {
            deliveryAddress =
                userProfile?.addresses?.find((a) => a.isDefault) ||
                userProfile?.deliveryAddress?.find((a) => a.isDefault) ||
                null;
        }

        if (!deliveryAddress) {
            return res.status(400).json({ message: 'Please select a delivery address or add one to your profile' });
        }

        const totalAmount = grandTotal;
        console.log('Totals:', { itemTotal, discount, subtotal, deliveryCharge, platformCharge, taxAmount, totalAmount });

        // ── Resolve vendorName ──────────────────────────────────────────────
        let finalVendorName = vendorName;
        let vendorAddress = null;

        const vp = await UserProfile.findOne({ userId: vendorId });
        if (vp) {
            vendorAddress = vp.vendorLocation;
            if (!finalVendorName || finalVendorName.trim() === '') {
                finalVendorName = vp.businessName;
            }
        }

        if (!finalVendorName || finalVendorName.trim() === '') {
            const vu = await Users.findById(vendorId);
            if (vu) {
                finalVendorName = (vu.firstName + ' ' + (vu.lastName || '')).trim() || 'Kitchen';
            } else {
                finalVendorName = 'Kitchen';
            }
        }

        // ── Check & Deduct Stock Atomically ──────────────────────────
        console.log('Starting Stock Deduction...');
        const TodayMenu = require('../models/todayMenu.model');
        const PreOrderMenu = require('../models/preOrderMenu.model');

        // ── IST Time Helpers (inline — same logic as menu.controller) ─────
        const getCurrentISTMinutes = () => {
            const istDate = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
            return istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
        };
        const timeStrToMinutes = (timeStr) => {
            if (!timeStr) return null;
            if (timeStr === 'Noon') return 720;
            const match = timeStr.match(/(\d+):?(\d+)?\s*(AM|PM)?/i);
            if (!match) return null;
            let h = parseInt(match[1]), m = parseInt(match[2] || '0');
            const p = (match[3] || '').toUpperCase();
            if (p === 'PM' && h !== 12) h += 12;
            if (p === 'AM' && h === 12) h = 0;
            return h * 60 + m;
        };

        // ── Time Window Check for Today's items ───────────────────────────
        // deliveryDateStr and todayStr are already computed above.
        // Only enforce the time window for same-day orders; future orders
        // (tomorrow/preorder) are scheduled by the customer, not live.
        const isOrderForToday = deliveryDateStr === todayStr;
        if (isOrderForToday) {
            const nowMins = getCurrentISTMinutes();
            for (const item of items) {
                if (!item.dailyMenuId) continue;
                const entry = await TodayMenu.findById(item.dailyMenuId).select('availFrom availTo menuName').lean();
                if (!entry) continue; // Pre-order only item — checked elsewhere

                const fromMins = timeStrToMinutes(entry.availFrom) ?? 0;
                const toMins   = timeStrToMinutes(entry.availTo)   ?? 1440; // 24:00 hard cutoff

                if (nowMins < fromMins) {
                    const fromLabel = entry.availFrom || '12:00 AM';
                    return res.status(400).json({
                        message: `Orders for "${entry.menuName}" open at ${fromLabel}. Please place your order after that time.`
                    });
                }
                if (nowMins >= toMins) {
                    const toLabel = entry.availTo || 'midnight';
                    return res.status(400).json({
                        message: `Orders for "${entry.menuName}" closed at ${toLabel}. This item is no longer available for today.`
                    });
                }
            }
        }

        // Check if any item is a pre-order only item
        let containsPreorderOnly = false;
        for (const item of items) {
            if (item.dailyMenuId) {
                const isToday = await TodayMenu.exists({ _id: item.dailyMenuId });
                const isPreorder = await PreOrderMenu.exists({ _id: item.dailyMenuId });
                if (!isToday && isPreorder) {
                    containsPreorderOnly = true;
                    break;
                }
            }
        }

        const deductedItems = [];

        for (const item of items) {
            const dailyMenuId = item.dailyMenuId;
            if (!dailyMenuId) {
                console.log(`Skipping item ${item.menuName} (no dailyMenuId)`);
                continue;
            }

            console.log(`Deducting ${item.qty} from dailyMenuId: ${dailyMenuId} (${item.menuName})`);
            
            // ── Data Type Normalization (Self-Healing) ──────────────────────
            // In case of legacy data where soldQty might be an array or non-numeric
            const fixQuery = { _id: dailyMenuId, $or: [
                { soldQty: { $not: { $type: "number" } } },
                { balanceQty: { $not: { $type: "number" } } }
            ]};
            
            const todayFix = await TodayMenu.findOne(fixQuery);
            if (todayFix) {
                console.log(`Self-healing TodayMenu item ${dailyMenuId}: Reseting non-numeric fields`);
                await TodayMenu.updateOne({ _id: dailyMenuId }, { $set: { soldQty: 0, balanceQty: todayFix.maxQty } });
            }
            
            const preorderFix = await PreOrderMenu.findOne(fixQuery);
            if (preorderFix) {
                console.log(`Self-healing PreOrderMenu item ${dailyMenuId}: Reseting non-numeric fields`);
                await PreOrderMenu.updateOne({ _id: dailyMenuId }, { $set: { soldQty: 0, balanceQty: preorderFix.maxQty } });
            }

            // TodayMenu
            let updatedEntry = await TodayMenu.findOneAndUpdate(
                { _id: dailyMenuId, balanceQty: { $gte: item.qty } },
                { $inc: { soldQty: item.qty, balanceQty: -item.qty } },
                { new: true }
            );

            // PreOrderMenu
            if (!updatedEntry) {
                console.log('Not in TodayMenu, checking PreOrderMenu...');
                updatedEntry = await PreOrderMenu.findOneAndUpdate(
                    { _id: dailyMenuId, balanceQty: { $gte: item.qty } },
                    { $inc: { soldQty: item.qty, balanceQty: -item.qty } },
                    { new: true }
                );
            }

            if (!updatedEntry) {
                console.log(`FAILED stock deduction for item: ${item.menuName}`);
                // Rollback
                for (const d of deductedItems) {
                    await TodayMenu.updateOne({ _id: d.id }, { $inc: { soldQty: -d.qty, balanceQty: d.qty } });
                    await PreOrderMenu.updateOne({ _id: d.id }, { $inc: { soldQty: -d.qty, balanceQty: d.qty } });
                }
                return res.status(400).json({ 
                    message: `Insufficient quantity available for ${item.menuName}. Order could not be placed.` 
                });
            } else {
                console.log(`SUCCESS stock deduction for item: ${item.menuName}. New balance: ${updatedEntry.balanceQty}`);
                deductedItems.push({ id: dailyMenuId, qty: item.qty });
            }
        }

        // ── Calculate Order Category (IST aware) ──────────
        const todayISTStr = getISTDateStr(new Date());
        
        const tomDate = new Date();
        tomDate.setDate(tomDate.getDate() + 1);
        const tomISTStr = getISTDateStr(tomDate);
        
        const delISTStr = getISTDateStr(finalDeliveryDate);

        // Diff in days for lead time check (based on clean date boundaries)
        const diffTime = Math.abs(new Date(delISTStr).getTime() - new Date(todayISTStr).getTime());
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        let orderCategory = 'preorder';
        if (delISTStr === todayISTStr) {
            orderCategory = 'today';
        } else if (delISTStr === tomISTStr) {
            orderCategory = 'tomorrow';
        }

        // Enforce 3-day lead time for "preorder" category
        if (orderCategory === 'preorder' && diffDays < 3) {
            return res.status(400).json({
                message: 'Pre-orders require at least a 3-day advance notice (e.g., if today is 24th, delivery must be 27th or later).'
            });
        }

        // Enforce 30-day cap for pre-orders
        if (orderCategory === 'preorder' && diffDays > 30) {
            return res.status(400).json({
                message: 'Pre-orders can only be placed up to 30 days in advance.'
            });
        }

        // Today/tomorrow orders must not be placed for a different date
        if (orderCategory === 'today' && delISTStr !== todayISTStr) {
            return res.status(400).json({ message: 'Today orders must have today\'s date as the delivery date.' });
        }
        if (orderCategory === 'tomorrow' && delISTStr !== tomISTStr) {
            return res.status(400).json({ message: 'Tomorrow orders must have tomorrow\'s date as the delivery date.' });
        }

        // Enforce 9 AM - 12 PM window for Tomorrow and Pre-orders
        if (orderCategory === 'tomorrow' || orderCategory === 'preorder') {
            if (!finalPreferredTime) {
                return res.status(400).json({ message: 'Please select a delivery time for your scheduled order.' });
            }
            
            // Normalize time string to HH:mm (e.g. "09:30 AM" or "09:30")
            let hour = 0;
            const timeMatch = finalPreferredTime.match(/(\d+):?(\d+)?\s*(AM|PM)?/i);
            if (timeMatch) {
                hour = parseInt(timeMatch[1]);
                const isPM = timeMatch[3]?.toUpperCase() === 'PM';
                if (isPM && hour < 12) hour += 12;
                if (!isPM && hour === 12) hour = 0;
            }

            if (hour < 9 || hour >= 12) {
                return res.status(400).json({ 
                    message: `For ${orderCategory} delivery, please select a time between 9:00 AM and 12:00 PM.` 
                });
            }
        }

        console.log('Order Category (IST):', orderCategory, { delISTStr, todayISTStr, tomISTStr, diffDays });

        const order = new Order({
            userId, vendorId, vendorName: finalVendorName,
            items: processedItems,
            itemTotal, discount, subtotal,
            deliveryCharge, platformCharge, taxAmount, totalAmount,
            orderType: orderType || 'pickup',
            deliveryAddress, vendorAddress,
            paymentMethod: paymentMethod || 'COD',
            specialInstructions: specialInstructions || '',
            deliveryDate: finalDeliveryDate,
            preferredTime: finalPreferredTime,
            category: orderCategory,
            status: 'placed',
            estimatedPickupTime: finalPreferredTime,
            orderId: generateOrderId(),
            otp: generateOTP()
        });

        console.log('Saving order to DB...');
        const saved = await order.save();
        console.log('Order saved successfully ID:', saved._id);

        // ── Trigger vendor acceptance flow (non-blocking) ─────────────────
        assignmentService.initiateAssignment(saved._id).catch((err) => {
            console.error(`[Assignment] initiateAssignment failed for ${saved.orderId}:`, err.message);
        });

        // ── Clear the cart ───────────────────────────
        await Cart.findOneAndDelete({ customerId: userId });
        console.log('Cart cleared for user:', userId);

        // ── Real-time Notifications ───────────────────
        try {
            // 1. Notify Vendor of New Order
            // Populate the user data so the vendor dashboard can show the name immediately
            const populatedOrder = await Order.findById(saved._id)
                .populate('userId', 'firstName lastName phone profilePicture');

            publishEvent(CHANNELS.VENDOR_NOTIFICATIONS(vendorId), {
                event: EVENTS.NEW_ORDER,
                orderId: saved.orderId,
                totalAmount: saved.totalAmount,
                order: (populatedOrder || saved).toJSON()
            });
            triggerEvent(PUSHER_CHANNELS.VENDOR(vendorId), PUSHER_EVENTS.NEW_ORDER, {
                orderId: saved.orderId,
                totalAmount: saved.totalAmount
            });
            await sendToVendor(
                vendorId,
                'New Order Received!',
                `Order #${saved.orderId} • ₹${saved.totalAmount}`,
                { orderId: saved.orderId, type: 'new_order' }
            );

            // 2. Broadcast Stock Updates to Public
            for (const item of processedItems) {
                if (item.dailyMenuId) {
                    // Fetch current balance to be accurate
                    const TodayMenu = require('../models/todayMenu.model');
                    const PreOrderMenu = require('../models/preOrderMenu.model');
                    const entry = await TodayMenu.findById(item.dailyMenuId) || await PreOrderMenu.findById(item.dailyMenuId);
                    
                    if (entry) {
                        publishEvent(CHANNELS.PUBLIC_UPDATES, {
                            event: EVENTS.ITEM_QTY_UPDATE,
                            dailyMenuId: item.dailyMenuId,
                            balanceQty: entry.balanceQty
                        });
                    }
                }
            }
        } catch (pbErr) {
            console.error('Socket.IO Notification Error:', pbErr);
        }

        return res.status(201).json({
            message: 'Order placed successfully!',
            data: saved
        });

    } catch (err) {
        console.error('CRITICAL placeOrder Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   GET /orders/my
   Returns all orders for the logged-in user, newest first.
───────────────────────────────────────────────────────────────────────────── */
exports.getUserOrders = async (req, res) => {
    try {
        const userId = req.user._id;
        const orders = await Order.find({ userId }).populate('vendorId', 'firstName lastName profilePicture phone countryCode').sort({ createdDate: -1 });

        const todayISTStr = getISTDateStr(new Date());
        const tomDate = new Date();
        tomDate.setDate(tomDate.getDate() + 1);
        const tomISTStr = getISTDateStr(tomDate);

        const data = orders.map(o => {
            const order = o.toObject();

            // Dynamic Category Recalculation (same as getVendorOrders)
            if (o.deliveryDate) {
                const delISTStr = getISTDateStr(o.deliveryDate);
                if (delISTStr === todayISTStr) {
                    order.category = 'today';
                } else if (delISTStr === tomISTStr) {
                    order.category = 'tomorrow';
                } else {
                    order.category = 'preorder';
                }
            }

            order.distance = calculateDistance(
                o.vendorAddress?.lat, o.vendorAddress?.long,
                o.deliveryAddress?.lat, o.deliveryAddress?.long
            );
            return order;
        });

        return res.status(200).json({ data });
    } catch (err) {
        console.error('getUserOrders Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   GET /orders/vendor
   Returns all orders for the logged-in vendor, newest first.
   Requires isVendor middleware on the route.
───────────────────────────────────────────────────────────────────────────── */
exports.getVendorOrders = async (req, res) => {
    try {
        const vendorId = req.user._id;
        const orders = await Order.find({ vendorId }).populate('userId', 'firstName lastName phone profilePicture').sort({ createdDate: -1 });
        
        const todayISTStr = getISTDateStr(new Date());
        const tomDate = new Date();
        tomDate.setDate(tomDate.getDate() + 1);
        const tomISTStr = getISTDateStr(tomDate);

        const data = orders.map(o => {
            const order = o.toObject(); // Base object

            // Dynamic Category Recalculation
            const delISTStr = getISTDateStr(o.deliveryDate);
            if (delISTStr === todayISTStr) {
                order.category = 'today';
            } else if (delISTStr === tomISTStr) {
                order.category = 'tomorrow';
            } else {
                order.category = 'preorder';
            }

            order.distance = calculateDistance(
                o.vendorAddress?.lat, o.vendorAddress?.long,
                o.deliveryAddress?.lat, o.deliveryAddress?.long
            );
            return order;
        });

        return res.status(200).json({ data });
    } catch (err) {
        console.error('getVendorOrders Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   PATCH /orders/:orderId/status
   Vendor updates order status.
───────────────────────────────────────────────────────────────────────────── */
exports.updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { cancelReason } = req.body;

        // req.canonicalStatus and req.order are set by orderStateMachine middleware.
        // Fall back to raw values for routes not protected by the middleware.
        const status = req.canonicalStatus || req.body.status;
        const order  = req.order || await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const currentUserId = req.user._id.toString();
        const isVendor  = req.actor ? req.actor === 'vendor'  : order.vendorId.toString()  === currentUserId;
        const isCustomer = req.actor ? req.actor === 'user'   : order.userId.toString()    === currentUserId;

        if (!isVendor && !isCustomer) {
            return res.status(403).json({ message: 'Not authorized to update this order' });
        }

        if (status === 'disputed') {
            return res.status(400).json({ message: 'Use the dispute endpoint (POST /orders/:orderId/dispute) instead.' });
        }
        if (status === 'resolved') {
            return res.status(400).json({ message: 'Disputes can only be resolved through the dispute resolution flow.' });
        }

        // ── Stock Warning on Vendor Acceptance ────────────────────────────
        // When a vendor confirms an order, check if any item has run out of stock.
        // This handles the race condition where two orders were placed at the same time
        // against the last available qty — both orders were placed (stock deducted atomically),
        // but now balanceQty is 0. The vendor needs to decide if they can still fulfill it.
        if (isVendor && status === 'confirmed' && !req.body.forceAccept) {
            const TodayMenu = require('../models/todayMenu.model');
            const PreOrderMenu = require('../models/preOrderMenu.model');
            const stockWarnings = [];

            for (const item of order.items) {
                if (!item.dailyMenuId) continue;
                const entry =
                    await TodayMenu.findById(item.dailyMenuId).select('balanceQty maxQty') ||
                    await PreOrderMenu.findById(item.dailyMenuId).select('balanceQty maxQty');

                if (entry && entry.balanceQty === 0) {
                    stockWarnings.push({
                        menuItemId: item.menuItemId,
                        menuName: item.menuName,
                        orderedQty: item.qty,
                        balanceQty: 0,
                    });
                }
            }

            if (stockWarnings.length > 0) {
                return res.status(409).json({
                    requiresConfirmation: true,
                    message: 'Some items in this order have sold out. Do you still want to accept?',
                    stockWarnings,
                    hint: 'Re-send this request with forceAccept: true to confirm anyway.',
                });
            }
        }


        // ── Scheduled-order time lock ─────────────────────────────────────────
        // For tomorrow / pre-orders the vendor may accept at any time, but
        // preparing actions are locked until the scheduled date+time.
        // 'delivered' is excluded: once food is out for delivery / in the vendor's
        // hands the time lock has already been satisfied by an earlier transition.
        if (isVendor && !['confirmed', 'cancelled', 'delivered'].includes(status)) {
            const cat = order.category;
            if (cat === 'tomorrow' || cat === 'preorder') {
                const ptime = order.preferredTime || order.estimatedPickupTime || '00:00';
                const match = ptime.match(/(\d+):?(\d+)?\s*(AM|PM)?/i);
                if (match) {
                    let h = parseInt(match[1]), m = parseInt(match[2] || '0');
                    const pm = (match[3] || '').toUpperCase() === 'PM';
                    if (pm && h < 12) h += 12;
                    if (!pm && h === 12) h = 0;
                    const scheduledTime = new Date(order.deliveryDate);
                    scheduledTime.setHours(h, m, 0, 0);
                    if (new Date() < scheduledTime) {
                        const dateLabel = scheduledTime.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
                        return res.status(403).json({
                            message: `This order can only be prepared from ${ptime} on ${dateLabel}.`,
                            lockedUntil: scheduledTime.toISOString()
                        });
                    }
                }
            }
        }

        // Guard: already-delivered order must not be re-delivered (idempotency)
        if (status === 'delivered' && order.status === 'delivered') {
            return res.status(409).json({ message: 'Order has already been marked as delivered.' });
        }

        // Restore stock if order is rejected/cancelled
        if (order.status !== 'cancelled' && status === 'cancelled') {
            // Track who cancelled
            order.cancelledBy = isVendor ? 'vendor' : 'user';
            order.cancelReason = cancelReason || '';

            const TodayMenu = require('../models/todayMenu.model');
            const PreOrderMenu = require('../models/preOrderMenu.model');
            for (const item of order.items) {
                const dailyMenuId = item.dailyMenuId;
                if (!dailyMenuId) continue;
                await TodayMenu.updateOne(
                    { _id: dailyMenuId },
                    { $inc: { soldQty: -item.qty, balanceQty: item.qty } }
                );
                await PreOrderMenu.updateOne(
                    { _id: dailyMenuId },
                    { $inc: { soldQty: -item.qty, balanceQty: item.qty } }
                );
            }
            
        }

        order.status = status;
        if (!order.statusHistory) order.statusHistory = [];
        order.statusHistory.push({
            status,
            changedBy: isVendor ? 'vendor' : 'user',
            note: status === 'cancelled' ? (cancelReason || '') : undefined,
            changedAt: new Date(),
        });
        const updated = await order.save();

        // Kill the pending acceptance timeout job when the vendor advances the order.
        // Not needed for 'delivered' — by that point the acceptance window was
        // resolved long ago (at 'confirmed' or via /accept). Skipping avoids a
        // redundant DB read and keeps the intent clear.
        if (isVendor && status !== 'delivered') {
            assignmentService.cancelAcceptanceJob(order._id).catch(() => {});
        }

        // ── Real-time Notification ───────────────────
        try {
            // Populate essential fields before broadcast to ensure UI doesn't lose data (names, etc.)
            const broadcastOrder = await Order.findById(updated._id)
                .populate('userId', 'firstName lastName phone profilePicture')
                .populate('vendorId', 'firstName lastName profilePicture businessName');

            const payload = {
                event: EVENTS.ORDER_STATUS_UPDATE,
                _id: updated._id,
                orderId: updated.orderId,
                status: updated.status,
                order: (broadcastOrder || updated).toJSON()
            };
            // Notify Customer of Status Change
            publishEvent(CHANNELS.USER_NOTIFICATIONS(order.userId), payload);
            triggerEvent(PUSHER_CHANNELS.USER(order.userId), PUSHER_EVENTS.STATUS_UPDATE, {
                orderId: updated.orderId,
                status: updated.status
            });
            await sendToUser(
                order.userId.toString(),
                ORDER_STATUS_TITLES[updated.status] || 'Order Updated',
                `Order #${updated.orderId} ${ORDER_STATUS_MESSAGES[updated.status] || `is now ${updated.status}`}`,
                { orderId: updated.orderId, status: updated.status, type: 'status_update' }
            );
            // Notify Vendor to sync other active dashboard sessions
            publishEvent(CHANNELS.VENDOR_NOTIFICATIONS(order.vendorId), payload);

            // If cancelled, broadcast stock restoration
            if (status === 'cancelled') {
                const TodayMenu = require('../models/todayMenu.model');
                const PreOrderMenu = require('../models/preOrderMenu.model');
                for (const item of order.items) {
                    if (item.dailyMenuId) {
                        const entry = await TodayMenu.findById(item.dailyMenuId) || await PreOrderMenu.findById(item.dailyMenuId);
                        if (entry) {
                            publishEvent(CHANNELS.PUBLIC_UPDATES, {
                                event: EVENTS.ITEM_QTY_UPDATE,
                                dailyMenuId: item.dailyMenuId,
                                balanceQty: entry.balanceQty
                            });
                        }
                    }
                }
            }
        } catch (pbErr) {
            console.error('Socket.IO Notification Error (UpdateStatus):', pbErr);
        }

        return res.status(200).json({ message: 'Status updated', data: updated });

    } catch (err) {
        console.error('updateOrderStatus Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};

const CHAT_ALLOWED_STATUSES = ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];

/* ─────────────────────────────────────────────────────────────────────────────
   GET /orders/:orderId/chat
   Returns chat messages for an order. Marks messages from the other side read.
───────────────────────────────────────────────────────────────────────────── */
exports.getChatMessages = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user._id.toString();

        const order = await Order.findById(orderId).select('userId vendorId status chatMessages orderId');
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const isCustomer = order.userId.toString() === userId;
        const isVendor   = order.vendorId.toString() === userId;
        if (!isCustomer && !isVendor) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (!CHAT_ALLOWED_STATUSES.includes(order.status)) {
            return res.status(403).json({ message: 'Chat is available only after the order is confirmed.' });
        }

        // Mark messages from the OTHER party as read
        const myRole = isCustomer ? 'user' : 'vendor';
        await Order.updateOne(
            { _id: orderId },
            { $set: { 'chatMessages.$[msg].read': true } },
            { arrayFilters: [{ 'msg.senderRole': { $ne: myRole }, 'msg.read': false }] }
        );

        return res.status(200).json({ data: order.chatMessages });
    } catch (err) {
        console.error('getChatMessages Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /orders/:orderId/chat
   Send a new chat message. Broadcasts via socket + FCM to recipient.
───────────────────────────────────────────────────────────────────────────── */
exports.sendChatMessage = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { message } = req.body;
        const userId = req.user._id.toString();

        if (!message?.trim()) {
            return res.status(400).json({ message: 'Message cannot be empty' });
        }
        if (message.trim().length > 500) {
            return res.status(400).json({ message: 'Message too long (max 500 characters)' });
        }

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const isCustomer = order.userId.toString() === userId;
        const isVendor   = order.vendorId.toString() === userId;
        if (!isCustomer && !isVendor) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        if (!CHAT_ALLOWED_STATUSES.includes(order.status)) {
            return res.status(403).json({ message: 'Chat is available only after the order is confirmed.' });
        }

        const senderRole = isCustomer ? 'user' : 'vendor';
        order.chatMessages.push({
            senderId: userId,
            senderRole,
            message: message.trim(),
            read: false,
            createdAt: new Date()
        });
        await order.save();

        const savedMsg = order.chatMessages[order.chatMessages.length - 1];

        // ── Real-time: broadcast to order-chat room ───────────────────────
        try {
            const { CHAT_ROOM } = require('../../../utils/socket');
            publishEvent(CHAT_ROOM(orderId), {
                event: EVENTS.CHAT_MESSAGE,
                orderId,
                messageDoc: savedMsg,
                senderRole
            });

            // Also notify the recipient's personal room (for badge update when chat isn't open)
            const recipientRoom = isCustomer
                ? CHANNELS.VENDOR_NOTIFICATIONS(order.vendorId)
                : CHANNELS.USER_NOTIFICATIONS(order.userId);
            publishEvent(recipientRoom, {
                event: EVENTS.CHAT_MESSAGE,
                orderId,
                messageDoc: savedMsg,
                senderRole
            });
        } catch (pbErr) {
            console.error('Chat Socket Error:', pbErr);
        }

        // ── FCM push to recipient ────────────────────────────────────────
        try {
            const recipientId = isCustomer ? order.vendorId.toString() : order.userId.toString();
            const title = isCustomer ? 'Message from Customer' : 'Message from Kitchen';
            if (isCustomer) {
                await sendToVendor(recipientId, title, message.trim().substring(0, 100), {
                    orderId: order.orderId, type: 'chat_message'
                });
            } else {
                await sendToUser(recipientId, title, message.trim().substring(0, 100), {
                    orderId: order.orderId, type: 'chat_message'
                });
            }
        } catch (fcmErr) {
            console.error('Chat FCM Error:', fcmErr);
        }

        return res.status(200).json({ data: savedMsg });
    } catch (err) {
        console.error('sendChatMessage Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};

/* ─────────────────────────────────────────────────────────────────────────────
   GET /orders/:orderId/chat/unread
   Returns the unread message count for the calling user.
───────────────────────────────────────────────────────────────────────────── */
exports.getChatUnreadCount = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user._id.toString();

        const order = await Order.findById(orderId).select('userId vendorId chatMessages status');
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const isCustomer = order.userId.toString() === userId;
        const isVendor   = order.vendorId.toString() === userId;
        if (!isCustomer && !isVendor) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const myRole = isCustomer ? 'user' : 'vendor';
        const unread = order.chatMessages.filter(m => m.senderRole !== myRole && !m.read).length;

        return res.status(200).json({ data: { unread } });
    } catch (err) {
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   POST /orders/:orderId/accept
   Vendor confirms they will fulfil this order.
   Must be called within the acceptance window (120 s for TODAY, 60 s otherwise).
───────────────────────────────────────────────────────────────────────────── */
exports.acceptOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const vendorId    = req.user._id;

        await assignmentService.vendorAccept(orderId, vendorId);

        return res.status(200).json({ message: 'Order accepted successfully.' });
    } catch (err) {
        const code = err.statusCode || 500;
        return res.status(code).json({ message: err.message });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   POST /orders/:orderId/reject
   Vendor declines this order. Triggers immediate reassignment.
   Body (optional): { reason: String }
───────────────────────────────────────────────────────────────────────────── */
exports.rejectOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const vendorId    = req.user._id;
        const { reason }  = req.body;

        await assignmentService.vendorReject(orderId, vendorId, reason || '');

        // Return immediately — user will be notified only when a new vendor accepts or order is cancelled.
        return res.status(200).json({ message: 'Order rejected. Reassigning to next available vendor.' });
    } catch (err) {
        const code = err.statusCode || 500;
        return res.status(code).json({ message: err.message });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   GET /orders/:orderId/assignment
   Returns assignment status for this order — used by vendor dashboard
   to show the live acceptance countdown.
───────────────────────────────────────────────────────────────────────────── */
exports.getAssignmentStatus = async (req, res) => {
    try {
        const { orderId } = req.params;

        const assignment = await OrderAssignment.findOne({ orderId })
            .select('currentVendorId retryCount maxRetries finalStatus attempts')
            .lean();

        if (!assignment) {
            return res.status(404).json({ message: 'Assignment record not found' });
        }

        const lastAttempt = assignment.attempts[assignment.attempts.length - 1] || null;
        const remainingSecs = lastAttempt
            ? Math.max(0, Math.round((new Date(lastAttempt.timeoutAt) - Date.now()) / 1000))
            : 0;

        return res.status(200).json({
            data: {
                finalStatus:      assignment.finalStatus,
                currentVendorId:  assignment.currentVendorId,
                retryCount:       assignment.retryCount,
                maxRetries:       assignment.maxRetries,
                remainingSecs,
                timeoutAt:        lastAttempt?.timeoutAt,
            },
        });
    } catch (err) {
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};