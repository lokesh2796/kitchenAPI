/**
 * Scheduler Worker
 *
 * Handles three jobs:
 *
 * 1. "advance-confirm"  (pre-order scheduler)
 *    Fires `prepBufferMins` before a SCHEDULED order's delivery time.
 *    Moves the order SCHEDULED → CONFIRMED and notifies vendor so they
 *    can begin preparation.  Enqueued by VendorAssignmentService when
 *    a SCHEDULED order is accepted.
 *
 * 2. "daily-scan"  (reliability cron — every 5 minutes)
 *    Scans MongoDB for SCHEDULED orders whose autoConfirmAt has passed
 *    but are still in SCHEDULED state (missed their Bull job due to a
 *    Redis restart, deployment, etc.).  This is the "belt and suspenders"
 *    pass that guarantees eventual consistency even if the primary queue
 *    loses jobs.
 *
 * 3. "day-end-cleanup"  (midnight IST — daily)
 *    Runs at midnight IST. Auto-cancels any 'today' or 'tomorrow' orders
 *    that are still unresolved (placed → out_for_delivery) after their
 *    delivery date has passed, restores stock, notifies customers, and
 *    deletes stale TodayMenu entries from the previous day.
 */

require('dotenv').config();
const Bull  = require('bull');
const connectDB       = require('../config/db');
const { initStatusCache } = require('../utils/statusLookupCache');
const Order           = require('../menu-service/models/order.model');
const TodayMenu       = require('../menu-service/models/todayMenu.model');
const { publishEvent, CHANNELS, EVENTS } = require('../utils/socket');
const { sendToVendor, sendToUser }        = require('../utils/firebase-fcm.service');
const { breakers } = require('../utils/circuit-breaker');

const REDIS_URL    = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const PREP_BUFFER  = parseInt(process.env.PREP_BUFFER_MINS || '30', 10);  // minutes
const SCAN_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes

const schedulerQueue = new Bull('order-scheduler', REDIS_URL, {
    defaultJobOptions: {
        attempts:        3,
        backoff:         { type: 'exponential', delay: 10_000 },
        removeOnComplete: 200,
        removeOnFail:    500,
    },
});

module.exports.schedulerQueue = schedulerQueue;

// ── Enqueue helper (called by VendorAssignmentService on order accepted) ──────

/**
 * Schedule the advance-confirm job for a SCHEDULED order.
 * `scheduledDateTime` is the UTC delivery time stored on the order.
 */
module.exports.enqueueAdvanceConfirm = async (orderId, scheduledDateTime) => {
    const fireAt   = new Date(scheduledDateTime).getTime() - PREP_BUFFER * 60_000;
    const delayMs  = Math.max(0, fireAt - Date.now());

    await schedulerQueue.add(
        'advance-confirm',
        { orderId: String(orderId) },
        {
            delay: delayMs,
            jobId: `adv-${orderId}`,  // deduplication: same order can't be enqueued twice
        }
    );

    console.log(`[Scheduler] advance-confirm enqueued for ${orderId} in ${Math.round(delayMs / 60000)}min`);
};

/**
 * Cancel the advance-confirm job (called when order is cancelled or rescheduled).
 */
module.exports.cancelAdvanceConfirm = async (orderId) => {
    try {
        const job = await schedulerQueue.getJob(`adv-${orderId}`);
        if (job) await job.remove();
    } catch (e) {
        console.warn('[Scheduler] cancelAdvanceConfirm:', e.message);
    }
};


// ── Worker startup ────────────────────────────────────────────────────────────

async function start() {
    await connectDB();
    await initStatusCache();
    console.log('[SchedulerWorker] DB connected');

    // ── Job: advance-confirm ─────────────────────────────────────────────────
    schedulerQueue.process('advance-confirm', 5, async (job) => {
        const { orderId } = job.data;
        await _confirmOrder(orderId, 'advance-confirm job fired');
    });

    // ── Job: daily-scan (reliability) ────────────────────────────────────────
    schedulerQueue.process('daily-scan', 1, async () => {
        await _scanMissedOrders();
    });

    // ── Job: day-end-cleanup (midnight IST) ──────────────────────────────────
    schedulerQueue.process('day-end-cleanup', 1, async () => {
        await _runDayEndCleanup();
        // Re-schedule for the next midnight so the job is self-perpetuating
        await _enqueueDayEndCleanup();
    });

    // ── Recurring scan via setInterval ───────────────────────────────────────
    // Also enqueue as a Bull job so it survives restarts with persistent schedule.
    const _enqueueScan = async () => {
        const existing = await schedulerQueue.getJob('scan-cron').catch(() => null);
        if (!existing) {
            await schedulerQueue.add('daily-scan', {}, {
                jobId: 'scan-cron',
                repeat: { every: SCAN_INTERVAL_MS },
            }).catch(() => {});
        }
    };
    await _enqueueScan();

    // ── Schedule first day-end-cleanup (midnight IST) ─────────────────────────
    await _enqueueDayEndCleanup();

    // ── Queue events ──────────────────────────────────────────────────────────
    schedulerQueue.on('completed', (job) =>
        console.log(`[SchedulerWorker] Job ${job.id} (${job.name}) completed`)
    );
    schedulerQueue.on('failed', (job, err) =>
        console.error(`[SchedulerWorker] Job ${job.id} failed (attempt ${job.attemptsMade}):`, err.message)
    );

    // ── Graceful shutdown ─────────────────────────────────────────────────────
    process.on('SIGTERM', async () => { await schedulerQueue.close(); process.exit(0); });
    process.on('SIGINT',  async () => { await schedulerQueue.close(); process.exit(0); });

    console.log('[SchedulerWorker] Listening for jobs…');
}


// ── Core logic ────────────────────────────────────────────────────────────────

async function _confirmOrder(orderId, reason) {
    const order = await Order.findById(orderId);
    if (!order) {
        console.warn(`[Scheduler] Order ${orderId} not found — skipping`);
        return;
    }

    const current = (order.status || '').toLowerCase();
    if (current !== 'scheduled') {
        console.log(`[Scheduler] Order ${orderId} already in status '${current}' — skip`);
        return;
    }

    order.status = 'confirmed';
    if (!order.statusHistory) order.statusHistory = [];
    order.statusHistory.push({
        status:    'confirmed',
        changedBy: 'system',
        note:      reason,
        changedAt: new Date(),
    });
    await order.save();

    console.log(`[Scheduler] Order ${order.orderId} → CONFIRMED (${reason})`);

    // Notify vendor via Socket.IO + FCM (wrapped in circuit breaker)
    await breakers.fcm.call(
        () => sendToVendor(
            String(order.vendorId),
            '🍳 Time to Prepare!',
            `Order #${order.orderId} needs to be ready soon. Start preparing now.`,
            { orderId: String(order._id), type: 'PREPARE_NOW' }
        ),
        (err) => console.warn('[Scheduler] FCM fallback (vendor):', err.message)
    );

    publishEvent(CHANNELS.PUBLIC_UPDATES, {
        event:      EVENTS.ORDER_STATUS_UPDATE,
        vendorRoom: `vendor-${order.vendorId}`,
        orderId:    order.orderId,
        status:     'confirmed',
    });

    // Notify user
    await breakers.fcm.call(
        () => sendToUser(
            String(order.userId),
            '✅ Your Order is Confirmed!',
            `Order #${order.orderId} is being prepared by the kitchen.`,
            { orderId: String(order._id), type: 'ORDER_STATUS_UPDATE' }
        ),
        (err) => console.warn('[Scheduler] FCM fallback (user):', err.message)
    );
}

async function _scanMissedOrders() {
    const now = new Date();
    // Find any SCHEDULED orders whose autoConfirmAt has passed
    const missed = await Order.find({
        assignmentStatus: 'accepted',
        status: 'scheduled',
        // autoConfirmAt is stored in UTC; compare directly
        $or: [
            { autoConfirmAt: { $lte: now } },
            // Also catch orders where scheduled delivery is now within prep buffer
            // and autoConfirmAt was never set (legacy orders)
            { autoConfirmAt: null, scheduledDateTime: { $lte: new Date(now.getTime() + PREP_BUFFER * 60_000) } },
        ],
    }).lean();

    if (missed.length > 0) {
        console.log(`[Scheduler] Scan found ${missed.length} missed advance-confirm order(s)`);
    }

    for (const o of missed) {
        await _confirmOrder(String(o._id), 'reliability scan — missed advance-confirm job');
    }
}


// ── Day-end cleanup ───────────────────────────────────────────────────────────

/**
 * Enqueue the day-end-cleanup job to fire at the next midnight IST (UTC+5:30).
 * Uses a deterministic jobId keyed to the target date so duplicate enqueues
 * (e.g. on worker restart) are safely deduplicated by Bull.
 */
async function _enqueueDayEndCleanup() {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +5:30 in ms
    const nowUtc = Date.now();
    const istNow = new Date(nowUtc + IST_OFFSET_MS);

    // Next midnight in IST calendar = start of (istNow.date + 1)
    const nextMidnightIST = new Date(Date.UTC(
        istNow.getUTCFullYear(),
        istNow.getUTCMonth(),
        istNow.getUTCDate() + 1,
        0, 0, 0, 0
    ));
    // Convert back to UTC wall-clock: subtract IST offset
    const fireAtUtc = nextMidnightIST.getTime() - IST_OFFSET_MS;
    const delayMs   = Math.max(0, fireAtUtc - nowUtc);

    const dateLabel = nextMidnightIST.toISOString().slice(0, 10); // e.g. "2026-04-29"
    const jobId     = `day-end-cleanup-${dateLabel}`;

    const existing = await schedulerQueue.getJob(jobId).catch(() => null);
    if (!existing) {
        await schedulerQueue.add('day-end-cleanup', { date: dateLabel }, {
            jobId,
            delay: delayMs,
            attempts: 3,
            backoff: { type: 'fixed', delay: 60_000 }, // retry after 1 min
        });
        console.log(`[DayEndCleanup] Scheduled for ${dateLabel} IST midnight (in ${Math.round(delayMs / 60000)} min)`);
    }
}

/**
 * Auto-cancel any unresolved 'today' or 'tomorrow' orders whose deliveryDate
 * has already passed (IST), restore their stock, notify customers, and delete
 * stale TodayMenu entries for the same date.
 *
 * "Unresolved" = any non-terminal status: placed, confirmed, preparing,
 * ready, out_for_delivery (both canonical names and stored shorthands).
 */
async function _runDayEndCleanup() {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowUtc    = Date.now();
    const istNow    = new Date(nowUtc + IST_OFFSET_MS);

    // "Today" in IST = the date we just crossed midnight from
    // All deliveryDates strictly before start-of-today-IST are expired
    const todayStartIst = new Date(Date.UTC(
        istNow.getUTCFullYear(),
        istNow.getUTCMonth(),
        istNow.getUTCDate(),
        0, 0, 0, 0
    ));
    const expiredBefore = new Date(todayStartIst.getTime() - IST_OFFSET_MS); // UTC cutoff

    console.log(`[DayEndCleanup] Running — expiring orders with deliveryDate < ${expiredBefore.toISOString()}`);

    // Both canonical names and stored shorthands (in case getter is unavailable)
    const UNRESOLVED_STATUSES = ['placed', 'p', 'confirmed', 'c', 'preparing', 'pr', 'ready', 'r', 'out_for_delivery', 'od'];

    const staleOrders = await Order.find({
        category:     { $in: ['today', 'tomorrow'] },
        deliveryDate: { $lt: expiredBefore },
        status:       { $in: UNRESOLVED_STATUSES },
    });

    console.log(`[DayEndCleanup] Found ${staleOrders.length} unresolved order(s) to auto-cancel`);

    for (const order of staleOrders) {
        try {
            // Restore stock for each item
            for (const item of order.items) {
                if (!item.dailyMenuId) continue;
                await TodayMenu.updateOne(
                    { _id: item.dailyMenuId },
                    { $inc: { soldQty: -item.qty, balanceQty: item.qty } }
                );
            }

            order.status      = 'cancelled';
            order.cancelledBy = 'system';
            order.cancelReason = 'Order not fulfilled by end of day — auto-cancelled.';
            if (!order.statusHistory) order.statusHistory = [];
            order.statusHistory.push({
                status:    'cancelled',
                changedBy: 'system',
                note:      'Day-end auto-cancel',
                changedAt: new Date(),
            });
            await order.save();

            // Notify the customer
            publishEvent(CHANNELS.USER_NOTIFICATIONS(order.userId), {
                event:   EVENTS.ORDER_STATUS_UPDATE,
                orderId: order.orderId,
                status:  'cancelled',
                order:   order.toJSON(),
            });

            await breakers.fcm.call(
                () => sendToUser(
                    String(order.userId),
                    'Order Cancelled',
                    `Order #${order.orderId} was auto-cancelled as it wasn't fulfilled by end of day.`,
                    { orderId: String(order._id), type: 'ORDER_STATUS_UPDATE' }
                ),
                (err) => console.warn('[DayEndCleanup] FCM fallback:', err.message)
            );

            console.log(`[DayEndCleanup] Auto-cancelled order ${order.orderId}`);
        } catch (err) {
            console.error(`[DayEndCleanup] Failed to cancel order ${order.orderId}:`, err.message);
        }
    }

    // Delete stale TodayMenu entries for expired dates
    const menuResult = await TodayMenu.deleteMany({ menuDate: { $lt: expiredBefore } });
    console.log(`[DayEndCleanup] Deleted ${menuResult.deletedCount} stale TodayMenu entries`);
}


// ── Entry point ───────────────────────────────────────────────────────────────
if (require.main === module) {
    start().catch((err) => {
        console.error('[SchedulerWorker] Fatal startup error:', err);
        process.exit(1);
    });
}
