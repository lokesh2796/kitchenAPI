const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication API
 */

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user and send OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mobile
 *               - email
 *               - password
 *               - firstname
 *               - lastname
 *             properties:
 *               mobile:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               firstname:
 *                 type: string
 *               lastname:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: User already exists or invalid input
 */
router.post('/register', authController.initiateRegistration);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Unified Login (OTP or Password)
 *     tags: [Auth]
 *     description: Send mobile to get OTP OR send email+password to get Token directly.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mobile:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               deviceType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful (Password) or OTP sent (Mobile)
 *       404:
 *         description: User not found
 */
router.post('/login', authController.login);

/**
 * @swagger
 * /auth/resend-otp:
 *   post:
 *     summary: Resend OTP to mobile and email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mobile
 *             properties:
 *               mobile:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP resent successfully
 *       404:
 *         description: User not found
 */
router.post('/resend-otp', authController.resendOtp);

/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Verify OTP (Handles both Sign-In and Sign-Up)
 *     description: Verifies the 6-digit OTP. If user was unverified, it activates the account (Sign-Up). If already verified, it simply logs them in (Sign-In). Returning 'flow' will indicate the logic path.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mobile
 *               - otp
 *             properties:
 *               mobile:
 *                 type: string
 *               otp:
 *                 type: string
 *               deviceType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Invalid OTP or expired
 */
router.post('/verify-otp', authController.verifyOtp);


/**
 * @swagger
 * /auth/validate-token:
 *   get:
 *     summary: Check if token is valid and get user status
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token valid
 *       401:
 *         description: Invalid or expired token
 */
router.get('/validate-token', authController.validateToken);

/**
 * @swagger
 * /auth/social-login:
 *   post:
 *     summary: Social login (Google / Facebook / Apple)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, idToken, email]
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [google, facebook, apple]
 *               idToken:
 *                 type: string
 *               email:
 *                 type: string
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful, returns JWT token
 */
router.post('/social-login', authController.socialLogin);

module.exports = router;
