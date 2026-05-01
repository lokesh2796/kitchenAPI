/**
 * SlotManager
 *
 * Prevents slot overbooking using Redis atomic counters + Lua scripts.
 *
 * Why Redis instead of MongoDB for this?
 *   MongoDB $inc with $where is not atomic under concurrent load.
 *   Redis INCRBY is single-threaded and atomic by design.
 *   The MongoDB record is the source of truth for persistence;
 *   Redis is the fast gate that prevents overselling.
 *
 * Slot key format:  slot:{vendorId}:{date}:{slotStart}
 * Value:            remaining capacity (integer ≥ 0)
 *
 * On server start → `syncSlotsToRedis(vendorId, date)` loads MongoDB
 * time_slots into Redis.  On booking → `claimSlot()` atomically decrements.
 * On cancel/reject → `releaseSlot()` increments back.
 */

const redis = require('./redis.client');
const mongoose = require('mongoose');

// TTL for slot keys — expire 1 day after the slot date so keys self-clean.
const SLOT_KEY_TTL_SECS = 86_400 * 2; // 2 days

/**
 * Lua script: decrement counter only if it is > 0 (atomic check-and-decrement).
 * Returns the NEW value after decrement, or -1 if already at 0 (full).
 */
const CLAIM_SCRIPT = `
local val = tonumber(redis.call('GET', KEYS[1]))
if val == nil then return -2 end   -- key missing (not synced)
if val <= 0   then return -1 end   -- slot full
return redis.call('DECRBY', KEYS[1], tonumber(ARGV[1]))
`;

/**
 * Attempt to claim `qty` seats in the specified slot.
 *
 * @returns {{ ok: boolean, remaining: number, reason?: string }}
 */
async function claimSlot({ vendorId, date, slotStart, qty = 1 }) {
    if (!redis.isReady) {
        // Redis unavailable — fall back to MongoDB check (slower, slightly less safe)
        return _mongoFallbackClaim({ vendorId, date, slotStart, qty });
    }

    const key = _slotKey(vendorId, date, slotStart);
    const result = await redis.eval(CLAIM_SCRIPT, 1, key, qty).catch(() => null);

    if (result === null) {
        return _mongoFallbackClaim({ vendorId, date, slotStart, qty });
    }
    if (result === -2) {
        // Key not in Redis — sync from DB then retry once
        await syncSlotToRedis(vendorId, date, slotStart);
        return claimSlot({ vendorId, date, slotStart, qty });
    }
    if (result === -1) {
        return { ok: false, remaining: 0, reason: 'SLOT_FULL' };
    }

    return { ok: true, remaining: result };
}

/**
 * Release `qty` seats back (called on order cancel / vendor reject).
 */
async function releaseSlot({ vendorId, date, slotStart, qty = 1 }) {
    if (!redis.isReady) return;

    const key = _slotKey(vendorId, date, slotStart);
    await redis.incrby(key, qty).catch(() => {});

    // Also update MongoDB asynchronously
    await _mongoRelease({ vendorId, date, slotStart, qty }).catch(err =>
        console.error('[SlotManager] mongoRelease error:', err.message)
    );
}

/**
 * Load a single slot's remaining capacity from MongoDB into Redis.
 * Called lazily when a key is missing from Redis.
 */
async function syncSlotToRedis(vendorId, date, slotStart) {
    if (!redis.isReady) return;

    // Lazy-require to avoid circular dependency issues at module load time
    const TimeSlot = _getTimeSlotModel();
    const slot = await TimeSlot.findOne({
        vendorId: mongoose.Types.ObjectId(vendorId),
        date:     _normalizeDate(date),
        slotStart,
    }).lean();

    if (!slot) return;

    const remaining = slot.capacity - slot.booked;
    const key = _slotKey(vendorId, date, slotStart);
    await redis.set(key, Math.max(0, remaining), 'EX', SLOT_KEY_TTL_SECS).catch(() => {});
}

/**
 * Sync ALL slots for a vendor+date into Redis.
 * Call this on server start or whenever a vendor's schedule changes.
 */
async function syncAllSlotsForDate(vendorId, date) {
    if (!redis.isReady) return;

    const TimeSlot = _getTimeSlotModel();
    const slots = await TimeSlot.find({
        vendorId: mongoose.Types.ObjectId(vendorId),
        date:     _normalizeDate(date),
    }).lean();

    const pipeline = redis.pipeline();
    for (const slot of slots) {
        const remaining = slot.capacity - slot.booked;
        const key = _slotKey(vendorId, date, slot.slotStart);
        pipeline.set(key, Math.max(0, remaining), 'EX', SLOT_KEY_TTL_SECS);
    }
    await pipeline.exec().catch(() => {});
}

// ── MongoDB fallback ──────────────────────────────────────────────────────────

async function _mongoFallbackClaim({ vendorId, date, slotStart, qty }) {
    const TimeSlot = _getTimeSlotModel();

    // Atomic findOneAndUpdate: only succeeds if enough capacity remains
    const updated = await TimeSlot.findOneAndUpdate(
        {
            vendorId: mongoose.Types.ObjectId(vendorId),
            date:     _normalizeDate(date),
            slotStart,
            isBlocked: { $ne: true },
            $expr: { $lte: [{ $add: ['$booked', qty] }, '$capacity'] },
        },
        { $inc: { booked: qty } },
        { new: true }
    );

    if (!updated) {
        return { ok: false, remaining: 0, reason: 'SLOT_FULL' };
    }
    return { ok: true, remaining: updated.capacity - updated.booked };
}

async function _mongoRelease({ vendorId, date, slotStart, qty }) {
    const TimeSlot = _getTimeSlotModel();
    await TimeSlot.findOneAndUpdate(
        { vendorId: mongoose.Types.ObjectId(vendorId), date: _normalizeDate(date), slotStart },
        { $inc: { booked: -qty } }
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _slotKey(vendorId, date, slotStart) {
    const d = typeof date === 'string' ? date : date.toISOString().split('T')[0];
    return `slot:${vendorId}:${d}:${slotStart}`;
}

function _normalizeDate(date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
}

function _getTimeSlotModel() {
    try {
        return mongoose.model('TimeSlot');
    } catch {
        // Model not registered yet — register a minimal inline schema
        const schema = new mongoose.Schema({
            vendorId:  mongoose.Schema.Types.ObjectId,
            date:      Date,
            slotStart: String,
            slotEnd:   String,
            capacity:  Number,
            booked:    { type: Number, default: 0 },
            isBlocked: { type: Boolean, default: false },
        });
        schema.index({ vendorId: 1, date: 1 });
        schema.index({ vendorId: 1, date: 1, slotStart: 1 }, { unique: true });
        return mongoose.model('TimeSlot', schema);
    }
}

module.exports = { claimSlot, releaseSlot, syncSlotToRedis, syncAllSlotsForDate };
