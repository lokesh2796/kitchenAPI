const Order = require('../models/order.model');
const { generateOrderId, generateOTP, calculateSettlementDate } = require('../../utils/order-utils');

/**
 * Place a new order using cart details.
 * Initializes status history and payment settling logic.
 */
exports.placeOrder = async (req, res) => {
    try {
        const {
            customerId, vendorId, deliveryDate, preferredTime, items,
            orderType, deliveryMode, vendorAddress, deliveryAddress,
            deliveryPolicy, cancelPolicy, orderTotal
        } = req.body;

        if (!customerId || !vendorId || !items || !items.length) {
            return res.status(400).json({ message: 'Missing core order details' });
        }

        // Validate deliveryDate and preferredTime for future orders
        if (!deliveryDate) {
            return res.status(400).json({ message: 'Delivery date is required' });
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const deliveryDateStr = new Date(deliveryDate).toISOString().split('T')[0];

        if (deliveryDateStr > todayStr && !preferredTime) {
            return res.status(400).json({ message: 'Preferred delivery time is required for tomorrow/pre-orders' });
        }

        // 1. Generate HM-prefixed ID
        const orderId = generateOrderId();

        // 1.1 Generate OTP (4-digit)
        const otp = generateOTP();

        // 2. Initial Status
        const initialStatus = {
            name: 'Order Placed',
            customerDisplay: 'Your order has been successfully placed!',
            vendorDisplay: 'New order incoming!',
            modifiedDate: new Date()
        };

        const initialHistory = [{
            name: 'Order Placed',
            userId: customerId,
            timeStamp: new Date()
        }];

        // 3. Settlement Logic (Next Saturday)
        const settlementDate = calculateSettlementDate(new Date());

        const newOrder = new Order({
            orderId,
            customerId,
            vendorId,
            deliveryDate,
            preferredTime,
            items,
            orderType,
            deliveryMode,
            vendorAddress,
            deliveryAddress,
            deliveryPolicy,
            cancelPolicy,
            orderTotal,
            vendorPayment: {
                paymentDate: settlementDate,
                paymentAmt: orderTotal, // initial amt, subject to adjustments
                paymentStatus: 'pending'
            },
            orderStatus: initialStatus,
            otp,
            statusHistory: initialHistory
        });

        const savedOrder = await newOrder.save();

        return res.status(201).json({
            message: 'Order created successfully!',
            data: savedOrder
        });

    } catch (err) {
        console.error('placeOrder Error:', err);
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};

/**
 * Update order status with detailed history tracking.
 */
exports.updateStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { statusName, customerMsg, vendorMsg, userId } = req.body;

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        // Update current status
        order.orderStatus = {
            name: statusName,
            customerDisplay: customerMsg,
            vendorDisplay: vendorMsg,
            modifiedDate: new Date()
        };

        // Append to history
        order.statusHistory.push({
            name: statusName,
            userId,
            timeStamp: new Date()
        });

        // Specific Logic for Delivered
        if (statusName.toLowerCase().includes('delivered')) {
            order.vendorPayment.orderCompletedDate = new Date();
        }

        await order.save();
        return res.status(200).json({ message: 'Order status updated', data: order });

    } catch (err) {
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};

/**
 * Get orders for a customer.
 */
exports.getCustomerOrders = async (req, res) => {
    try {
        const { customerId } = req.params;
        const orders = await Order.find({ customerId }).sort({ createdDate: -1 });
        return res.status(200).json({ data: orders });
    } catch (err) {
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};

/**
 * Get orders for a vendor.
 */
exports.getVendorOrders = async (req, res) => {
    try {
        const { vendorId } = req.params;
        const orders = await Order.find({ vendorId }).sort({ createdDate: -1 });
        return res.status(200).json({ data: orders });
    } catch (err) {
        return res.status(500).json({ message: 'Internal server error', error: err.message });
    }
};
