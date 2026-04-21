const express = require("express");
const { generateToken, notifyVendor, notifyUser } = require("../../utils/beams.service");
const router = express.Router();

// Generate Beams auth token for a user (called by mobile app after login)
router.post("/beams/token", async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: "user_id is required" });
    const token = generateToken(user_id);
    if (!token) return res.status(503).json({ error: "Beams not configured" });
    res.json(token);
  } catch (error) {
    console.error("[Beams] Token generation failed:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// Send push to a vendor (called internally from order controller)
router.post("/notify/vendor/:vendorId", async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { title, body, data = {} } = req.body;
    await notifyVendor(vendorId, title, body, data);
    res.json({ success: true });
  } catch (error) {
    console.error("[Beams] Vendor notify failed:", error);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

// Send push to a user (called internally from order controller)
router.post("/notify/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { title, body, data = {} } = req.body;
    await notifyUser(userId, title, body, data);
    res.json({ success: true });
  } catch (error) {
    console.error("[Beams] User notify failed:", error);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

module.exports = router;
