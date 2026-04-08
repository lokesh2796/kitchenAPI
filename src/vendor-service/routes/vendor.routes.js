const express = require('express');
const router = express.Router();
const { verifyToken, isVendor } = require('../../middleware/auth.middleware');
const vendorProfileController = require('../controllers/vendorProfile.controller');

// Authentication is required on every vendor route — but the `isVendor`
// gate is applied per-route below. Step 1 must remain reachable to a
// buyer-only user so they can actually start (and complete) onboarding,
// since saving step 1 is exactly the moment that promotes them to vendor.
router.use(verifyToken);

/**
 * @swagger
 * tags:
 *   name: Vendor
 *   description: Vendor Onboarding Steps 1-6
 */

// --- Step 1 (open to any authenticated user — promotion point) ---
router.post('/step1', vendorProfileController.updateStep1);
router.put('/step1', vendorProfileController.updateStep1);
router.get('/step1', vendorProfileController.getMyVendorProfile);

// --- Step 2 ---
router.post('/step2', isVendor, vendorProfileController.updateStep2);
router.put('/step2', isVendor, vendorProfileController.updateStep2);
router.get('/step2', isVendor, vendorProfileController.getMyVendorProfile);

// --- Step 3 ---
router.post('/step3', isVendor, vendorProfileController.updateStep3);
router.put('/step3', isVendor, vendorProfileController.updateStep3);
router.get('/step3', isVendor, vendorProfileController.getMyVendorProfile);

// --- Step 4 ---
router.post('/step4', isVendor, vendorProfileController.updateStep4);
router.put('/step4', isVendor, vendorProfileController.updateStep4);
router.get('/step4', isVendor, vendorProfileController.getMyVendorProfile);

// --- Step 5 ---
router.post('/step5', isVendor, vendorProfileController.updateStep5);
router.put('/step5', isVendor, vendorProfileController.updateStep5);
router.get('/step5', isVendor, vendorProfileController.getMyVendorProfile);

// --- Step 6 ---
router.post('/step6', isVendor, vendorProfileController.updateStep6);
router.put('/step6', isVendor, vendorProfileController.updateStep6);
router.get('/step6', isVendor, vendorProfileController.getMyVendorProfile);

// --- Kitchen Toggle ---
router.post('/toggle-kitchen', isVendor, vendorProfileController.toggleKitchen);

// --- Onboarding Progress ---
router.get('/progress', isVendor, vendorProfileController.getOnboardingProgress);

module.exports = router;
