const jwt = require('jsonwebtoken');
const Order = require('../menu-service/models/order.model');
const Users = require('../models/users.model');
const { calculateDistance } = require('./order-utils');

let ioInstance;

const initSocketOptions = (io) => {
    ioInstance = io;

    // ── Handshake Middleware (JWT Authentication) ────────
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
        if (token) {
            try {
                const secret = process.env.JWT_SECRET || 'default_jwt_secret_key_change_me';
                const decoded = jwt.verify(token, secret);
                socket.decoded = decoded;
                console.log(`[Socket.IO Auth] Verified token for ${socket.id} (User: ${decoded.id || decoded._id})`);
            } catch (err) {
                console.warn(`[Socket.IO Auth] Token verification failed for ${socket.id}:`, err.message);
            }
        }
        next();
    });

    io.on('connection', async (socket) => {
        console.log(`[Socket.IO] New connection from ${socket.id} (Total: ${io.engine.clientsCount})`);

        // Automatically join rooms based on decoded JWT.
        // CRITICAL: Vendor-room membership is decided by the live DB record
        // (`user.isVendor`), NOT by the JWT `role` claim. JWTs become stale
        // when a user upgrades from buyer-only to also-vendor without
        // re-issuing a token, and a stale `role: USER` JWT used to silently
        // skip the `vendor-${id}` join — meaning NEW_ORDER events broadcast
        // to that room hit an empty room and the vendor never got a heads-up.
        if (socket.decoded) {
            const userId = socket.decoded.id || socket.decoded._id;
            const jwtRole = (socket.decoded.role || '').toUpperCase();

            // Personal Notification Room (always)
            socket.join(`user-${userId}`);

            // Vendor Notification Room — check DB for the source of truth.
            let isVendor = jwtRole === 'VENDOR';
            try {
                const user = await Users.findById(userId).select('isVendor activeRole').lean();
                if (user && user.isVendor) {
                    isVendor = true;
                }
            } catch (e) {
                console.warn(`[Socket.IO] DB lookup for vendor flag failed:`, e.message);
            }

            if (isVendor) {
                socket.join(`vendor-${userId}`);
            }
            console.log(`[Socket.IO] Auto-joined rooms for ${socket.id}: user-${userId}${isVendor ? ' vendor-' + userId : ''}`);
        }

        socket.on('join', (room) => {
            if (!room) return;
            socket.join(room);
            console.log(`[Socket.IO] Client ${socket.id} manually joined room: ${room}`);
        });

        // Mirroring the backend-queries PubNub zero-API functionality
        socket.on('FETCH_VENDOR_ORDERS', async (payload) => {
            console.log(`[Socket.IO] Received FETCH_VENDOR_ORDERS from ${socket.id}`);
            if (payload && payload.token) {
                try {
                    // 1. Authenticate over Socket
                    const secret = process.env.JWT_SECRET || 'default_jwt_secret_key_change_me';
                    const decoded = jwt.verify(payload.token, secret);
                    const vendorId = decoded.id || decoded._id; // Defensive check for both styles
                    
                    if (!vendorId) {
                        console.error(`[Socket.IO] FEC_VENDOR_ORDERS Failed: No ID in token payload:`, decoded);
                        return;
                    }
                    console.log(`[Socket.IO] Verified Vendor: ${vendorId} for socket ${socket.id}`);

                    // 2. Fetch data (Mirroring getVendorOrders REST API)
                    const orders = await Order.find({ vendorId })
                        .populate('userId', 'firstName lastName phone profilePicture')
                        .sort({ createdAt: -1 })
                        .limit(100)
                        .lean();
                    
                    console.log(`[Socket.IO] Found ${orders.length} orders for vendor ${vendorId}`);

                    const data = orders.map(o => ({
                        ...o,
                        distance: calculateDistance(
                            o.vendorAddress?.lat, o.vendorAddress?.long,
                            o.deliveryAddress?.lat, o.deliveryAddress?.long
                        )
                    }));

                    // 3. Dispatch data back to the REQUESTING socket directly.
                    // This avoids race conditions where the socket hasn't fully joined the room yet.
                    socket.emit('INITIAL_ORDERS_SYNC', {
                        event: 'INITIAL_ORDERS_SYNC',
                        orders: data
                    });
                    
                    console.log(`[Socket.IO API-Free Engine] Sync success: Sent ${data.length} orders to vendor-${vendorId}`);
                } catch (err) {
                    console.error('[Socket.IO API-Free Engine] Failed to sync orders:', err.message);
                }
            }
        });

        socket.on('disconnect', () => {
            console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
        });
    });
};

const publishEvent = async (channel, message) => {
    if (!ioInstance) {
        console.error(`[Socket.IO ERROR] publishEvent for ${message.event} failed: ioInstance not initialized.`);
        return;
    }
    
    try {
        const room = ioInstance.sockets.adapter.rooms.get(channel);
        const memberCount = room ? room.size : 0;
        
        console.log(`[Socket.IO BROADCAST] Room: ${channel} | Event: ${message.event} | Data: ${JSON.stringify(message).substring(0, 100)}...`);
        console.log(`[Socket.IO BROADCAST] Members in ${channel}: ${memberCount}`);

        if (memberCount === 0) {
            console.warn(`[Socket.IO WARNING] Broadcasting ${message.event} to EMPTY room: ${channel}. Client may not have joined yet.`);
        }

        ioInstance.to(channel).emit(message.event, message);
    } catch (error) {
        console.error(`[Socket.IO ERROR] Broadcast failed to ${channel}:`, error);
    }
};

module.exports = {
    init: initSocketOptions,
    publishEvent,
    CHANNELS: {
        PUBLIC_UPDATES: 'public-updates',
        USER_NOTIFICATIONS: (userId) => `user-${userId}`,
        VENDOR_NOTIFICATIONS: (vendorId) => `vendor-${vendorId}`
    },
    EVENTS: {
        ITEM_QTY_UPDATE: 'ITEM_QTY_UPDATE',
        ORDER_STATUS_UPDATE: 'ORDER_STATUS_UPDATE',
        NEW_ORDER: 'NEW_ORDER',
        DISPUTE_RAISED: 'DISPUTE_RAISED',
        DISPUTE_MESSAGE: 'DISPUTE_MESSAGE',
        DISPUTE_REFUND_OFFERED: 'DISPUTE_REFUND_OFFERED',
        DISPUTE_REFUND_RESPONSE: 'DISPUTE_REFUND_RESPONSE',
        DISPUTE_RESOLVED: 'DISPUTE_RESOLVED'
    }
};
