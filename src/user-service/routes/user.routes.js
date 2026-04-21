const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { verifyToken } = require('../../middleware/auth.middleware');

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User Management API
 */

/**
 * @swagger
 * /users:
 *   post:
 *     summary: Create a new account directly (Admin/Internal usage)
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mobile
 *               - userProfile
 *             properties:
 *               mobile:
 *                 type: string
 *               countryCode:
 *                 type: string
 *               isVendorCreated:
 *                 type: boolean
 *               userProfile:
 *                 type: object
 *                 properties:
 *                   firstname:
 *                     type: string
 *                   lastname:
 *                     type: string
 *                   email:
 *                     type: string
 *                   password:
 *                     type: string
 *     responses:
 *       201:
 *         description: Account created
 */
router.post('/', userController.createAccount);

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all accounts
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: List of accounts
 */
router.get('/', userController.getAccounts);

/**
 * @swagger
 * /users/{userId}/payment:
 *   get:
 *     summary: Get all payment methods for a user
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of payment methods
 */
router.get('/:userId/payment', userController.getPaymentMethods);

/**
 * @swagger
 * /users/{userId}/payment:
 *   post:
 *     summary: Add a new payment method
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - methodType
 *               - accountName
 *               - accountNumber
 *             properties:
 *               methodType:
 *                 type: string
 *                 enum: [CARD, UPI, BANK, WALLET]
 *               provider:
 *                 type: string
 *               accountName:
 *                 type: string
 *               accountNumber:
 *                 type: string
 *               expiryDate:
 *                 type: string
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Payment method added
 */
router.post('/:userId/payment', userController.addPaymentMethod);

/**
 * @swagger
 * /users/{userId}/payment/{paymentId}:
 *   put:
 *     summary: Update a payment method
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Payment method updated
 */
router.put('/:userId/payment/:paymentId', userController.updatePaymentMethod);

/**
 * @swagger
 * /users/{userId}/payment/{paymentId}:
 *   delete:
 *     summary: Delete a payment method
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment method deleted
 */
router.delete('/:userId/payment/:paymentId', userController.deletePaymentMethod);

router.post('/fcm-token', verifyToken, userController.saveFcmToken);

module.exports = router;
