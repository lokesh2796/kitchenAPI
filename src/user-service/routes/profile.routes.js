const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profile.controller');
const { verifyToken } = require('../../middleware/auth.middleware');

router.use(verifyToken);

/**
 * @swagger
 * tags:
 *   name: Profile
 *   description: User Profile & Address Management
 */

/**
 * @swagger
 * /users/profile:
 *   get:
 *     summary: Get Current User Profile (with Addresses)
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     description: Returns different addresses based on Active Role (Vendor = Business Only, User = All + Business)
 *     responses:
 *       200:
 *         description: Profile data
 */
router.get('/profile', profileController.getProfile);

/**
 * @swagger
 * /users/profile:
 *   put:
 *     summary: Update User Profile (Name)
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstname: { type: string }
 *               lastname: { type: string }
 *     responses:
 *       200:
 *         description: Updated successfully
 */
router.put('/profile', profileController.updateProfile);

/**
 * @swagger
 * /users/address:
 *   post:
 *     summary: Add New Address
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label: { type: string, example: "Home" }
 *               addressLine: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               zipCode: { type: string }
 *               mobile: { type: string }
 *               isDefault: { type: boolean }
 *     responses:
 *       201:
 *         description: Address added
 */
router.post('/address', profileController.addAddress);

/**
 * @swagger
 * /users/address/{addressId}:
 *   put:
 *     summary: Edit Address
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label: { type: string }
 *               addressLine: { type: string }
 *               city: { type: string }
 *               isDefault: { type: boolean }
 *     responses:
 *       200:
 *         description: Address updated
 */
router.put('/address/:addressId', profileController.editAddress);

/**
 * @swagger
 * /users/address/{addressId}:
 *   delete:
 *     summary: Delete Address
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: addressId
 *         required: true
 *     responses:
 *       200:
 *         description: Address deleted
 */
router.delete('/address/:addressId', profileController.deleteAddress);

/**
 * @swagger
 * /users/switch-role:
 *   post:
 *     summary: Switch Active Role (USER / VENDOR)
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [USER, VENDOR]
 *     responses:
 *       200:
 *         description: Role switched successfully
 */
/**
 * @swagger
 * /users/change-password:
 *   post:
 *     summary: Change User Password
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - oldPassword
 *               - newPassword
 *             properties:
 *               oldPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       401:
 *         description: Invalid old password
 *       404:
 *         description: User not found
 */
router.post('/switch-role', profileController.switchRole);
router.post('/change-password', profileController.changePassword);

/**
 * @swagger
 * /users/payment:
 *   post:
 *     summary: Add Payment Method
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               methodType: { type: string, example: "CARD" }
 *               provider: { type: string, example: "Visa" }
 *               accountName: { type: string }
 *               accountNumber: { type: string }
 *               expiryDate: { type: string }
 *               isDefault: { type: boolean }
 *     responses:
 *       201:
 *         description: Payment method added
 */
router.post('/payment', profileController.addPaymentMethod);

/**
 * @swagger
 * /users/payment/{paymentId}:
 *   put:
 *     summary: Edit Payment Method
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               accountName: { type: string }
 *               isDefault: { type: boolean }
 *     responses:
 *       200:
 *         description: Payment method updated
 */
router.put('/payment/:paymentId', profileController.editPaymentMethod);

/**
 * @swagger
 * /users/payment/{paymentId}:
 *   delete:
 *     summary: Delete Payment Method
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *     responses:
 *       200:
 *         description: Payment method deleted
 */
router.delete('/payment/:paymentId', profileController.deletePaymentMethod);

/**
 * @swagger
 * /users/addresses:
 *   get:
 *     summary: Get All User Addresses
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of addresses
 */
router.get('/addresses', profileController.getAddresses);

/**
 * @swagger
 * /users/payment-methods:
 *   get:
 *     summary: Get All User Payment Methods
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of payment methods
 */
router.get('/payment-methods', profileController.getPaymentMethods);

/**
 * @swagger
 * /users/address/{addressId}:
 *   get:
 *     summary: Get Single Address By ID
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: addressId
 *         required: true
 *     responses:
 *       200:
 *         description: Address data
 */
router.get('/address/:addressId', profileController.getAddressById);

/**
 * @swagger
 * /users/addresses/bulk:
 *   post:
 *     summary: Get Multiple Addresses By IDs
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: List of filtered addresses
 */
router.post('/addresses/bulk', profileController.getAddressesByIds);

/**
 * @swagger
 * /users/payment/{paymentId}:
 *   get:
 *     summary: Get Single Payment Method By ID
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *     responses:
 *       200:
 *         description: Payment data
 */
router.get('/payment/:paymentId', profileController.getPaymentMethodById);

/**
 * @swagger
 * /users/payments/bulk:
 *   post:
 *     summary: Get Multiple Payment Methods By IDs
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: List of filtered payment methods
 */
router.post('/payments/bulk', profileController.getPaymentMethodsByIds);

/**
 * @swagger
 * /users/change-mobile/initiate:
 *   post:
 *     summary: Initiate Mobile Number Change
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newMobile
 *             properties:
 *               newMobile: { type: string }
 *     responses:
 *       200:
 *         description: OTP sent to new mobile
 *       400:
 *         description: Invalid input or 30-day restriction
 */
router.post('/change-mobile/initiate', profileController.initiateMobileChange);

/**
 * @swagger
 * /users/change-mobile/verify:
 *   post:
 *     summary: Verify Mobile Number Change OTP
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - otp
 *             properties:
 *               otp: { type: string }
 *     responses:
 *       200:
 *         description: Mobile number updated successfully
 *       400:
 *         description: Invalid or expired OTP
 */
router.post('/change-mobile/verify', profileController.verifyMobileChangeOtp);

module.exports = router;
