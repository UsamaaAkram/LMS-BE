const Notification = require("../models/Notification");

/**
 * Creates notifications. Called from inside request handlers, so it is
 * deliberately best-effort: a notification failing must never fail the action
 * that triggered it (approving an enrolment, posting a reply). Errors are
 * logged and swallowed.
 *
 * @param {string|string[]} recipients  one or many recipient ids
 * @param {object} payload             { type, title, body, link, actorName }
 * @param {object} [io]                socket.io server, to push live
 */
async function notify(recipients, payload, io) {
  try {
    const ids = (Array.isArray(recipients) ? recipients : [recipients])
      .map((r) => (r == null ? "" : String(r)))
      .filter(Boolean);
    // De-duplicate: the actor is often also a participant, and nobody should
    // get two copies (or be notified about their own action).
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const created = await Notification.insertMany(
      unique.map((recipient) => ({ recipient, ...payload }))
    );

    // Push to any devices the recipient has open, so the badge updates without
    // waiting for the next poll. Optional: `io` is passed in by callers that
    // have it, and its absence must not break notification creation.
    if (io) {
      created.forEach((n) => {
        try {
          io.to(`user:${n.recipient}`).emit("notification", n);
        } catch (e) {
          console.error("notification push failed:", e.message);
        }
      });
    }
    return created;
  } catch (err) {
    console.error("notify failed:", err.message);
    return [];
  }
}

module.exports = { notify };
