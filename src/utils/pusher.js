const Pusher = require('pusher');

let pusherInstance = null;

const getPusher = () => {
    if (!pusherInstance) {
        if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET) {
            console.warn('[Pusher] Missing env vars — skipping Pusher init. Set PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER in .env');
            return null;
        }
        pusherInstance = new Pusher({
            appId: process.env.PUSHER_APP_ID,
            key: process.env.PUSHER_KEY,
            secret: process.env.PUSHER_SECRET,
            cluster: process.env.PUSHER_CLUSTER || 'ap2',
            useTLS: true
        });
        console.log('[Pusher] Initialized successfully.');
    }
    return pusherInstance;
};

// channel: e.g. 'vendor-abc123' or 'user-abc123'
// event:   e.g. 'new-order' or 'status-update'
// data:    plain object
const triggerEvent = async (channel, event, data) => {
    const pusher = getPusher();
    if (!pusher) return;
    try {
        await pusher.trigger(channel, event, data);
        console.log(`[Pusher] Triggered '${event}' on '${channel}'`);
    } catch (err) {
        console.error(`[Pusher] Failed to trigger '${event}' on '${channel}':`, err.message);
    }
};

const PUSHER_CHANNELS = {
    VENDOR: (vendorId) => `private-vendor-${vendorId}`,
    USER:   (userId)   => `private-user-${userId}`
};

const PUSHER_EVENTS = {
    NEW_ORDER:     'new-order',
    STATUS_UPDATE: 'status-update'
};

module.exports = { triggerEvent, PUSHER_CHANNELS, PUSHER_EVENTS };
