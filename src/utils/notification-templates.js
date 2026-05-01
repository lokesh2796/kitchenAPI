/**
 * Notification Templates
 *
 * Single source of truth for every push notification and in-app alert
 * in the system. Each template defines:
 *   - push.title / push.body  — FCM payload (short, emoji-first)
 *   - inApp.message           — in-app alert text
 *   - inApp.icon              — Ionic icon name
 *   - inApp.color             — Ionic color token
 *   - sound                   — 'high' | 'medium' | 'low'
 *   - priority                — FCM Android priority
 *
 * Placeholders use {{key}} syntax and are resolved by `render(template, data)`.
 *
 * Sound contract:
 *   high   → new_order_channel   (Android) / new_order.wav   (iOS) — new orders, new chat
 *   medium → order_updates_channel (Android) / notification.wav (iOS) — cancellations, disputes
 *   low    → order_updates_channel (Android) / silent badge only (iOS) — confirmations, delivered
 */

// ── Renderer ──────────────────────────────────────────────────────────────────

/**
 * Replace {{key}} placeholders in a string with values from `data`.
 * Unknown keys are left as-is so missing data is obvious in logs.
 */
function render(template, data = {}) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
        data[key] !== undefined ? String(data[key]) : `{{${key}}}`
    );
}

/**
 * Resolve all string fields in a template object using render().
 * Returns a new object — the source template is never mutated.
 */
function resolve(template, data = {}) {
    return {
        push: {
            title: render(template.push.title, data),
            body:  render(template.push.body,  data),
        },
        inApp: {
            message: render(template.inApp.message, data),
            icon:    template.inApp.icon,
            color:   template.inApp.color,
        },
        sound:    template.sound,
        priority: template.priority,
    };
}


// ── Templates ─────────────────────────────────────────────────────────────────

const TEMPLATES = {

    // ── Vendor templates ──────────────────────────────────────────────────────

    /**
     * Sent to VENDOR when a customer places a new order.
     * High priority — vendor must act within acceptance window.
     */
    VENDOR_NEW_ORDER: {
        push: {
            title: '🔔 New Order! Act Now',
            body:  '{{customerName}} placed order #{{orderId}} • ₹{{amount}} — Accept or Reject within {{timeoutMins}} min',
        },
        inApp: {
            message: '🛒 New order #{{orderId}} from {{customerName}} (₹{{amount}}). Tap to accept before time runs out!',
            icon:    'cart-outline',
            color:   'success',
        },
        sound:    'high',
        priority: 'high',
    },

    /**
     * Sent to VENDOR when a second vendor is tried (order was re-assigned).
     */
    VENDOR_REASSIGNED_ORDER: {
        push: {
            title: '🔄 Order Reassigned to You',
            body:  'Order #{{orderId}} needs a kitchen — ₹{{amount}}. Accept within {{timeoutMins}} min!',
        },
        inApp: {
            message: '🔄 Order #{{orderId}} (₹{{amount}}) has been reassigned to you. Please respond quickly.',
            icon:    'refresh-outline',
            color:   'warning',
        },
        sound:    'high',
        priority: 'high',
    },

    /**
     * Sent to VENDOR when their order goes from scheduled → confirmed (prep reminder).
     */
    VENDOR_PREPARE_NOW: {
        push: {
            title: '🍳 Time to Prepare!',
            body:  'Order #{{orderId}} is scheduled for delivery soon. Start preparing now.',
        },
        inApp: {
            message: '⏰ Order #{{orderId}} needs to be ready in {{prepBufferMins}} min. Start cooking!',
            icon:    'flame-outline',
            color:   'warning',
        },
        sound:    'medium',
        priority: 'high',
    },

    /**
     * Sent to VENDOR when user cancels.
     */
    VENDOR_ORDER_CANCELLED_BY_USER: {
        push: {
            title: '❌ Order Cancelled by Customer',
            body:  'Order #{{orderId}} from {{customerName}} was cancelled. Reason: {{reason}}',
        },
        inApp: {
            message: '❌ Customer cancelled order #{{orderId}}. Reason: {{reason}}',
            icon:    'close-circle-outline',
            color:   'danger',
        },
        sound:    'medium',
        priority: 'high',
    },

    /**
     * Sent to VENDOR when order is auto-cancelled because vendor didn't respond in time.
     */
    VENDOR_AUTO_CANCELLED: {
        push: {
            title: '⏱️ Order Expired — No Response',
            body:  'Order #{{orderId}} was auto-cancelled: no response within the time limit. No action needed.',
        },
        inApp: {
            message: '⏱️ Order #{{orderId}} was cancelled automatically — no response received within the time limit.',
            icon:    'time-outline',
            color:   'medium',
        },
        sound:    'medium',
        priority: 'normal',
    },

    /**
     * Sent to VENDOR when dispute is raised on their delivered order.
     */
    VENDOR_DISPUTE_RAISED: {
        push: {
            title: '⚠️ Dispute Raised',
            body:  'Customer raised a dispute on order #{{orderId}}. Please review.',
        },
        inApp: {
            message: '⚠️ A dispute has been raised for order #{{orderId}}. Our team will review it.',
            icon:    'alert-circle-outline',
            color:   'warning',
        },
        sound:    'medium',
        priority: 'high',
    },

    // ── User templates ────────────────────────────────────────────────────────

    /**
     * Sent to USER when vendor accepts the order.
     */
    USER_ORDER_CONFIRMED: {
        push: {
            title: '✅ Order Confirmed!',
            body:  'Great news! Your order #{{orderId}} has been accepted by {{vendorName}}.',
        },
        inApp: {
            message: '✅ Your order #{{orderId}} is confirmed! {{vendorName}} is getting ready.',
            icon:    'checkmark-circle-outline',
            color:   'success',
        },
        sound:    'low',
        priority: 'normal',
    },

    /**
     * Sent to USER when vendor starts cooking.
     */
    USER_ORDER_PREPARING: {
        push: {
            title: '👨‍🍳 Kitchen is Cooking!',
            body:  'Your order #{{orderId}} is being freshly prepared. Sit tight!',
        },
        inApp: {
            message: '👨‍🍳 Order #{{orderId}} is being prepared in the kitchen.',
            icon:    'flame-outline',
            color:   'warning',
        },
        sound:    'low',
        priority: 'normal',
    },

    /**
     * Sent to USER when food is packed and ready.
     */
    USER_ORDER_READY: {
        push: {
            title: '🍱 Your Food is Ready!',
            body:  'Order #{{orderId}} is packed and ready. Delivery is on its way soon!',
        },
        inApp: {
            message: '🍱 Order #{{orderId}} is ready and waiting for pickup/delivery.',
            icon:    'restaurant-outline',
            color:   'tertiary',
        },
        sound:    'medium',
        priority: 'high',
    },

    /**
     * Sent to USER when delivery starts.
     */
    USER_ORDER_OUT_FOR_DELIVERY: {
        push: {
            title: '🛵 On the Way!',
            body:  'Your order #{{orderId}} is out for delivery. Get ready!',
        },
        inApp: {
            message: '🛵 Order #{{orderId}} is on its way to you!',
            icon:    'bicycle-outline',
            color:   'primary',
        },
        sound:    'medium',
        priority: 'high',
    },

    /**
     * Sent to USER when order is delivered.
     */
    USER_ORDER_DELIVERED: {
        push: {
            title: '🎉 Delivered — Enjoy!',
            body:  'Order #{{orderId}} has arrived. Bon appétit! Rate your experience.',
        },
        inApp: {
            message: '🎉 Order #{{orderId}} delivered successfully. We hope you enjoy it!',
            icon:    'checkmark-done-outline',
            color:   'success',
        },
        sound:    'low',
        priority: 'normal',
    },

    /**
     * Sent to USER when their order is auto-cancelled (no vendor accepted in time).
     */
    USER_AUTO_CANCELLED: {
        push: {
            title: '😔 Order Cancelled',
            body:  'Sorry, order #{{orderId}} was cancelled — no kitchen was available within the time limit. A full refund will be processed.',
        },
        inApp: {
            message: '😔 Order #{{orderId}} was auto-cancelled: no kitchen responded in time. Full refund initiated.',
            icon:    'close-circle-outline',
            color:   'danger',
        },
        sound:    'medium',
        priority: 'high',
    },

    /**
     * Sent to USER when they cancel the order themselves (confirmation).
     */
    USER_ORDER_CANCELLED_BY_USER: {
        push: {
            title: '❌ Order Cancelled',
            body:  'Your order #{{orderId}} has been cancelled. Refund: ₹{{refundAmount}} ({{refundPct}}%).',
        },
        inApp: {
            message: '❌ Order #{{orderId}} cancelled. Refund of ₹{{refundAmount}} ({{refundPct}}%) will be processed.',
            icon:    'close-circle-outline',
            color:   'medium',
        },
        sound:    'medium',
        priority: 'normal',
    },

    /**
     * Sent to USER when vendor cancels.
     */
    USER_ORDER_CANCELLED_BY_VENDOR: {
        push: {
            title: '❌ Order Cancelled by Kitchen',
            body:  'Sorry, {{vendorName}} cancelled order #{{orderId}}. Full refund is being processed.',
        },
        inApp: {
            message: '❌ Order #{{orderId}} was cancelled by the kitchen. Full refund initiated.',
            icon:    'close-circle-outline',
            color:   'danger',
        },
        sound:    'medium',
        priority: 'high',
    },

    /**
     * Sent to USER when dispute is resolved in their favour.
     */
    USER_DISPUTE_RESOLVED: {
        push: {
            title: '✅ Dispute Resolved',
            body:  'Your dispute for order #{{orderId}} has been resolved. Refund: ₹{{refundAmount}}.',
        },
        inApp: {
            message: '✅ Dispute for order #{{orderId}} resolved. ₹{{refundAmount}} refund is on its way.',
            icon:    'checkmark-done-outline',
            color:   'success',
        },
        sound:    'low',
        priority: 'normal',
    },

    // ── Chat templates (both roles) ───────────────────────────────────────────

    /**
     * Sent to VENDOR when user sends a chat message.
     */
    VENDOR_NEW_CHAT_MESSAGE: {
        push: {
            title: '💬 New Message from Customer',
            body:  '{{senderName}}: "{{preview}}" — Order #{{orderId}}',
        },
        inApp: {
            message: '💬 {{senderName}} sent a message on order #{{orderId}}',
            icon:    'chatbubbles-outline',
            color:   'primary',
        },
        sound:    'high',
        priority: 'high',
    },

    /**
     * Sent to USER when vendor sends a chat message.
     */
    USER_NEW_CHAT_MESSAGE: {
        push: {
            title: '💬 Message from Kitchen',
            body:  '{{senderName}}: "{{preview}}" — Order #{{orderId}}',
        },
        inApp: {
            message: '💬 {{senderName}} sent you a message on order #{{orderId}}',
            icon:    'chatbubbles-outline',
            color:   'primary',
        },
        sound:    'high',
        priority: 'high',
    },
};

// ── Sound → FCM channel mapping ───────────────────────────────────────────────

/**
 * Maps logical sound priority to Android channel + APNS sound.
 * Android channels must be created in the mobile app on first launch.
 *
 * Channel IDs:
 *   new_order_channel     — importance MAX, custom sound new_order.wav
 *   order_updates_channel — importance HIGH, default notification sound
 */
const SOUND_CONFIG = {
    high: {
        android: {
            channelId: 'new_order_channel',
            sound:     'new_order',       // matches res/raw/new_order.mp3 in Android project
            priority:  'max',
            vibration: [0, 500, 200, 500],
        },
        apns: {
            sound:     'new_order.wav',   // must be bundled in iOS app
            badge:     1,
            critical:  false,
        },
    },
    medium: {
        android: {
            channelId: 'order_updates_channel',
            sound:     'notification',
            priority:  'high',
            vibration: [0, 300],
        },
        apns: {
            sound: 'notification.wav',
            badge: 1,
        },
    },
    low: {
        android: {
            channelId: 'order_updates_channel',
            sound:     'notification',
            priority:  'default',
            vibration: [],
        },
        apns: {
            sound: null,   // silent on iOS — badge only
            badge: 1,
        },
    },
};


// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a resolved notification for a given template key and data.
 *
 * @param {keyof typeof TEMPLATES} key
 * @param {object} data  — placeholder values
 * @returns {{ push, inApp, sound, priority, soundConfig }}
 */
function getNotification(key, data = {}) {
    const template = TEMPLATES[key];
    if (!template) {
        console.warn(`[NotifTemplates] Unknown key: ${key}`);
        return null;
    }
    const resolved = resolve(template, data);
    resolved.soundConfig = SOUND_CONFIG[resolved.sound] || SOUND_CONFIG.low;
    return resolved;
}

/**
 * Convenience: resolve and return just the push payload fields.
 */
function getPushPayload(key, data = {}) {
    const n = getNotification(key, data);
    if (!n) return null;
    return { title: n.push.title, body: n.push.body, soundConfig: n.soundConfig, priority: n.priority };
}

/**
 * Convenience: resolve and return just the in-app alert fields.
 */
function getInAppAlert(key, data = {}) {
    const n = getNotification(key, data);
    if (!n) return null;
    return { message: n.inApp.message, icon: n.inApp.icon, color: n.inApp.color, sound: n.sound };
}

module.exports = { getNotification, getPushPayload, getInAppAlert, TEMPLATES, SOUND_CONFIG, render };
