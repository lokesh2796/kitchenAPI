/**
 * VendorAssignmentService
 *
 * Drives the full vendor acceptance lifecycle:
 *   placeOrder → assignVendor → (ACCEPTED | REJECTED | TIMEOUT) → reassign → … → cancel
 *
 * Acceptance windows (configurable via ACCEPTANCE_TIMEOUTS_SECS):
 *   TODAY    → 120 s (2 min)
 *   TOMORROW → 60 s  (1 min — half of TODAY)
 *   PREORDER → 60 s  (1 min — half of TODAY)
 *
 * Queue: BullJS  (requires Redis)
 * DB:    MongoDB (Order + OrderAssignment + UserProfile + TodayMenu/PreOrderMenu)
 */

const Bull = require("bull");
const Order = require("../menu-service/models/order.model");
const OrderAssignment = require("../models/orderAssignment.model");
const UserProfile = require("../models/userProfile.model");
const TodayMenu = require("../menu-service/models/todayMenu.model");
const PreOrderMenu = require("../menu-service/models/preOrderMenu.model");
const { calculateDistance } = require("../utils/order-utils");
const { publishEvent, CHANNELS, EVENTS } = require("../utils/socket");
const { sendToVendor, sendToUser } = require("../utils/firebase-fcm.service");

// ── Config ────────────────────────────────────────────────────────────────────
const ACCEPTANCE_TIMEOUTS_SECS = {
  today: 600,     // 10 minutes
  tomorrow: 1800, // 30 minutes
  preorder: 1800, // 30 minutes
};

const MAX_RETRIES = {
  today: 3,
  tomorrow: 5, // more retries for scheduled — there's time to find someone
  preorder: 5,
};

// ── Bull Queue ────────────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const acceptanceQueue = new Bull("vendor-acceptance", REDIS_URL, {
  defaultJobOptions: {
    attempts: 1, // each job fires exactly once — retries are our own logic
    removeOnComplete: 100, // keep last 100 completed jobs for audit
    removeOnFail: 200,
  },
});

// Expose queue so the worker process can attach processors
module.exports.acceptanceQueue = acceptanceQueue;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called immediately after an order is saved.
 * Finds the best available vendor (starting with the one the user picked),
 * assigns the order, and starts the acceptance timer.
 */
module.exports.initiateAssignment = async (orderId) => {
  const order = await Order.findById(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  // Build (or load) the assignment tracker
  let assignment = await OrderAssignment.findOne({ orderId });
  if (!assignment) {
    const cuisines = [
      ...new Set(order.items.map((i) => i.cuisine).filter(Boolean)),
    ];
    const categories = [
      ...new Set(order.items.map((i) => i.category).filter(Boolean)),
    ];

    assignment = new OrderAssignment({
      orderId: order._id,
      orderCategory: order.category,
      originalVendorId: order.vendorId,
      currentVendorId: order.vendorId,
      cuisines,
      categories,
      deliveryLat: order.deliveryAddress?.lat,
      deliveryLng: order.deliveryAddress?.long,
      maxRetries: MAX_RETRIES[order.category] || 3,
    });
  }

  await _assignToVendor(order, assignment, order.vendorId);
};

/**
 * Vendor explicitly accepts the order.
 * Returns { ok: true } or throws if the acceptance window has already closed.
 */
module.exports.vendorAccept = async (orderId, vendorId) => {
  const [order, assignment] = await _loadPair(orderId);

  _assertCurrentVendor(assignment, vendorId);
  _assertWindowOpen(assignment);

  const attempt = _currentAttempt(assignment);

  // Cancel the timeout job — vendor responded in time
  await _cancelJob(attempt.bullJobId);

  // Record response
  attempt.response = "ACCEPTED";
  attempt.respondedAt = new Date();
  assignment.finalStatus = "ACCEPTED";

  // Update order — set status to confirmed so state machine sees the right state
  order.assignmentStatus = "accepted";
  order.assignedVendorId = vendorId;
  order.status = "confirmed";
  _pushHistory(order, "confirmed", "vendor", "Vendor accepted the order");

  await Promise.all([assignment.save(), order.save()]);

  // Notify user — only on confirmation, never expose rejections
  await _notifyUser(order, "confirmed");
  await _notifyVendorConfirmed(order);

  return { ok: true };
};

/**
 * Vendor explicitly rejects the order.
 */
module.exports.vendorReject = async (orderId, vendorId, reason = "") => {
  const [order, assignment] = await _loadPair(orderId);

  _assertCurrentVendor(assignment, vendorId);
  _assertWindowOpen(assignment);

  const attempt = _currentAttempt(assignment);
  await _cancelJob(attempt.bullJobId);

  attempt.response = "REJECTED";
  attempt.respondedAt = new Date();
  attempt.rejectReason = reason;

  await assignment.save();

  // Immediately try next vendor — user sees nothing yet
  await _handleNonAcceptance(order, assignment, "REJECTED");
};

/**
 * Called by the BullJS worker when the acceptance window expires.
 */
module.exports.handleTimeout = async (orderId) => {
  const [order, assignment] = await _loadPair(orderId);

  // If the vendor already moved the order past 'placed' via the status endpoint
  // (without using /accept), the order is live — do not auto-cancel it.
  const TERMINAL_OR_ACTIVE = [
    'confirmed', 'preparing', 'ready', 'out_for_delivery',
    'delivered', 'cancelled', 'disputed', 'resolved',
  ];
  const currentStatus = (order.status || '').toLowerCase();
  if (TERMINAL_OR_ACTIVE.includes(currentStatus)) {
    console.log(`[Assignment] Timeout for ${orderId} skipped — order already in '${order.status}'`);
    // Clean up the attempt record so the assignment history is accurate
    const attempt = _currentAttempt(assignment);
    if (attempt && attempt.response === null) {
      attempt.response = 'ACCEPTED';
      attempt.respondedAt = new Date();
      assignment.finalStatus = 'ACCEPTED';
      await assignment.save();
    }
    return;
  }

  const attempt = _currentAttempt(assignment);
  if (!attempt || attempt.response !== null) {
    // Already responded (race condition) — nothing to do
    return;
  }

  attempt.response = "TIMEOUT";
  attempt.respondedAt = new Date();

  await assignment.save();
  await _handleNonAcceptance(order, assignment, "TIMEOUT");
};

/**
 * Cancel the pending acceptance Bull job for an order.
 * Called when the vendor moves the order forward via the status button
 * instead of using the dedicated /accept endpoint — ensures the timeout
 * job never fires and overwrites a live order.
 */
module.exports.cancelAcceptanceJob = async (orderId) => {
  try {
    const assignment = await OrderAssignment.findOne({ orderId });
    if (!assignment) return;

    const attempt = _currentAttempt(assignment);
    if (!attempt || attempt.response !== null) return; // already resolved

    await _cancelJob(attempt.bullJobId);

    attempt.response = 'ACCEPTED';
    attempt.respondedAt = new Date();
    assignment.finalStatus = 'ACCEPTED';
    await assignment.save();

    console.log(`[Assignment] Acceptance job cancelled for order ${orderId} (vendor moved order via status button)`);
  } catch (err) {
    // Non-fatal — the handleTimeout guard is still the last line of defence
    console.warn(`[Assignment] cancelAcceptanceJob failed for ${orderId}:`, err.message);
  }
};

// ── Internal helpers ─────────────────────────────────────────────────────────

async function _loadPair(orderId) {
  const [order, assignment] = await Promise.all([
    Order.findById(orderId),
    OrderAssignment.findOne({ orderId }),
  ]);
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (!assignment)
    throw new Error(`Assignment record for ${orderId} not found`);
  return [order, assignment];
}

function _assertCurrentVendor(assignment, vendorId) {
  if (String(assignment.currentVendorId) !== String(vendorId)) {
    throw Object.assign(
      new Error("You are not the currently assigned vendor"),
      { statusCode: 403 },
    );
  }
}

function _assertWindowOpen(assignment) {
  const attempt = _currentAttempt(assignment);
  if (!attempt || attempt.response !== null) {
    throw Object.assign(new Error("Acceptance window has already closed"), {
      statusCode: 409,
    });
  }
  if (new Date() > attempt.timeoutAt) {
    throw Object.assign(new Error("Acceptance window has expired"), {
      statusCode: 409,
    });
  }
}

function _currentAttempt(assignment) {
  return assignment.attempts[assignment.attempts.length - 1] || null;
}

/**
 * Core: assign the order to a specific vendor, start the timer.
 */
async function _assignToVendor(order, assignment, vendorId) {
  const timeoutSecs = ACCEPTANCE_TIMEOUTS_SECS[order.category] || 120;
  const timeoutAt = new Date(Date.now() + timeoutSecs * 1000);

  // Fetch vendor name for notifications
  const profile = await UserProfile.findOne({ userId: vendorId }).lean();
  const vendorName = profile?.businessName || "Kitchen";

  // Distance from this vendor to delivery address
  const vLat = profile?.vendorLocation?.lat;
  const vLng = profile?.vendorLocation?.long;
  const distanceKm = order.deliveryAddress?.lat
    ? calculateDistance(
        order.deliveryAddress.lat,
        order.deliveryAddress.long,
        vLat,
        vLng,
      )
    : null;

  // Enqueue the timeout job
  const job = await acceptanceQueue.add(
    "timeout",
    { orderId: order._id.toString() },
    {
      delay: timeoutSecs * 1000,
      jobId: `timeout-${order._id}-${assignment.retryCount}`,
    },
  );

  // Record the attempt
  assignment.attempts.push({
    vendorId,
    vendorName,
    timeoutAt,
    bullJobId: String(job.id),
    distanceKm,
  });
  assignment.retryCount = assignment.attempts.length;
  assignment.currentVendorId = vendorId;

  // Update order
  order.assignmentStatus = "assigned";
  order.assignedVendorId = vendorId;
  order.acceptanceDeadline = timeoutAt;
  _pushHistory(
    order,
    order.status,
    "system",
    `Assigned to vendor — window ${timeoutSecs}s`,
  );

  await Promise.all([assignment.save(), order.save()]);

  // Push real-time + FCM to vendor
  await _notifyVendorAssigned(order, vendorId, timeoutAt);

  console.log(
    `[Assignment] Order ${order.orderId} → vendor ${vendorId} | window ${timeoutSecs}s | attempt #${assignment.retryCount}`,
  );
}

/**
 * Handles REJECTED or TIMEOUT: try next vendor or cancel.
 */
async function _handleNonAcceptance(order, assignment, reason) {
  const reassignStatus = reason === "TIMEOUT" ? "timeout" : "rejected";
  order.assignmentStatus = reassignStatus;
  _pushHistory(
    order,
    order.status,
    "system",
    `Vendor ${reason.toLowerCase()} — finding next vendor`,
  );

  if (assignment.retryCount >= assignment.maxRetries) {
    await _exhaustRetries(order, assignment);
    return;
  }

  // Find next candidate (excluding all already-tried vendors)
  const triedIds = assignment.attempts.map((a) => String(a.vendorId));
  const nextVendorId = await _findNextVendor(order, assignment, triedIds);

  if (!nextVendorId) {
    await _exhaustRetries(order, assignment);
    return;
  }

  order.assignmentStatus = "reassigned";
  await order.save();

  await _assignToVendor(order, assignment, nextVendorId);
}

/**
 * No vendor accepted after all retries → cancel + trigger refund.
 */
async function _exhaustRetries(order, assignment) {
  // Order already progressed — don't overwrite with cancellation
  const s = (order.status || '').toLowerCase();
  if (!['placed', 'unassigned'].includes(s) && s !== 'p') {
    console.log(`[Assignment] _exhaustRetries skipped for ${order.orderId} — already in '${order.status}'`);
    assignment.finalStatus = "ACCEPTED";
    await assignment.save();
    return;
  }

  assignment.finalStatus = "EXHAUSTED";

  order.assignmentStatus = "exhausted";
  order.status = "cancelled";
  order.cancelledBy = "system";
  order.cancelReason = "No available vendor accepted your order.";
  _pushHistory(
    order,
    "cancelled",
    "system",
    "All vendor retries exhausted — auto-cancelled",
  );

  await Promise.all([assignment.save(), order.save()]);

  await _notifyUser(order, "cancelled_no_vendor");

  console.log(
    `[Assignment] Order ${order.orderId} EXHAUSTED — auto-cancelled`,
  );
}

/**
 * Vendor selection algorithm.
 *
 * Priority:
 *   1. Cuisine / category match
 *   2. Nearest to delivery address
 *   3. Has items available for the order date
 *   4. Kitchen open + Active status
 *   5. Not already tried
 */
async function _findNextVendor(order, assignment, excludeVendorIds) {
  // Find all active vendor profiles (exclude already-tried)
  const profiles = await UserProfile.find({
    vendorStatus: "Active",
    userId: {
      $nin: excludeVendorIds.map((id) =>
        require("mongoose").Types.ObjectId(id),
      ),
    },
    "vendorLocation.lat": { $exists: true },
  }).lean();

  if (!profiles.length) return null;

  const isToday = order.category === "today";
  const isTomorrow = order.category === "tomorrow";

  // For each candidate, check they have at least one matching item available
  const scored = [];

  for (const profile of profiles) {
    const vid = String(profile.userId);

    // Availability check: do they have menu items for this order date?
    const menuFilter = {
      userId: profile.userId,
      balanceQty: { $gt: 0 },
      isHidden: { $ne: true },
    };

    let hasItems = false;
    if (isToday || isTomorrow) {
      const targetDate = new Date(order.deliveryDate);
      targetDate.setUTCHours(0, 0, 0, 0);
      const endDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
      const count = await TodayMenu.countDocuments({
        ...menuFilter,
        menuDate: { $gte: targetDate, $lt: endDate },
      });
      hasItems = count > 0;
    } else {
      const count = await PreOrderMenu.countDocuments(menuFilter);
      hasItems = count > 0;
    }

    if (!hasItems) continue;

    // Distance score (lower = better)
    const dLat = assignment.deliveryLat || order.deliveryAddress?.lat;
    const dLng = assignment.deliveryLng || order.deliveryAddress?.long;
    const dist =
      calculateDistance(
        dLat,
        dLng,
        profile.vendorLocation?.lat,
        profile.vendorLocation?.long,
      ) || 9999;

    // Cuisine match bonus
    const cuisineMatch = assignment.cuisines.some((c) =>
      (profile.cuisines || [])
        .map((x) => x.toLowerCase())
        .includes(c.toLowerCase()),
    )
      ? 1
      : 0;

    scored.push({ vendorId: profile.userId, dist, cuisineMatch });
  }

  if (!scored.length) return null;

  // Sort: cuisine match first (desc), then distance (asc)
  scored.sort((a, b) => {
    if (b.cuisineMatch !== a.cuisineMatch)
      return b.cuisineMatch - a.cuisineMatch;
    return a.dist - b.dist;
  });

  return scored[0].vendorId;
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function _notifyVendorAssigned(order, vendorId, timeoutAt) {
  const windowSecs = Math.round((timeoutAt - Date.now()) / 1000);

  // Socket.IO — real-time new-order ping to vendor room
  publishEvent(CHANNELS.VENDOR_NOTIFICATIONS(vendorId), {
    event: EVENTS.NEW_ORDER,
    orderId: order.orderId,
    category: order.category,
    timeoutAt: timeoutAt.toISOString(),
    windowSecs,
  });

  // FCM push
  await sendToVendor(
    String(vendorId),
    "🆕 New Order Request",
    `Order #${order.orderId} — respond within ${windowSecs}s`,
    { orderId: String(order._id), type: "NEW_ORDER" },
  );
}

async function _notifyVendorConfirmed(order) {
  publishEvent(CHANNELS.VENDOR_NOTIFICATIONS(order.assignedVendorId || order.vendorId), {
    event: "VENDOR_ORDER_CONFIRMED",
    orderId: order.orderId,
  });
}

async function _notifyUser(order, eventType) {
  const messages = {
    confirmed: {
      title: "✅ Order Confirmed!",
      body: `Your order #${order.orderId} has been accepted and is being prepared.`,
    },
    cancelled_no_vendor: {
      title: "😔 Order Cancelled",
      body: `We couldn't find an available kitchen for your order #${order.orderId}. A full refund will be processed if applicable.`,
    },
  };

  const msg = messages[eventType];
  if (!msg) return;

  publishEvent(CHANNELS.USER_NOTIFICATIONS(order.userId), {
    event: "ORDER_STATUS_UPDATE",
    orderId: order.orderId,
    status: eventType === "confirmed" ? "confirmed" : "cancelled",
    message: msg.body,
  });

  await sendToUser(
    String(order.userId),
    msg.title,
    msg.body,
    { orderId: String(order._id), type: "ORDER_STATUS_UPDATE" },
  );
}

// ── Refund stub ───────────────────────────────────────────────────────────────

// ── Utility ───────────────────────────────────────────────────────────────────

function _pushHistory(order, status, changedBy, note) {
  if (!order.statusHistory) order.statusHistory = [];
  order.statusHistory.push({ status, changedBy, note, changedAt: new Date() });
}

async function _cancelJob(jobId) {
  if (!jobId) return;
  try {
    const job = await acceptanceQueue.getJob(jobId);
    if (job) await job.remove();
  } catch (e) {
    console.warn(`[Assignment] Could not remove job ${jobId}:`, e.message);
  }
}
