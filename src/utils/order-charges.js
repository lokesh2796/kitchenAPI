/**
 * Single source of truth for order/cart price breakdown.
 *
 * Both the cart fetch (so the cart screen shows live numbers) and the order
 * placement (so the saved order matches what the user saw) call this. The
 * arithmetic order is intentional and matches what the cart UI shows the user:
 *
 *     Item Total (sum of basePrice × qty + addons × qty, BEFORE discount)
 *   - Discount  (sum of (basePrice − dealPrice) × qty for items with a deal)
 *   + Delivery Charge   (from vendor.deliveryPolicy.deliveryCharge, only on delivery)
 *   + Platform Charge   (flat, configurable via env)
 *   + Tax       (percent of post-discount subtotal, configurable via env)
 *   ─────────────────
 *   = Grand Total
 *
 * Items here are expected in the shape stored in the Cart / order payloads:
 * { basePrice, dealPrice, qty, selectedAddons | Addons }
 */

// Defaults: small flat platform fee so the line item shows in the order
// summary out of the box. Override either via .env (PLATFORM_CHARGE,
// TAX_PERCENT). Use `0` to hide the charge entirely.
const PLATFORM_CHARGE = process.env.PLATFORM_CHARGE !== undefined
    ? Number(process.env.PLATFORM_CHARGE)
    : 5;
const TAX_PERCENT = Number(process.env.TAX_PERCENT || 0);

function getAddonsForItem(item) {
    return item.selectedAddons || item.Addons || [];
}

function computeCharges(items, options = {}) {
    const { orderType = 'pickup', deliveryCharge: vendorDeliveryCharge = 0 } = options;

    // Item total uses BASE price × qty + addons × qty (no discount applied yet).
    // Discount is then shown as a separate line so the user sees the breakdown.
    let itemTotal = 0;
    let discount = 0;

    for (const item of items || []) {
        const qty = Number(item.qty) || 0;
        const basePrice = Number(item.basePrice) || 0;
        const dealPrice = item.dealPrice != null ? Number(item.dealPrice) : null;
        const addonsTotal = getAddonsForItem(item)
            .reduce((s, a) => s + (Number(a.price) || 0), 0);

        itemTotal += (basePrice + addonsTotal) * qty;

        if (dealPrice != null && dealPrice < basePrice) {
            discount += (basePrice - dealPrice) * qty;
        }
    }

    const deliveryCharge = orderType === 'delivery' ? Number(vendorDeliveryCharge) || 0 : 0;
    const platformCharge = PLATFORM_CHARGE;

    // Tax applies to the post-discount item subtotal (not delivery / platform).
    const postDiscountSubtotal = Math.max(0, itemTotal - discount);
    const taxAmount = TAX_PERCENT > 0
        ? Math.round(postDiscountSubtotal * (TAX_PERCENT / 100))
        : 0;

    const grandTotal = postDiscountSubtotal + deliveryCharge + platformCharge + taxAmount;

    return {
        itemTotal,
        discount,
        deliveryCharge,
        platformCharge,
        taxAmount,
        taxPercent: TAX_PERCENT,
        grandTotal,
        // Subtotal kept for backwards compatibility with existing Order schema
        // (it represents items minus discount, before delivery / platform / tax).
        subtotal: postDiscountSubtotal
    };
}

module.exports = { computeCharges };
