/**
 * Vendor onboarding completion helper.
 *
 * Historically the codebase checked `profile.stepCompleted.stepN === true`
 * directly, but that flag wasn't always persisted (older data, partial
 * migrations). Real completeness is whether the underlying data exists
 * (`businessName`, `vendorAck.payment`, etc.). Every reader should go through
 * this helper so the rules live in exactly one place.
 *
 * The setters in vendorstep1..6 / vendorProfile controllers still write
 * `stepCompleted.stepN = true` — those writes are fine, they just become a
 * cache that this helper falls back through.
 */

function computeStepCompletion(profile) {
    if (!profile) {
        return {
            steps: { step1: false, step2: false, step3: false, step4: false, step5: false, step6: false },
            allCompleted: false,
            completedCount: 0
        };
    }

    const dbSteps = profile.stepCompleted || {};
    const ack = profile.vendorAck || {};

    const steps = {
        step1: !!(dbSteps.step1 || profile.businessName),
        step2: !!(dbSteps.step2 || ack.payment),
        step3: !!(dbSteps.step3 || ack.cancellation),
        step4: !!(dbSteps.step4 || ack.delivery),
        step5: !!(dbSteps.step5 || ack.refund),
        step6: !!(dbSteps.step6 || ack.terms)
    };

    const completedCount = Object.values(steps).filter(Boolean).length;
    const allCompleted = completedCount === 6;

    return { steps, allCompleted, completedCount };
}

module.exports = { computeStepCompletion };
