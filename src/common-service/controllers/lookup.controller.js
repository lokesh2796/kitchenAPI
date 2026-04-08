const StatusLookup = require('../../models/statusLookup.model');

/**
 * GET /lookup
 * Returns ALL lookup values grouped by category.
 *
 * Optional query params:
 *   ?category=order_status   → filter by single category
 *   ?flat=true               → return as a flat array (no grouping)
 */
exports.getAllLookups = async (req, res) => {
    try {
        const { category, flat } = req.query;

        const filter = { delete: 0 };
        if (category) filter.category = category;

        const items = await StatusLookup.find(filter)
            .sort({ category: 1, sortOrder: 1, name: 1 })
            .lean();

        if (flat === 'true') {
            return res.json({ success: true, count: items.length, data: items });
        }

        // Group by category
        const grouped = items.reduce((acc, item) => {
            const cat = item.category || 'misc';
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push({
                _id: item._id,
                name: item.name,
                value: item.value,
                displayName: item.displayName || item.name,
                sortOrder: item.sortOrder || 0
            });
            return acc;
        }, {});

        res.json({
            success: true,
            count: items.length,
            categories: Object.keys(grouped),
            data: grouped
        });
    } catch (err) {
        console.error('[Lookup] getAllLookups error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /lookup/:category
 * Returns all values for a single category as a flat array.
 */
exports.getLookupByCategory = async (req, res) => {
    try {
        const { category } = req.params;
        const items = await StatusLookup.find({ category, delete: 0 })
            .sort({ sortOrder: 1, name: 1 })
            .lean();

        res.json({
            success: true,
            category,
            count: items.length,
            data: items.map(i => ({
                _id: i._id,
                name: i.name,
                value: i.value,
                displayName: i.displayName || i.name,
                sortOrder: i.sortOrder || 0
            }))
        });
    } catch (err) {
        console.error('[Lookup] getLookupByCategory error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * GET /lookup/categories/list
 * Returns the list of distinct categories present in the table.
 */
exports.getCategories = async (req, res) => {
    try {
        const cats = await StatusLookup.distinct('category', { delete: 0 });
        res.json({ success: true, count: cats.length, data: cats.filter(Boolean).sort() });
    } catch (err) {
        console.error('[Lookup] getCategories error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};
