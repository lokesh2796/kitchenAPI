const PushNotifications = require('@pusher/push-notifications-server');

let beamsClient = null;

const getBeamsClient = () => {
    if (!beamsClient) {
        if (!process.env.PUSHER_BEAMS_INSTANCE_ID || !process.env.PUSHER_BEAMS_SECRET_KEY) {
            console.warn('[Beams] Missing env vars — skipping Beams init. Set PUSHER_BEAMS_INSTANCE_ID, PUSHER_BEAMS_SECRET_KEY in .env');
            return null;
        }
        beamsClient = new PushNotifications({
            instanceId: process.env.PUSHER_BEAMS_INSTANCE_ID,
            secretKey: process.env.PUSHER_BEAMS_SECRET_KEY,
        });
    }
    return beamsClient;
};

const buildPayload = (title, body, data) => ({
    apns: {
        aps: { alert: { title, body }, sound: 'notification.wav', badge: 1 },
        data,
    },
    fcm: {
        notification: { title, body },
        data,
        android: {
            notification: {
                channel_id: 'order_notifications',
                sound: 'notification',
                icon: 'notification_icon',
            },
        },
    },
});

const notifyVendor = async (vendorId, title, body, data = {}) => {
    const client = getBeamsClient();
    if (!client) return;
    try {
        await client.publishToInterests([`vendor-${vendorId}`], buildPayload(title, body, data));
        console.log(`[Beams] Notified vendor-${vendorId}: "${title}"`);
    } catch (err) {
        console.error(`[Beams] Failed to notify vendor-${vendorId}:`, err.message);
    }
};

const notifyUser = async (userId, title, body, data = {}) => {
    const client = getBeamsClient();
    if (!client) return;
    try {
        await client.publishToInterests([`user-${userId}`], buildPayload(title, body, data));
        console.log(`[Beams] Notified user-${userId}: "${title}"`);
    } catch (err) {
        console.error(`[Beams] Failed to notify user-${userId}:`, err.message);
    }
};

const generateToken = (userId) => {
    const client = getBeamsClient();
    if (!client) return null;
    return client.generateToken(userId);
};

module.exports = { notifyVendor, notifyUser, generateToken };
