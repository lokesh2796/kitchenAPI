/**
 * Order State Machine
 *
 * Enforces legal status transitions for both vendor and user actions.
 * Rejecting invalid transitions at the middleware layer prevents the DB
 * from ever reaching an inconsistent state.
 *
 * Transition table:
 *
 *  FROM               │  VENDOR can move to          │  USER can move to      │  SYSTEM can move to
 * ────────────────────┼──────────────────────────────┼────────────────────────┼─────────────────────
 *  placed             │  confirmed, cancelled        │  cancelled             │  confirmed, cancelled
 *  confirmed          │  preparing, cancelled        │  –                     │  –
 *  preparing          │  ready                       │  –                     │  –
 *  ready              │  out_for_delivery, delivered │  –                     │  –
 *  out_for_delivery   │  delivered                   │  –                     │  –
 *  delivered          │  –                           │  disputed              │  –
 *  cancelled          │  –                           │  –                     │  –
 *  disputed           │  –                           │  –                     │  resolved
 *  resolved           │  –                           │  –                     │  –
 *
 * Use as express middleware on  PATCH /orders/:orderId/status
 */

// Normalise codes like 'c', 'pr', 'od' → canonical names
const STATUS_ALIASES = {
    p:       'placed',
    pending: 'placed',   // legacy DB values stored as 'pending' treated as 'placed'
    c:       'confirmed', a: 'confirmed',
    pr:      'preparing',
    r:       'ready',
    od:      'out_for_delivery',
    d:       'delivered',
    cx:      'cancelled', del: 'cancelled', deleted: 'cancelled',
    ds:      'disputed',
    rs:      'resolved',
};

function normalise(s) {
    if (!s) return '';
    const lower = s.toLowerCase();
    return STATUS_ALIASES[lower] || lower;
}

// Each entry: set of statuses the actor is allowed to transition TO from this state.
const TRANSITIONS = {
    placed: {
        vendor: new Set(['confirmed', 'cancelled']),
        user:   new Set(['cancelled']),
        system: new Set(['confirmed', 'cancelled']),
    },
    confirmed: {
        // Vendor can advance one step at a time OR jump directly to delivered
        // (e.g. pickup orders where preparation and handoff happen in one go)
        vendor: new Set(['preparing', 'ready', 'delivered', 'cancelled']),
        user:   new Set(['cancelled']),
        system: new Set(['preparing', 'cancelled']),
    },
    preparing: {
        vendor: new Set(['ready', 'delivered', 'cancelled']),
        user:   new Set([]),
        system: new Set([]),
    },
    ready: {
        vendor: new Set(['out_for_delivery', 'delivered', 'cancelled']),
        user:   new Set([]),
        system: new Set([]),
    },
    out_for_delivery: {
        vendor: new Set(['delivered', 'cancelled']),
        user:   new Set([]),
        system: new Set([]),
    },
    delivered: {
        vendor: new Set([]),
        user:   new Set(['disputed']),
        system: new Set([]),
    },
    cancelled: { vendor: new Set([]), user: new Set([]), system: new Set([]) },
    disputed:  { vendor: new Set([]), user: new Set([]), system: new Set(['resolved']) },
    resolved:  { vendor: new Set([]), user: new Set([]), system: new Set([]) },
};

/**
 * Express middleware — attaches to  PATCH /orders/:orderId/status
 *
 * Expects:
 *   req.body.status   — desired next status
 *   req.user._id      — caller identity
 *   req.order         — Order document (pre-fetched by a prior middleware or loaded here)
 *
 * Sets req.actor ('vendor' | 'user' | 'system') and req.canonicalStatus
 * for downstream handlers.
 */
module.exports = function orderStateMachine(Order) {
    return async function (req, res, next) {
        try {
            const { orderId } = req.params;
            const desiredRaw  = req.body.status;
            if (!desiredRaw) return res.status(400).json({ message: 'status is required' });

            const desired = normalise(desiredRaw);
            if (!desired)  return res.status(400).json({ message: `Unknown status: ${desiredRaw}` });

            // Load order if not already on req
            if (!req.order) {
                req.order = await Order.findById(orderId);
                if (!req.order) return res.status(404).json({ message: 'Order not found' });
            }

            const current = normalise(req.order.status);
            const userId  = req.user._id.toString();

            // Determine actor
            const isVendor = req.order.vendorId.toString() === userId;
            const isUser   = req.order.userId.toString()   === userId;
            const actor    = isVendor ? 'vendor' : isUser ? 'user' : null;

            if (!actor) {
                return res.status(403).json({ message: 'Not authorised to update this order' });
            }

            // Lookup allowed transitions
            const allowed = TRANSITIONS[current]?.[actor];
            if (!allowed) {
                return res.status(422).json({
                    message: `No transitions defined from status '${current}'`,
                    current,
                });
            }

            if (!allowed.has(desired)) {
                return res.status(422).json({
                    message: `Transition '${current}' → '${desired}' is not allowed for ${actor}`,
                    current,
                    desired,
                    allowed: [...allowed],
                });
            }

            // Attach resolved values for the handler
            req.actor           = actor;
            req.canonicalStatus = desired;

            next();
        } catch (err) {
            next(err);
        }
    };
};

// Export normalise so controllers can reuse it
module.exports.normalise = normalise;
