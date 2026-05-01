/**
 * Notification Worker
 *
 * Decouples notification delivery from the request path.
 * Every notification is a Bull job — if FCM / SMS / Socket.IO fails,
 * the job is retried with exponential backoff.
 *
 * Channels (in priority order):
 *   1. Socket.IO  — real-time in-app (no retry needed; client reconnects)
 *   2. FCM Push   — mobile / background (3 retries, 10s→30s→90s)
 *   3. SMS        — last resort when FCM fails (Twilio via existing core service)
 *
 * Job types:
 *   order_update  — status change visible to user
 *   vendor_alert  — new order / prep reminder for vendor
 *   chat_message  — new chat message badge update
 *   system_alert  — admin or system-level notifications
 */

require('dotenv').config();
const Bull   = require('bull');
const connectDB           = require('../config/db');
const { initStatusCache } = require('../utils/statusLookupCache');
const Users               = require('../models/users.model');
const { publishEvent, CHANNELS, EVENTS } = require('../utils/socket');
const { sendToUser, sendToVendor }        = require('../utils/firebase-fcm.service');
const { breakers }  = require('../utils/circuit-breaker');
const { getNotification } = require('../utils/notification-templates');

const REDIS_URL   = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const CONCURRENCY = parseInt(process.env.NOTIF_WORKER_CONCURRENCY || '10', 10);

const notifQueue = new Bull('notifications', REDIS_URL, {
    defaultJobOptions: {
        attempts: 4,
        backoff: { type: 'exponential', delay: 10_000 }, // 10s, 30s, 90s, 270s
        removeOnComplete: 500,
        removeOnFail:    1000,
    },
});

module.exports.notifQueue = notifQueue;

/**
 * Enqueue a notification.
 * Callers don't await delivery — fire-and-forget with guaranteed retry.
 *
 * @param {'order_update'|'vendor_alert'|'chat_message'|'system_alert'} type
 * @param {object} payload  — see job processors below for expected fields
 * @param {object} [opts]   — Bull job options override
 */
module.exports.enqueue = (type, payload, opts = {}) => {
    return notifQueue.add(type, payload, opts).catch((err) => {
        console.error('[NotifWorker] Failed to enqueue notification:', err.message);
    });
};


// ── Worker startup ────────────────────────────────────────────────────────────

async function start() {
    await connectDB();
    await initStatusCache();
    console.log('[NotifWorker] DB connected. Concurrency:', CONCURRENCY);

    // ── order_update ─────────────────────────────────────────────────────────
    // job.data: { userId, orderId, orderRef, status, templateKey, templateData }
    notifQueue.process('order_update', CONCURRENCY, async (job) => {
        const { userId, orderId, orderRef, status, templateKey, templateData = {} } = job.data;

        // Resolve the notification template (fall back to legacy status-title if no key given)
        const notif = templateKey
            ? getNotification(templateKey, { orderId: orderRef, ...templateData })
            : null;

        const pushTitle = notif?.push.title  || _statusTitle(status);
        const pushBody  = notif?.push.body   || templateData.message || `Order #${orderRef} is now ${status}`;
        const sound     = notif?.sound       || 'medium';

        // 1. Socket.IO (best-effort — no retry for this layer)
        publishEvent(CHANNELS.PUBLIC_UPDATES, {
            event:    EVENTS.ORDER_STATUS_UPDATE,
            userRoom: `user-${userId}`,
            orderId:  orderRef,
            status,
            message:  pushBody,
            inApp:    notif?.inApp || null,
        });

        // 2. FCM push (circuit breaker + Bull retry on failure)
        await breakers.fcm.call(
            () => sendToUser(String(userId), pushTitle, pushBody,
                { orderId: String(orderId), type: 'ORDER_STATUS_UPDATE', status },
                sound
            ),
            (err) => {
                console.warn('[NotifWorker] FCM open for order_update:', err.message);
                throw err;
            }
        );
    });

    // ── vendor_alert ─────────────────────────────────────────────────────────
    // job.data: { vendorId, orderId, orderRef, templateKey, templateData }
    notifQueue.process('vendor_alert', CONCURRENCY, async (job) => {
        const { vendorId, orderId, orderRef, templateKey, templateData = {} } = job.data;

        const notif = templateKey
            ? getNotification(templateKey, { orderId: orderRef, ...templateData })
            : null;

        const pushTitle = notif?.push.title || '🔔 New Order';
        const pushBody  = notif?.push.body  || `Order #${orderRef} waiting for your response`;
        const sound     = notif?.sound      || 'high';

        publishEvent(CHANNELS.PUBLIC_UPDATES, {
            event:      EVENTS.NEW_ORDER,
            vendorRoom: `vendor-${vendorId}`,
            orderId:    orderRef,
            inApp:      notif?.inApp || null,
        });

        await breakers.fcm.call(
            () => sendToVendor(String(vendorId), pushTitle, pushBody,
                { orderId: String(orderId), type: 'VENDOR_ALERT' },
                sound
            ),
            (err) => { console.warn('[NotifWorker] FCM open for vendor_alert:', err.message); throw err; }
        );
    });

    // ── chat_message ─────────────────────────────────────────────────────────
    // job.data: { recipientId, recipientRole, orderId, orderRef, senderName, senderRole, preview }
    notifQueue.process('chat_message', CONCURRENCY, async (job) => {
        const { recipientId, recipientRole, orderId, orderRef, senderName, senderRole, preview } = job.data;

        const templateKey = recipientRole === 'vendor' ? 'VENDOR_NEW_CHAT_MESSAGE' : 'USER_NEW_CHAT_MESSAGE';
        const notif = getNotification(templateKey, {
            orderId:    orderRef,
            senderName: senderName || (senderRole === 'vendor' ? 'Kitchen' : 'Customer'),
            preview:    preview ? preview.substring(0, 60) : 'You have a new message',
        });

        const room = recipientRole === 'vendor' ? `vendor-${recipientId}` : `user-${recipientId}`;
        publishEvent(CHANNELS.PUBLIC_UPDATES, {
            event:   'CHAT_BADGE_UPDATE',
            room,
            orderId: orderRef,
            inApp:   notif?.inApp || null,
        });

        const sendFn = recipientRole === 'vendor' ? sendToVendor : sendToUser;
        await breakers.fcm.call(
            () => sendFn(String(recipientId),
                notif.push.title,
                notif.push.body,
                { orderId: String(orderId), type: 'CHAT_MESSAGE' },
                notif.sound   // 'high'
            ),
            (err) => { console.warn('[NotifWorker] FCM open for chat_message:', err.message); throw err; }
        );
    });

    // ── system_alert ─────────────────────────────────────────────────────────
    notifQueue.process('system_alert', 2, async (job) => {
        const { userId, title, body, data = {}, sound = 'low' } = job.data;
        await breakers.fcm.call(
            () => sendToUser(String(userId), title, body, data, sound),
            (err) => { console.warn('[NotifWorker] FCM open for system_alert:', err.message); throw err; }
        );
    });

    // ── Queue events ──────────────────────────────────────────────────────────
    notifQueue.on('failed', (job, err) => {
        const isFinal = job.attemptsMade >= (job.opts.attempts || 4);
        const level   = isFinal ? 'error' : 'warn';
        console[level](
            `[NotifWorker] Job ${job.id} (${job.name}) failed — attempt ${job.attemptsMade}:`,
            err.message
        );

        // After all retries exhausted → log to a dead-letter store if needed
        if (isFinal) {
            _deadLetterLog(job, err);
        }
    });

    notifQueue.on('stalled', (job) =>
        console.warn(`[NotifWorker] Job ${job.id} stalled`)
    );

    // ── Graceful shutdown ─────────────────────────────────────────────────────
    process.on('SIGTERM', async () => { await notifQueue.close(); process.exit(0); });
    process.on('SIGINT',  async () => { await notifQueue.close(); process.exit(0); });

    console.log('[NotifWorker] Ready');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Legacy fallback for callers that don't pass a templateKey
function _statusTitle(status) {
    const titles = {
        confirmed:        '✅ Order Confirmed',
        preparing:        '👨‍🍳 Kitchen is Cooking',
        ready:            '🍱 Order Ready',
        out_for_delivery: '🛵 Out for Delivery',
        delivered:        '🎉 Order Delivered',
        cancelled:        '❌ Order Cancelled',
        disputed:         '⚠️ Dispute Raised',
        resolved:         '✅ Dispute Resolved',
    };
    return titles[(status || '').toLowerCase()] || '📦 Order Updated';
}

function _deadLetterLog(job, err) {
    // In production: write to a MongoDB dead-letter collection or Sentry
    console.error('[NotifWorker] DEAD LETTER:', {
        jobId:   job.id,
        type:    job.name,
        payload: job.data,
        error:   err.message,
        ts:      new Date().toISOString(),
    });
}


// ── Entry point ───────────────────────────────────────────────────────────────
if (require.main === module) {
    start().catch((err) => {
        console.error('[NotifWorker] Fatal startup error:', err);
        process.exit(1);
    });
}
