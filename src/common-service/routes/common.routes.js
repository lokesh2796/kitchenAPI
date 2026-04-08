const express = require('express');
const router = express.Router();
const commonController = require('../controllers/location.controller');
/**
 * @swagger
 * tags:
 *   name: Common
 *   description: Common Utility API
 */

/**
 * @swagger
 * /common/health:
 *   get:
 *     summary: Check service health
 *     tags: [Common]
 *     responses:
 *       200:
 *         description: Service is working
 */
router.get('/health', (req, res) => {
    res.send('COMMON SERVICE WORKING');
});

/**
 * @swagger
 * /common/location:
 *   post:
 *     summary: Get Address from Lat/Long (Reverse Geocoding)
 *     tags: [Common]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - latitude
 *               - longitude
 *             properties:
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       200:
 *         description: Address details found
 *       400:
 *         description: Missing coordinates
 */
const uploadMiddleware = require('../../middleware/upload.middleware');
const uploadController = require('../controllers/upload.controller');

router.post('/location', commonController.findLocation);

/**
 * @swagger
 * /common/upload:
 *   post:
 *     summary: Upload a file (Image)
 *     tags: [Common]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: File uploaded successfully
 */
router.post('/upload', uploadMiddleware.single('file'), uploadController.uploadFile);

// ──────────────────────────────────────────────────────────────
// LOOKUP ROUTES — serves all status/enum/lookup values from DB
// ──────────────────────────────────────────────────────────────
const lookupController = require('../controllers/lookup.controller');

/**
 * @swagger
 * /common/lookup:
 *   get:
 *     summary: Get all lookup values grouped by category
 *     tags: [Common]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Filter by single category (e.g. order_status)
 *       - in: query
 *         name: flat
 *         schema: { type: boolean }
 *         description: Return as flat array instead of grouped
 *     responses:
 *       200:
 *         description: Lookup values returned
 */
router.get('/lookup', lookupController.getAllLookups);

/**
 * @swagger
 * /common/lookup/categories/list:
 *   get:
 *     summary: Get list of all distinct lookup categories
 *     tags: [Common]
 */
router.get('/lookup/categories/list', lookupController.getCategories);

/**
 * @swagger
 * /common/lookup/{category}:
 *   get:
 *     summary: Get all lookup values for a specific category
 *     tags: [Common]
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema: { type: string }
 */
router.get('/lookup/:category', lookupController.getLookupByCategory);

module.exports = router;