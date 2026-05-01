const express = require("express");
const { sendToUser, sendToVendor } = require("../../utils/firebase-fcm.service");
const Users = require("../../models/users.model");
const router = express.Router();

// ── Debug: Test FCM push to a specific user by their userId ─────────────────
// POST /pusher/test-push  { userId, role }
// Call this from curl/Postman to verify FCM works end-to-end without an order
router.post("/test-push", async (req, res) => {
  try {
    const { userId, role = "vendor" } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    // Show what token is stored for this user
    const user = await Users.findById(userId).select("fcmToken firstName");
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.fcmToken) {
      return res.status(200).json({
        success: false,
        message: `No fcmToken stored for user ${user.firstName} (${userId}). The mobile app has not saved an FCM token yet.`,
      });
    }

    if (role === "vendor") {
      await sendToVendor(userId, "🔔 Test Push!", "FCM is working for vendor ✓", {
        type: "new_order",
        orderId: "TEST",
      });
    } else {
      await sendToUser(userId, "🔔 Test Push!", "FCM is working for user ✓", {
        type: "status_update",
        status: "confirmed",
        orderId: "TEST",
      });
    }

    res.json({
      success: true,
      message: `Push sent to ${user.firstName}`,
      tokenPreview: user.fcmToken.substring(0, 30) + "...",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Debug: Check what FCM token is stored for a user ────────────────────────
// GET /pusher/check-token/:userId
router.get("/check-token/:userId", async (req, res) => {
  try {
    const user = await Users.findById(req.params.userId).select("fcmToken firstName phone");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({
      userId: req.params.userId,
      name: user.firstName,
      hasFcmToken: !!user.fcmToken,
      tokenPreview: user.fcmToken ? user.fcmToken.substring(0, 40) + "..." : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
