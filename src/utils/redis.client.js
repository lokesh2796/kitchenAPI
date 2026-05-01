/**
 * Redis client singleton.
 *
 * Used by: idempotency middleware, slot manager, circuit breakers.
 *
 * Falls back gracefully when Redis is unavailable so that local dev
 * without Redis doesn't crash the server — each consumer checks
 * `client.isReady` before using Redis-dependent features.
 */

const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,          // don't crash on startup if Redis is absent
    retryStrategy: (times) => {
        if (times > 10) return null; // give up after 10 attempts
        return Math.min(times * 200, 3000);
    },
});

client.on('connect',  () => console.log('[Redis] Connected'));
client.on('ready',    () => console.log('[Redis] Ready'));
client.on('error',    (err) => console.error('[Redis] Error:', err.message));
client.on('close',    () => console.warn('[Redis] Connection closed'));
client.on('reconnecting', () => console.log('[Redis] Reconnecting…'));

// Attempt connection at import time; caller continues even if it fails.
client.connect().catch((err) => {
    console.warn('[Redis] Initial connect failed — Redis-dependent features disabled:', err.message);
});

module.exports = client;
