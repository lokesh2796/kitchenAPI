const Order = require('../models/order.model');
const UserProfile = require('../../models/userProfile.model');
const Users = require('../../models/users.model');
const Cart = require('../../order-service/models/cart.model');
const { calculateDistance, generateOrderId, generateOTP } = require('../../utils/order-utils');
const { publishEvent, CHANNELS, EVENTS } = require('../../utils/socket');
const { triggerEvent, PUSHER_CHANNELS, PUSHER_EVENTS } = require('../../utils/pusher');
const { notifyVendor, notifyUser } = require('../../utils/beams.service');

const ORDER_STATUS_TITLES = {
    confirmed:        'Order Confirmed!',
    preparing:        'Order Being Prepared',
    ready:            'Order Ready!',
    out_for_delivery: 'Out for Delivery',
    delivered:        'Order Delivered!',
    cancelled:        'Order Cancelled',
};
const ORDER_STATUS_MESSAGES = {
    confirmed:        'has been accepted.',
    preparing:        'is being prepared.',
    ready:            'is ready for pickup.',
    out_for_delivery: 'is on the way!',
    delivered:        'has been delivered.',
    cancelled:        'has been cancelled.',
};
const { computeCharges } = require('../../utils/order-charges');

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
            await notifyVendor(
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
        return res.status(500).json({ 
            message: 'Internal server error', 
            error: err.message,
            stack: err.stack 
        });
    }
};


/* ─────────────────────────────────────────────────────────────────────────────
   GET /orders/my
   Returns all orders for the logged-in user, newest first.
───────────────────────────────────────────────────────────────────────────── */
exports.getUserOrders = async (req, res) => {
    try {
        const userId = req.user._id;
        const orders = await Order.find({ userId }).populate('vendorId', 'firstName lastName profilePicture').sort({ createdAt: -1 });

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
        const orders = await Order.find({ vendorId }).populate('userId', 'firstName lastName phone profilePicture').sort({ createdAt: -1 });
        
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
        const { status, cancelReason } = req.body;

        const VALID = ['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'dispute', 'resolved'];
        if (!VALID.includes(status)) {
            return res.status(400).json({ message: `Invalid status. Must be one of: ${VALID.join(', ')}` });
        }
        if (status === 'dispute') {
            return res.status(400).json({ message: 'Use the dispute endpoint (POST /orders/:orderId/dispute) instead.' });
        }
        if (status === 'resolved') {
            return res.status(400).json({ message: 'Disputes can only be resolved through the dispute resolution flow.' });
        }

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found' });
        
        const currentUserId = req.user._id.toString();
        const isVendor = order.vendorId.toString() === currentUserId;
        const isCustomer = order.userId.toString() === currentUserId;
        
        if (!isVendor && !isCustomer) {
            return res.status(403).json({ message: 'Not authorized to update this order' });
        }

        // ── Delivery Date Restriction ──────────────────
        // Vendors can only 'Accept' (confirmed) or 'Cancel' future orders.
        // Preparing, Ready, Out for Delivery, Delivered are restricted to the actual delivery date.
        const RESTRICTED = ['preparing', 'ready', 'out_for_delivery', 'delivered'];
        if (isVendor && RESTRICTED.includes(status)) {
            const now = new Date();
            const istOffset = 5.5 * 60 * 60 * 1000;
            const istToday = new Date(now.getTime() + istOffset).toISOString().split('T')[0];
            const istDelivery = new Date(order.deliveryDate.getTime() + istOffset).toISOString().split('T')[0];

            if (istToday !== istDelivery) {
                return res.status(403).json({ 
                    message: `Status '${status}' is only allowed on the delivery date (${istDelivery}).` 
                });
            }
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
            
            // Calculate Refund
            if (order.paymentMethod !== 'COD') {
                if (isVendor) {
                    order.refundAmount = order.totalAmount; // 100% refund for vendor cancel
                    order.refundPercentage = 100;
                } else if (isCustomer) {
                    // Calculate time difference
                    const now = new Date();
                    let deliveryTime = new Date(order.deliveryDate);
                    
                    // If preferredTime is set, parse it and set hours/mins
                    if (order.preferredTime) {
                        let hours = 0;
                        let mins = 0;
                        const timeMatch = order.preferredTime.match(/(\d+):?(\d+)?\s*(AM|PM)?/i);
                        if (timeMatch) {
                            hours = parseInt(timeMatch[1]);
                            mins = parseInt(timeMatch[2] || '0');
                            const isPM = timeMatch[3]?.toUpperCase() === 'PM';
                            if (isPM && hours < 12) hours += 12;
                            if (!isPM && hours === 12) hours = 0;
                            deliveryTime.setHours(hours, mins, 0, 0);
                        }
                    } else {
                        // Default to end of day if no time specified
                        deliveryTime.setHours(23, 59, 59, 999);
                    }
                    
                    const diffMs = deliveryTime.getTime() - now.getTime();
                    const diffHours = diffMs / (1000 * 60 * 60);
                    
                    if (diffHours >= 12) {
                        order.refundAmount = order.totalAmount * 0.50;
                        order.refundPercentage = 50;
                    } else {
                        // Less than 12 hours (or even if time already passed, min refund is 40% as per user request)
                        // User said: "before 12 hours 50%, after 12 hours 40%"
                        order.refundAmount = order.totalAmount * 0.40;
                        order.refundPercentage = 40;
                    }
                }
                
                order.paymentStatus = 'refund_processed';
            }
        }

        order.status = status;
        const updated = await order.save();

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
                refundAmount: updated.refundAmount,
                refundPercentage: updated.refundPercentage,
                order: (broadcastOrder || updated).toJSON()
            };
            // Notify Customer of Status Change
            publishEvent(CHANNELS.USER_NOTIFICATIONS(order.userId), payload);
            triggerEvent(PUSHER_CHANNELS.USER(order.userId), PUSHER_EVENTS.STATUS_UPDATE, {
                orderId: updated.orderId,
                status: updated.status
            });
            await notifyUser(
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