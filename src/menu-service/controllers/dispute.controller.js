const Order = require('../models/order.model');
const { publishEvent, CHANNELS, EVENTS } = require('../../utils/socket');

// ── POST /orders/:orderId/dispute ────────────────────────
// Customer raises a dispute on a delivered/picked-up order.
exports.raiseDispute = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const { orderId } = req.params;
        const { reason, description, agreedToPolicy } = req.body;

        if (!reason) return res.status(400).json({ message: 'Dispute reason is required.' });
        if (!agreedToPolicy) return res.status(400).json({ message: 'You must agree to the refund policy.' });

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (String(order.userId) !== String(userId)) {
            return res.status(403).json({ message: 'Only the customer can raise a dispute.' });
        }

        // Validate: order must be delivered OR 30 min past requested time
        const status = order.status;
        const isDelivered = ['delivered', 'out_for_delivery', 'ready'].includes(status);
        const now = new Date();
        let isPastTime = false;
        if (order.deliveryDate && order.preferredTime) {
            const deliveryMs = new Date(order.deliveryDate).getTime();
            const timeParts = order.preferredTime.match(/(\d+):?(\d+)?\s*(AM|PM)?/i);
            if (timeParts) {
                let hour = parseInt(timeParts[1]);
                const isPM = timeParts[3]?.toUpperCase() === 'PM';
                if (isPM && hour < 12) hour += 12;
                if (!isPM && hour === 12) hour = 0;
                const scheduledTime = new Date(order.deliveryDate);
                scheduledTime.setHours(hour, parseInt(timeParts[2] || 0), 0, 0);
                isPastTime = now.getTime() - scheduledTime.getTime() > 30 * 60 * 1000;
            }
        }

        if (!isDelivered && !isPastTime) {
            return res.status(400).json({ message: 'Dispute can only be raised on delivered orders or 30 minutes past requested time.' });
        }

        if (order.dispute && order.dispute.reason) {
            return res.status(400).json({ message: 'A dispute has already been raised for this order.' });
        }

        order.dispute = {
            reason,
            description: description || '',
            raisedAt: now,
            raisedBy: userId,
            agreedToPolicy: true
        };
        order.status = 'dispute';
        order.disputeMessages.push({
            userId,
            role: 'user',
            message: description || `Dispute raised: ${reason.replace(/_/g, ' ')}`,
            createdAt: now
        });

        await order.save();

        // Notify vendor
        publishEvent(CHANNELS.VENDOR_NOTIFICATIONS(order.vendorId), {
            event: EVENTS.DISPUTE_RAISED,
            orderId: order._id,
            orderNumber: order.orderId,
            reason,
            description
        });
        // Update both parties' order lists
        publishEvent(CHANNELS.VENDOR_NOTIFICATIONS(order.vendorId), {
            event: EVENTS.ORDER_STATUS_UPDATE,
            orderId: order._id,
            status: 'dispute'
        });
        publishEvent(CHANNELS.USER_NOTIFICATIONS(userId), {
            event: EVENTS.ORDER_STATUS_UPDATE,
            orderId: order._id,
            status: 'dispute'
        });

        res.json({ message: 'Dispute raised successfully.', data: order });
    } catch (err) {
        console.error('[Dispute] raiseDispute error:', err);
        res.status(500).json({ message: 'Failed to raise dispute.' });
    }
};

// ── POST /orders/:orderId/dispute/message ────────────────
exports.sendDisputeMessage = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const { orderId } = req.params;
        const { message } = req.body;

        if (!message || !message.trim()) return res.status(400).json({ message: 'Message is required.' });

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found.' });

        const isCustomer = String(order.userId) === String(userId);
        const isVendor = String(order.vendorId) === String(userId);
        if (!isCustomer && !isVendor) {
            return res.status(403).json({ message: 'Not authorized for this order.' });
        }

        const role = isVendor ? 'vendor' : 'user';
        order.disputeMessages.push({ userId, role, message: message.trim(), createdAt: new Date() });
        await order.save();

        // Notify the other party
        const targetChannel = isVendor
            ? CHANNELS.USER_NOTIFICATIONS(order.userId)
            : CHANNELS.VENDOR_NOTIFICATIONS(order.vendorId);

        publishEvent(targetChannel, {
            event: EVENTS.DISPUTE_MESSAGE,
            orderId: order._id,
            orderNumber: order.orderId,
            senderRole: role,
            message: message.trim()
        });

        res.json({ message: 'Message sent.', data: order.disputeMessages });
    } catch (err) {
        console.error('[Dispute] sendDisputeMessage error:', err);
        res.status(500).json({ message: 'Failed to send message.' });
    }
};

// ── GET /orders/:orderId/dispute/messages ────────────────
exports.getDisputeMessages = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const { orderId } = req.params;

        const order = await Order.findById(orderId)
            .select('dispute disputeMessages disputeRefund disputeResolvedAt disputeResolutionNote userId vendorId orderId status')
            .lean();

        if (!order) return res.status(404).json({ message: 'Order not found.' });

        const isCustomer = String(order.userId) === String(userId);
        const isVendor = String(order.vendorId) === String(userId);
        if (!isCustomer && !isVendor) {
            return res.status(403).json({ message: 'Not authorized for this order.' });
        }

        res.json({
            data: {
                dispute: order.dispute,
                messages: (order.disputeMessages || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
                refund: order.disputeRefund,
                resolvedAt: order.disputeResolvedAt,
                resolutionNote: order.disputeResolutionNote,
                status: order.status
            }
        });
    } catch (err) {
        console.error('[Dispute] getDisputeMessages error:', err);
        res.status(500).json({ message: 'Failed to fetch dispute messages.' });
    }
};

// ── POST /orders/:orderId/dispute/refund-offer ───────────
// Vendor offers a refund amount.
exports.offerRefund = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const { orderId } = req.params;
        const { amount } = req.body;

        if (!amount || amount <= 0) return res.status(400).json({ message: 'Valid refund amount is required.' });

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (String(order.vendorId) !== String(userId)) {
            return res.status(403).json({ message: 'Only the vendor can offer a refund.' });
        }
        if (order.status !== 'dispute') {
            return res.status(400).json({ message: 'Order is not in dispute status.' });
        }

        order.disputeRefund = {
            offeredAmount: amount,
            offeredAt: new Date(),
            status: 'pending',
            respondedAt: null,
            escalatedToAdmin: false
        };
        order.disputeMessages.push({
            userId,
            role: 'vendor',
            message: `Refund offered: ₹${amount}`,
            createdAt: new Date()
        });
        await order.save();

        publishEvent(CHANNELS.USER_NOTIFICATIONS(order.userId), {
            event: EVENTS.DISPUTE_REFUND_OFFERED,
            orderId: order._id,
            orderNumber: order.orderId,
            offeredAmount: amount
        });

        res.json({ message: 'Refund offer sent.', data: order });
    } catch (err) {
        console.error('[Dispute] offerRefund error:', err);
        res.status(500).json({ message: 'Failed to offer refund.' });
    }
};

// ── POST /orders/:orderId/dispute/refund-response ────────
// Customer accepts or rejects the refund offer.
exports.respondToRefund = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const { orderId } = req.params;
        const { accepted } = req.body;

        if (typeof accepted !== 'boolean') {
            return res.status(400).json({ message: 'accepted (true/false) is required.' });
        }

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found.' });
        if (String(order.userId) !== String(userId)) {
            return res.status(403).json({ message: 'Only the customer can respond to a refund offer.' });
        }
        if (!order.disputeRefund || order.disputeRefund.status !== 'pending') {
            return res.status(400).json({ message: 'No pending refund offer to respond to.' });
        }

        const now = new Date();
        order.disputeRefund.respondedAt = now;

        if (accepted) {
            order.disputeRefund.status = 'accepted';
            order.refundAmount = order.disputeRefund.offeredAmount;
            order.refundPercentage = Math.round((order.disputeRefund.offeredAmount / order.totalAmount) * 100);
            order.paymentStatus = 'refund_processed';
            order.status = 'resolved';
            order.disputeResolvedAt = now;
            order.disputeResolutionNote = `Dispute resolved. Refund of ₹${order.disputeRefund.offeredAmount} issued.`;
            order.disputeMessages.push({
                userId, role: 'user',
                message: `Refund of ₹${order.disputeRefund.offeredAmount} accepted.`,
                createdAt: now
            });
        } else {
            order.disputeRefund.status = 'rejected';
            order.disputeRefund.escalatedToAdmin = true;
            order.disputeResolutionNote = 'Dispute escalated to site administration.';
            order.disputeMessages.push({
                userId, role: 'user',
                message: 'Refund offer rejected. Escalated to site administration.',
                createdAt: now
            });
        }

        await order.save();

        // Notify vendor
        publishEvent(CHANNELS.VENDOR_NOTIFICATIONS(order.vendorId), {
            event: EVENTS.DISPUTE_REFUND_RESPONSE,
            orderId: order._id,
            orderNumber: order.orderId,
            accepted,
            status: order.status
        });

        // Update both parties
        if (accepted) {
            publishEvent(CHANNELS.USER_NOTIFICATIONS(userId), {
                event: EVENTS.ORDER_STATUS_UPDATE,
                orderId: order._id,
                status: 'resolved'
            });
            publishEvent(CHANNELS.VENDOR_NOTIFICATIONS(order.vendorId), {
                event: EVENTS.ORDER_STATUS_UPDATE,
                orderId: order._id,
                status: 'resolved'
            });
        }

        res.json({ message: accepted ? 'Refund accepted.' : 'Refund rejected. Escalated to admin.', data: order });
    } catch (err) {
        console.error('[Dispute] respondToRefund error:', err);
        res.status(500).json({ message: 'Failed to respond to refund.' });
    }
};
