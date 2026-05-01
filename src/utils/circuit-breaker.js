/**
 * CircuitBreaker
 *
 * Prevents cascading failures when external services (FCM, payment gateway,
 * Twilio SMS) become slow or unavailable.
 *
 * States:
 *   CLOSED   → normal operation; failures are counted
 *   OPEN     → service considered down; calls fail immediately (fast-fail)
 *   HALF_OPEN → probe: one trial call allowed; success → CLOSED, fail → OPEN
 *
 * Persisted in-memory per process.  For multi-process deployments, promote
 * `state` storage to Redis so all workers share the same circuit state.
 *
 * Usage:
 *   const fcmBreaker = new CircuitBreaker('FCM', { failureThreshold: 3 });
 *   const result = await fcmBreaker.call(() => sendFCMNotification(token, msg));
 */

class CircuitBreaker {
    /**
     * @param {string} name  - Service label (used in logs)
     * @param {object} opts
     * @param {number} opts.failureThreshold   - Consecutive failures before OPEN (default 5)
     * @param {number} opts.successThreshold   - Successes in HALF_OPEN before CLOSED (default 2)
     * @param {number} opts.openTimeoutMs      - How long to stay OPEN before probing (default 30s)
     * @param {number} opts.callTimeoutMs      - Max time to wait for the wrapped call (default 10s)
     */
    constructor(name, opts = {}) {
        this.name             = name;
        this.failureThreshold = opts.failureThreshold ?? 5;
        this.successThreshold = opts.successThreshold ?? 2;
        this.openTimeoutMs    = opts.openTimeoutMs    ?? 30_000;
        this.callTimeoutMs    = opts.callTimeoutMs    ?? 10_000;

        this._state          = 'CLOSED';
        this._failures       = 0;
        this._successes      = 0;
        this._lastOpenedAt   = null;
    }

    get state() { return this._state; }

    /**
     * Execute `fn` through the breaker.
     * Throws `CircuitOpenError` immediately if the circuit is OPEN.
     * Falls back to `fallbackFn` if provided and the circuit is OPEN.
     *
     * @param {Function} fn          - Async function to protect
     * @param {Function} [fallbackFn] - Optional fallback; receives the error
     * @returns {Promise<any>}
     */
    async call(fn, fallbackFn) {
        if (this._state === 'OPEN') {
            if (Date.now() - this._lastOpenedAt >= this.openTimeoutMs) {
                this._transition('HALF_OPEN');
            } else {
                const err = new CircuitOpenError(this.name);
                if (fallbackFn) return fallbackFn(err);
                throw err;
            }
        }

        try {
            const result = await this._withTimeout(fn);
            this._onSuccess();
            return result;
        } catch (err) {
            this._onFailure(err);
            if (fallbackFn) return fallbackFn(err);
            throw err;
        }
    }

    // ── Private ────────────────────────────────────────────────────────────────

    _withTimeout(fn) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`${this.name} call timed out after ${this.callTimeoutMs}ms`)),
                this.callTimeoutMs
            );
            Promise.resolve()
                .then(fn)
                .then((v) => { clearTimeout(timer); resolve(v); })
                .catch((e) => { clearTimeout(timer); reject(e); });
        });
    }

    _onSuccess() {
        this._failures = 0;
        if (this._state === 'HALF_OPEN') {
            this._successes++;
            if (this._successes >= this.successThreshold) {
                this._transition('CLOSED');
            }
        }
    }

    _onFailure(err) {
        this._failures++;
        this._successes = 0;
        if (this._state === 'HALF_OPEN' || this._failures >= this.failureThreshold) {
            this._transition('OPEN');
        }
        console.warn(`[CircuitBreaker:${this.name}] Failure #${this._failures}: ${err.message}`);
    }

    _transition(newState) {
        const prev = this._state;
        this._state = newState;
        if (newState === 'OPEN')   this._lastOpenedAt = Date.now();
        if (newState === 'CLOSED') { this._failures = 0; this._successes = 0; }
        console.log(`[CircuitBreaker:${this.name}] ${prev} → ${newState}`);
    }
}

class CircuitOpenError extends Error {
    constructor(name) {
        super(`Circuit breaker OPEN for ${name} — service unavailable`);
        this.name = 'CircuitOpenError';
        this.statusCode = 503;
    }
}

// ── Pre-built breakers for each external service ──────────────────────────────
const breakers = {
    fcm:     new CircuitBreaker('FCM',     { failureThreshold: 3, openTimeoutMs: 20_000 }),
    sms:     new CircuitBreaker('SMS',     { failureThreshold: 3, openTimeoutMs: 30_000 }),
    payment: new CircuitBreaker('PAYMENT', { failureThreshold: 2, openTimeoutMs: 60_000 }),
    pusher:  new CircuitBreaker('PUSHER',  { failureThreshold: 5, openTimeoutMs: 15_000 }),
};

module.exports = { CircuitBreaker, CircuitOpenError, breakers };
