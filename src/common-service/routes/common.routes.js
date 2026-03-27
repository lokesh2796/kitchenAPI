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

module.exports = router;