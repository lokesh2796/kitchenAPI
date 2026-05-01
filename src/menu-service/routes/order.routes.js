const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const disputeController = require('../controllers/dispute.controller');
const { verifyToken } = require('../../middleware/auth.middleware');
const idempotency = require('../../middleware/idempotency.middleware');
const orderStateMachine = require('../../middleware/order-state-machine');
const Order = require('../models/order.model');

router.use(verifyToken);

// Place a new order — idempotency key prevents duplicate charges on retry
router.post('/', idempotency, orderController.placeOrder);

// Get all orders for the current user
router.get('/my', orderController.getUserOrders);

// Get all orders for the current vendor
router.get('/vendor', orderController.getVendorOrders);

// Update order status — state machine enforces legal transitions
router.patch('/:orderId/status', orderStateMachine(Order), orderController.updateOrderStatus);

// Dispute endpoints
router.post('/:orderId/dispute', disputeController.raiseDispute);
router.post('/:orderId/dispute/message', disputeController.sendDisputeMessage);
router.get('/:orderId/dispute/messages', disputeController.getDisputeMessages);
router.post('/:orderId/dispute/refund-offer', disputeController.offerRefund);
router.post('/:orderId/dispute/refund-response', disputeController.respondToRefund);

// Chat endpoints
router.get('/:orderId/chat', orderController.getChatMessages);
router.post('/:orderId/chat', orderController.sendChatMessage);
router.get('/:orderId/chat/unread', orderController.getChatUnreadCount);

// ── Vendor acceptance endpoints ───────────────────────────────────────────────
// POST /orders/:orderId/accept  — vendor confirms within acceptance window
router.post('/:orderId/accept', orderController.acceptOrder);
// POST /orders/:orderId/reject  — vendor declines; triggers immediate reassignment
router.post('/:orderId/reject', orderController.rejectOrder);
// GET  /orders/:orderId/assignment — vendor dashboard polls acceptance countdown
router.get('/:orderId/assignment', orderController.getAssignmentStatus);

module.exports = router;
