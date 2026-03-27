const PubNub = require('pubnub');
const jwt = require('jsonwebtoken');
const Order = require('../menu-service/models/order.model');
const { calculateDistance } = require('./order-utils');

const pubnub = new PubNub({
    publishKey: process.env.PUBNUB_PUBLISH_KEY || 'pub-c-your-publish-key',
    subscribeKey: process.env.PUBNUB_SUBSCRIBE_KEY || 'sub-c-your-subscribe-key',
    userId: process.env.PUBNUB_USER_ID || 'backend-service'
});

/**
 * Publishes an event to a specific channel.
 * @param {string} channel - The channel name (e.g., 'public-updates', 'user-123')
 * @param {object} message - The payload to send
 */
const publishEvent = async (channel, message) => {
    try {
        console.log(`[PubNub] Publishing to ${channel}:`, JSON.stringify(message));
        await pubnub.publish({
            channel: channel,
            message: message
        });
    } catch (error) {
        console.error(`[PubNub] Publish failed to ${channel}:`, error);
    }
};

/**
 * Initializes a backend-side listener for frontend queries (Zero-API architecture)
 */
const initPubNubListener = () => {
    pubnub.subscribe({ channels: ['backend-queries'] });
    console.log('[PubNub API-Free Engine] Subscribed to backend-queries channel.');

    pubnub.addListener({
        message: async (m) => {
            const payload = m.message;
            if (payload && payload.event === 'FETCH_VENDOR_ORDERS' && payload.token) {
                try {
                    // 1. Authenticate over Socket
                    const decoded = jwt.verify(payload.token, process.env.JWT_SECRET || 'default_jwt_secret_key_change_me');
                    const vendorId = decoded.id; 

                    // 2. Fetch data (Mirroring getVendorOrders REST API)
                    const orders = await Order.find({ vendorId })
                        .populate('userId', 'firstName lastName phone profilePicture')
                        .sort({ createdAt: -1 });

                    const data = orders.map(o => {
                        const order = o.toJSON(); // Critical to hit status string getters
                        order.distance = calculateDistance(
                            o.vendorAddress?.lat, o.vendorAddress?.long,
                            o.deliveryAddress?.lat, o.deliveryAddress?.long
                        );
                        return order;
                    });

                    // 3. Dispatch data back to client socket
                    await publishEvent(`vendor-${vendorId}`, {
                        event: 'INITIAL_ORDERS_SYNC',
                        orders: data
                    });
                    
                    console.log(`[PubNub API-Free Engine] Sync success: Sent ${data.length} orders to vendor-${vendorId}`);
                } catch (err) {
                    console.error('[PubNub API-Free Engine] Failed to sync orders:', err.message);
                }
            }
        }
    });
};

module.exports = {
    publishEvent,
    initPubNubListener,
    CHANNELS: {
        PUBLIC_UPDATES: 'public-updates',
        USER_NOTIFICATIONS: (userId) => `user-${userId}`,
        VENDOR_NOTIFICATIONS: (vendorId) => `vendor-${vendorId}`
    },
    EVENTS: {
        ITEM_QTY_UPDATE: 'ITEM_QTY_UPDATE',
        ORDER_STATUS_UPDATE: 'ORDER_STATUS_UPDATE',
        NEW_ORDER: 'NEW_ORDER'
    }
};
