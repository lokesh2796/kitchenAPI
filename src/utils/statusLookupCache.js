const StatusLookup = require('../models/statusLookup.model');

// In-memory cache for ultra-fast string resolution
const cacheByName = new Map();
const cacheByValue = new Map();
let isInitialized = false;

// Hard-coded order-status mappings that take priority over whatever the DB
// contains. This prevents stale DB entries (e.g. an old schema where 'd' meant
// 'deleted') from corrupting the live status resolution and showing delivered
// orders as 'cancelled'.
const CANONICAL_NAME_TO_VALUE = {
    placed:           'p',
    confirmed:        'c',
    preparing:        'pr',
    ready:            'r',
    out_for_delivery: 'od',
    delivered:        'd',
    cancelled:        'cx',
    disputed:         'ds',
    resolved:         'rs',
};
// Reverse of the above — value → canonical name
const CANONICAL_VALUE_TO_NAME = Object.fromEntries(
    Object.entries(CANONICAL_NAME_TO_VALUE).map(([k, v]) => [v, k])
);

// 1. Initialize Cache on server boot
const initStatusCache = async () => {
    try {
        let statuses = await StatusLookup.find({ delete: 0 });
        
        // Seed database if entirely empty
        if (!statuses || statuses.length === 0) {
            console.log('[StatusCache] DB is empty, seeding default lookup values...');
            const defaultStatuses = [
                // Order Statuses
                { name: 'placed', value: 'p' },
                { name: 'active', value: 'a' },
                { name: 'confirmed', value: 'c' },
                { name: 'preparing', value: 'pr' },
                { name: 'ready', value: 'r' },
                { name: 'out_for_delivery', value: 'od' },
                { name: 'delivered', value: 'd' },
                { name: 'cancelled', value: 'cx' },
                { name: 'dispute', value: 'ds' },
                { name: 'resolved', value: 'rs' },
                // General Statuses
                { name: 'inactive', value: 'i' },
                { name: 'deleted', value: 'del' }
            ];
            await StatusLookup.insertMany(defaultStatuses);
            statuses = await StatusLookup.find({ delete: 0 });
        }
        
        // Populate maps
        statuses.forEach(s => {
            cacheByName.set(s.name.toLowerCase(), s.value);
            cacheByValue.set(s.value.toLowerCase(), s.name);
        });
        
        isInitialized = true;
        console.log(`[StatusCache] Successfully loaded ${statuses.length} status lookups into memory.`);
    } catch (err) {
        console.error('[StatusCache] Failed to initialize:', err);
    }
};

/**
 * Get the shorthand value from a full name.
 * Ex: getStatusValue('delivered') -> 'd'
 */
const getStatusValue = (name) => {
    if (!name) return name;
    const key = String(name).toLowerCase();
    // Hard-coded order statuses always win — DB cannot override these
    if (CANONICAL_NAME_TO_VALUE[key]) return CANONICAL_NAME_TO_VALUE[key];
    if (!isInitialized) console.warn('[StatusCache] Accessed before initialization!');
    return cacheByName.has(key) ? cacheByName.get(key) : name;
};

// Legacy → canonical name aliases. Some orders in the wild were stored
// with raw English strings before the lookup migration ('pending' was the
// old default for the order status field, mirroring paymentStatus). When
// the getter sees one of these we surface the canonical name instead.
const legacyAliases = {
    pending: 'placed',
    'order placed': 'placed',
    approved: 'confirmed',
    'out for delivery': 'out_for_delivery',
    canceled: 'cancelled',
    deleted: 'cancelled'  // soft-deleted orders are treated as cancelled in UI
};

/**
 * Get the full name from a shorthand value.
 * Ex: getStatusName('d') -> 'delivered'
 */
const getStatusName = (value) => {
    if (!value) return value;
    const key = String(value).toLowerCase();
    // Hard-coded order statuses always win — prevents stale DB entries (e.g.
    // 'd' → 'deleted' from an older schema) from returning the wrong name.
    if (CANONICAL_VALUE_TO_NAME[key]) return CANONICAL_VALUE_TO_NAME[key];
    // Already a canonical name — no lookup needed
    if (CANONICAL_NAME_TO_VALUE[key]) return key;
    if (!isInitialized) console.warn('[StatusCache] Accessed before initialization!');
    if (cacheByValue.has(key)) {
        const name = cacheByValue.get(key);
        return legacyAliases[name] || name;
    }
    if (legacyAliases[key]) return legacyAliases[key];
    if (cacheByName.has(key)) return key;
    return value; // Graceful DB fallback
};

module.exports = {
    initStatusCache,
    getStatusValue,
    getStatusName,
    isInitialized: () => isInitialized
};
