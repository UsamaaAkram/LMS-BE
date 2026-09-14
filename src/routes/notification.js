const express = require("express");
const jwtAuth = require("../middleware/jwtAuth");
const router = express.Router();

// Every route in this file requires a signed-in user. These endpoints were
// completely open: anyone on the internet could read and write them without
// a token. jwtAuth accepts student, instructor and admin tokens alike, and
// for students also enforces the active-session check behind Logout.
router.use(jwtAuth);

const Notification = require("../models/Notification");

// GET /api/notifications/:userId — the list (#2.16)
// ?unreadOnly=true for just unread, ?limit= to cap.
router.get("/:userId", async (req, res) => {
  try {
    const { unreadOnly, limit = 30 } = req.query;
    const q = { recipient: String(req.params.userId) };
    if (unreadOnly === "true") q.isRead = false;
    const capped = Math.min(Number(limit) || 30, 100);
    const items = await Notification.find(q)
      .sort({ createdAt: -1 })
      .limit(capped);
    const unreadCount = await Notification.countDocuments({
      recipient: String(req.params.userId),
      isRead: false,
    });
    res.json({ items, unreadCount });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/notifications/:userId/count — just the badge number, so the header
// can poll cheaply without pulling the whole list.
router.get("/:userId/count", async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: String(req.params.userId),
      isRead: false,
    });
    res.json({ unreadCount });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/notifications/:id/read — mark one read
router.patch("/:id/read", async (req, res) => {
  try {
    const n = await Notification.findByIdAndUpdate(
      req.params.id,
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    );
    if (!n) return res.status(404).json({ error: "Notification not found" });
    res.json(n);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/notifications/:userId/read-all — clear the badge
router.post("/:userId/read-all", async (req, res) => {
  try {
    const r = await Notification.updateMany(
      { recipient: String(req.params.userId), isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.json({ updated: r.modifiedCount ?? r.nModified ?? 0 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/notifications/:id — dismiss one
router.delete("/:id", async (req, res) => {
  try {
    const n = await Notification.findByIdAndDelete(req.params.id);
    if (!n) return res.status(404).json({ error: "Notification not found" });
    res.json({ message: "Dismissed", _id: n._id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
