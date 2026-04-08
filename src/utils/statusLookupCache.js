const StatusLookup = require('../models/statusLookup.model');

// In-memory cache for ultra-fast string resolution
const cacheByName = new Map();
const cacheByValue = new Map();
let isInitialized = false;

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
 * Ex: getStatusValue('active') -> 'a'
 */
const getStatusValue = (name) => {
    if (!name) return name;
    if (!isInitialized) console.warn('[StatusCache] Accessed before initialization!');
    const key = String(name).toLowerCase();
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
    canceled: 'cancelled'
};

/**
 * Get the full name from a shorthand value.
 * Ex: getStatusName('a') -> 'active'
 */
const getStatusName = (value) => {
    if (!value) return value;
    if (!isInitialized) console.warn('[StatusCache] Accessed before initialization!');
    const key = String(value).toLowerCase();
    if (cacheByValue.has(key)) return cacheByValue.get(key);
    if (legacyAliases[key]) return legacyAliases[key];
    // If the stored value is already a canonical name (was inserted by name
    // rather than by code), return it as-is.
    if (cacheByName.has(key)) return key;
    return value; // Graceful DB fallback
};

module.exports = {
    initStatusCache,
    getStatusValue,
    getStatusName,
    isInitialized: () => isInitialized
};
