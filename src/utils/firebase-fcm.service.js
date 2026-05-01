const admin = require('firebase-admin');
const Users = require('../models/users.model');

let initialized = false;

const initFirebase = () => {
    if (initialized || admin.apps.length) {
        initialized = true;
        return true;
    }
    const {
        FIREBASE_PROJECT_ID,
        FIREBASE_PRIVATE_KEY_ID,
        FIREBASE_PRIVATE_KEY,
        FIREBASE_CLIENT_EMAIL,
        FIREBASE_CLIENT_ID,
    } = process.env;

    if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
        console.error('[FCM] ❌ Missing Firebase env vars. Set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL in .env / Render dashboard.');
        return false;
    }

    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                type: 'service_account',
                project_id: FIREBASE_PROJECT_ID,
                private_key_id: FIREBASE_PRIVATE_KEY_ID,
                private_key: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                client_email: FIREBASE_CLIENT_EMAIL,
                client_id: FIREBASE_CLIENT_ID,
                auth_uri: 'https://accounts.google.com/o/oauth2/auth',
                token_uri: 'https://oauth2.googleapis.com/token',
            }),
        });
        initialized = true;
        console.log('[FCM] ✅ Firebase Admin SDK initialized. Project:', FIREBASE_PROJECT_ID);
        return true;
    } catch (err) {
        console.error('[FCM] ❌ Firebase init failed:', err.message);
        return false;
    }
};

// Call at server startup so issues surface immediately (not lazily on first push)
initFirebase();

const { SOUND_CONFIG } = require('./notification-templates');

/**
 * Build an FCM message with the correct Android channel and APNS sound
 * based on the logical sound priority ('high' | 'medium' | 'low').
 *
 * @param {string} token    — FCM registration token
 * @param {string} title
 * @param {string} body
 * @param {object} data     — extra key/value pairs (all stringified)
 * @param {string} sound    — 'high' | 'medium' | 'low'  (default: 'medium')
 */
const buildMessage = (token, title, body, data = {}, sound = 'medium') => {
    const sc = SOUND_CONFIG[sound] || SOUND_CONFIG.medium;
    return {
        token,
        notification: { title, body },
        data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        android: {
            priority: sc.android.priority === 'max' || sc.android.priority === 'high' ? 'high' : 'normal',
            notification: {
                channel_id:              sc.android.channelId,
                sound:                   sc.android.sound,
                icon:                    'ic_stat_notify',
                priority:                sc.android.priority,
                visibility:              'public',
                default_vibrate_timings: sc.android.vibration.length === 0,
                vibrate_timings_millis:  sc.android.vibration.length ? sc.android.vibration : undefined,
            },
        },
        apns: {
            payload: {
                aps: {
                    alert: { title, body },
                    sound: sc.apns.sound || undefined,   // null → omit → silent on iOS
                    badge: sc.apns.badge,
                    'content-available': sc.apns.sound ? undefined : 1,
                },
            },
            headers: {
                // Maps to APN priority: high sound → immediate, low/no sound → conserve battery
                'apns-priority': sc.apns.sound ? '10' : '5',
            },
        },
    };
};

const sendToUser = async (userId, title, body, data = {}, sound = 'medium') => {
    if (!initFirebase()) {
        console.error('[FCM] ❌ Cannot send — Firebase not initialized');
        return;
    }
    try {
        const user = await Users.findById(userId).select('fcmToken firstName');
        if (!user) { console.error(`[FCM] ❌ User ${userId} not found in DB`); return; }
        if (!user.fcmToken) {
            console.warn(`[FCM] ⚠️  No fcmToken for user ${userId} (${user.firstName})`);
            return;
        }
        const messageId = await admin.messaging().send(buildMessage(user.fcmToken, title, body, data, sound));
        console.log(`[FCM] ✅ Delivered to user ${userId} (${sound}) — ${messageId}`);
    } catch (err) {
        if (err.code === 'messaging/registration-token-not-registered') {
            await Users.findByIdAndUpdate(userId, { fcmToken: null });
            console.warn(`[FCM] ⚠️  Stale token cleared for user ${userId}`);
        } else {
            console.error(`[FCM] ❌ Failed to send to user ${userId}:`, err.code, err.message);
        }
    }
};

const sendToVendor = async (vendorId, title, body, data = {}, sound = 'medium') => {
    if (!initFirebase()) {
        console.error('[FCM] ❌ Cannot send — Firebase not initialized');
        return;
    }
    try {
        const vendor = await Users.findById(vendorId).select('fcmToken firstName');
        if (!vendor) { console.error(`[FCM] ❌ Vendor ${vendorId} not found in DB`); return; }
        if (!vendor.fcmToken) {
            console.warn(`[FCM] ⚠️  No fcmToken for vendor ${vendorId} (${vendor.firstName})`);
            return;
        }
        const messageId = await admin.messaging().send(buildMessage(vendor.fcmToken, title, body, data, sound));
        console.log(`[FCM] ✅ Delivered to vendor ${vendorId} (${sound}) — ${messageId}`);
    } catch (err) {
        if (err.code === 'messaging/registration-token-not-registered') {
            await Users.findByIdAndUpdate(vendorId, { fcmToken: null });
            console.warn(`[FCM] ⚠️  Stale token cleared for vendor ${vendorId}`);
        } else {
            console.error(`[FCM] ❌ Failed to send to vendor ${vendorId}:`, err.code, err.message);
        }
    }
};

module.exports = { sendToUser, sendToVendor };
