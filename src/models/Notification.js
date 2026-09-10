const mongoose = require("mongoose");

// #2.16 / #27.10 / #43.8 / #47.12 — the notification centre.
//
// Until now "notifications" were toast messages: they existed only in the tab
// that triggered them and were gone on refresh. Anything the doc describes
// (unread badges, a notification list, "you were mentioned") needs a persisted
// record per recipient, which is what this is.
//
// recipient is a plain string id, not a ref: recipients span the User,
// Instructor and Student collections and there is no single model to populate
// from (same reason Ticket denormalizes createdByName).

const TYPES = [
  "enrollment_submitted",
  "enrollment_approved",
  "enrollment_rejected",
  "assignment_submitted",
  "assignment_reviewed",
  "quiz_graded",
  "ticket_reply",
  "ticket_resolved",
  "community_mention",
  "community_reply",
  "announcement",
  "order_status",
  // Split from order_status so the bell can mark an actual handover
  // differently from the routine "we are processing it" updates.
  "order_delivered",
  "system",
];

const NotificationSchema = new mongoose.Schema(
  {
    recipient: { type: String, required: true, index: true },
    type: { type: String, enum: TYPES, default: "system" },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    /** In-app path to open when the notification is clicked. */
    link: { type: String, default: "" },
    /** Who or what caused it — shown as "from" in the list. */
    actorName: { type: String, default: "" },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The list query is always "mine, newest first"; the badge is "mine, unread".
NotificationSchema.index({ recipient: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, isRead: 1 });

NotificationSchema.statics.TYPES = TYPES;

module.exports = mongoose.model("Notification", NotificationSchema);
