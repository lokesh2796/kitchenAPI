const express = require('express');
const router = express.Router();
const { verifyToken, isVendor } = require('../../middleware/auth.middleware');
const vendorProfileController = require('../controllers/vendorProfile.controller');

// Apply Middleware globally
router.use(verifyToken, isVendor);

/**
 * @swagger
 * tags:
 *   name: Vendor
 *   description: Vendor Onboarding Steps 1-6
 */

// --- Step 1 ---
router.post('/step1', vendorProfileController.updateStep1);
router.put('/step1', vendorProfileController.updateStep1);
router.get('/step1', vendorProfileController.getMyVendorProfile);

// --- Step 2 ---
router.post('/step2', vendorProfileController.updateStep2);
router.put('/step2', vendorProfileController.updateStep2);
router.get('/step2', vendorProfileController.getMyVendorProfile);

// --- Step 3 ---
router.post('/step3', vendorProfileController.updateStep3);
router.put('/step3', vendorProfileController.updateStep3);
router.get('/step3', vendorProfileController.getMyVendorProfile);

// --- Step 4 ---
router.post('/step4', vendorProfileController.updateStep4);
router.put('/step4', vendorProfileController.updateStep4);
router.get('/step4', vendorProfileController.getMyVendorProfile);

// --- Step 5 ---
router.post('/step5', vendorProfileController.updateStep5);
router.put('/step5', vendorProfileController.updateStep5);
router.get('/step5', vendorProfileController.getMyVendorProfile);

// --- Step 6 ---
router.post('/step6', vendorProfileController.updateStep6);
router.put('/step6', vendorProfileController.updateStep6);
router.get('/step6', vendorProfileController.getMyVendorProfile);

module.exports = router;
