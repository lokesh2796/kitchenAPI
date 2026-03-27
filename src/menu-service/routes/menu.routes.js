const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menu.controller');
const { verifyToken } = require('../../middleware/auth.middleware');

// All menu routes require authentication
router.use(verifyToken);

/**
 * @swagger
 * tags:
 *   name: Menu
 *   description: Menu Management API (Masters, Today, Pre-Order)
 */

/**
 * @swagger
 * /menu/items:
 *   post:
 *     summary: Create a new Master Menu Item
 *     tags: [Menu]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - menuName
 *               - basePrice
 *             properties:
 *               menuName: { type: string }
 *               cuisine: { type: string }
 *               menuItemType: { type: array, items: { type: string } }
 *               coverPicture: { type: string }
 *               otherPictures: { type: array, items: { type: string } }
 *               basePrice: { type: number }
 *               ingredients: { type: array, items: { type: string } }
 *               aboutItem: { type: array, items: { type: string } }
 *               addOnsAvail: { type: boolean }
 *               maxAddonsAllowed: { type: number }
 *               addOns:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name: { type: string }
 *                     price: { type: number }
 *                     label: { type: string }
 *     responses:
 *       201:
 *         description: Menu item created
 */
router.post('/items', menuController.addMenuItem);

/**
 * @swagger
 * /menu/items:
 *   get:
 *     summary: Get all Master Menu Items for the logged-in Vendor
 *     tags: [Menu]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of menu items
 */
router.get('/items', menuController.getMenuItems);
router.put('/items/:id', menuController.updateMenuItem);
router.delete('/items/:id', menuController.deleteMenuItem);

// --- Today's Menu & Tomorrow's Menu ---
router.post('/today', menuController.addToTodayMenu);
router.get('/today', menuController.getTodayMenus);
router.put('/today/:id', menuController.updateTodayMenu);
router.delete('/today/:id', menuController.deleteTodayMenu);

// --- Explore / Public Menu ---
router.get('/explore', menuController.getExploreMenu);

// --- Pre-Order Menu ---
router.post('/preorder', menuController.addToPreOrderMenu);
router.get('/preorder', menuController.getPreOrderMenus);
router.put('/preorder/:id', menuController.updatePreOrderMenu);
router.delete('/preorder/:id', menuController.deletePreOrderMenu);

module.exports = router;
