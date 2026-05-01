/**
 * Idempotency Middleware
 *
 * Prevents duplicate orders caused by:
 *   - Network retries (client sends same request twice)
 *   - Double-tap on "Place Order" button
 *   - Mobile app offline/retry logic
 *
 * Algorithm:
 *   1. Client sends  X-Idempotency-Key: <uuid>  header with every order POST.
 *   2. On first request:
 *        • SET idempotency:{key} = "PROCESSING" (NX, TTL 30 s)
 *        • If SET fails → key already exists → return cached response
 *        • On success, continue to handler; intercept response body
 *        • Store final response as idempotency:{key} = JSON (TTL 24 h)
 *   3. On duplicate request within TTL:
 *        • Return cached response with 200 + X-Idempotency-Replayed: true
 *   4. Falls back to allowing the request through when Redis is unavailable.
 *
 * Usage:
 *   router.post('/', idempotency, orderController.placeOrder);
 */

const redis = require('../utils/redis.client');

const PROCESSING_TTL_SECS = 30;      // lock held while handler runs
const RESULT_TTL_SECS     = 86_400;  // cached response kept 24 h

module.exports = async function idempotency(req, res, next) {
    const key = req.headers['x-idempotency-key'];

    // No key provided — pass through (non-idempotent call)
    if (!key || typeof key !== 'string' || key.trim() === '') {
        return next();
    }

    if (!redis.isReady) {
        // Redis unavailable — fail open (allow request)
        console.warn('[Idempotency] Redis not ready — skipping idempotency check');
        return next();
    }

    const redisKey = `idempotency:${key.trim()}`;

    // ── Check for existing entry ──────────────────────────────────────────────
    const existing = await redis.get(redisKey).catch(() => null);

    if (existing === 'PROCESSING') {
        // Another request with the same key is still in flight
        return res.status(409).json({
            message: 'A request with this idempotency key is already being processed. Please wait.',
            retryAfterMs: 2000,
        });
    }

    if (existing) {
        // Return the cached result of the original successful call
        try {
            const cached = JSON.parse(existing);
            res.setHeader('X-Idempotency-Replayed', 'true');
            return res.status(cached.status).json(cached.body);
        } catch {
            // Corrupted cache entry — fall through and re-process
        }
    }

    // ── First-time request: claim the key ────────────────────────────────────
    const claimed = await redis
        .set(redisKey, 'PROCESSING', 'NX', 'EX', PROCESSING_TTL_SECS)
        .catch(() => null);

    if (!claimed) {
        // Race condition: another process just claimed it
        return res.status(409).json({
            message: 'Duplicate request detected. Please wait a moment before retrying.',
        });
    }

    // ── Intercept the response to cache it ───────────────────────────────────
    const originalJson = res.json.bind(res);
    res.json = async function (body) {
        // Only cache successful responses (2xx)
        if (res.statusCode >= 200 && res.statusCode < 300) {
            const payload = JSON.stringify({ status: res.statusCode, body });
            await redis.set(redisKey, payload, 'EX', RESULT_TTL_SECS).catch(() => {});
        } else {
            // Delete the PROCESSING lock so the client can retry
            await redis.del(redisKey).catch(() => {});
        }
        return originalJson(body);
    };

    next();
};
