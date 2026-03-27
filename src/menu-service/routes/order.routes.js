const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { verifyToken } = require('../../middleware/auth.middleware');

router.use(verifyToken);
// Place a new order
router.post('/', orderController.placeOrder);

// Get all orders for the current user
router.get('/my', orderController.getUserOrders);

// Get all orders for the current vendor
router.get('/vendor', orderController.getVendorOrders);

// Update order status
router.patch('/:orderId/status', orderController.updateOrderStatus);

module.exports = router;
