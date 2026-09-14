const express = require("express");
const jwtAuth = require("../middleware/jwtAuth");
const requireSelfOrStaff = require("../middleware/requireSelfOrStaff");
const router = express.Router();


// Anyone signed in could read another account's notifications.
// router.param fires for every route carrying :userId, so this covers all
// of them in one place — including the multi-segment paths — and any route
// added later inherits it automatically instead of being forgotten.
router.param("userId", requireSelfOrStaff("userId"));

const STAFF = ["admin", "superadmin", "super-admin", "instructor", "teacher"];
/**
 * Restricts a query to the caller's own notifications. Staff are unrestricted,
 * so moderation tooling keeps working. Returns a query fragment rather than a
 * boolean so the ownership test happens IN the database query — there is then
 * no window where the row is fetched before the check.
 */
const recipientScope = (req) =>
  STAFF.includes(String(req.user?.role || "").toLowerCase())
    ? {}
    : { recipient: String(req.user?.id || "") };

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
    // Scoped by recipient as part of the query rather than checked after the
    // fact: addressing by id alone let any signed-in user mark somebody else's
    // notifications read. A non-owner now simply matches nothing.
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...recipientScope(req) },
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
    const n = await Notification.findOneAndDelete({
      _id: req.params.id,
      ...recipientScope(req),
    });
    if (!n) return res.status(404).json({ error: "Notification not found" });
    res.json({ message: "Dismissed", _id: n._id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
