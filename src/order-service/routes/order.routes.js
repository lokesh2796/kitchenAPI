const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');

// Order Operations
router.post('/place', orderController.placeOrder);
router.get('/customer/:customerId', orderController.getCustomerOrders);
router.get('/vendor/:vendorId', orderController.getVendorOrders);
router.patch('/:orderId/status', orderController.updateStatus);

module.exports = router;
