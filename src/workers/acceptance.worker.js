/**
 * Acceptance Worker
 *
 * Runs as a child process (spawned from server.js via cluster.fork or
 * a separate `node src/workers/acceptance.worker.js` command).
 *
 * Attaches a processor to the "vendor-acceptance" BullJS queue.
 * When the delayed "timeout" job fires, it calls handleTimeout()
 * on the assignment service — which either reassigns or cancels.
 */

require('dotenv').config();
const connectDB   = require('../config/db');
const { initStatusCache } = require('../utils/statusLookupCache');
const { acceptanceQueue, handleTimeout } = require('../services/vendorAssignment.service');

const CONCURRENCY = parseInt(process.env.ASSIGNMENT_WORKER_CONCURRENCY || '5', 10);

async function start() {
    await connectDB();
    await initStatusCache();

    console.log(`[AcceptanceWorker] Connected to DB. Processing queue with concurrency=${CONCURRENCY}`);

    // ── Process timeout jobs ──────────────────────────────────────────────
    acceptanceQueue.process('timeout', CONCURRENCY, async (job) => {
        const { orderId } = job.data;
        console.log(`[AcceptanceWorker] Timeout fired for order ${orderId}`);

        try {
            await handleTimeout(orderId);
        } catch (err) {
            console.error(`[AcceptanceWorker] handleTimeout error for ${orderId}:`, err.message);
            // Don't rethrow — BullJS will mark job as failed and we don't want infinite retries
        }
    });

    // ── Queue-level event hooks ───────────────────────────────────────────
    acceptanceQueue.on('completed', (job) => {
        console.log(`[AcceptanceWorker] Job ${job.id} completed`);
    });

    acceptanceQueue.on('failed', (job, err) => {
        console.error(`[AcceptanceWorker] Job ${job.id} failed:`, err.message);
    });

    acceptanceQueue.on('stalled', (job) => {
        console.warn(`[AcceptanceWorker] Job ${job.id} stalled — will retry`);
    });

    // ── Graceful shutdown ─────────────────────────────────────────────────
    const shutdown = async (signal) => {
        console.log(`[AcceptanceWorker] ${signal} received — draining queue…`);
        await acceptanceQueue.close();
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch((err) => {
    console.error('[AcceptanceWorker] Fatal startup error:', err);
    process.exit(1);
});
