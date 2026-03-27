const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cart.controller');
const { verifyToken } = require('../../middleware/auth.middleware');
router.use(verifyToken);

// All cart routes are protected — verifyToken sets req.userId
router.post('/add', cartController.addToCart);
router.get('/', cartController.getCart);       // GET /cart
router.delete('/item/:itemId', cartController.removeCartItem); // DELETE /cart/item/:itemId
router.delete('/', cartController.clearCart);      // DELETE /cart
router.patch('/payment', cartController.updatePayment);  // PATCH /cart/payment

module.exports = router;
