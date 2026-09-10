const Student = require("../models/Student");
const Instructor = require("../models/Instructor");
const User = require("../models/User");

/**
 * #2.9 — turns @usernames into recipient ids so mentions can be notified.
 *
 * Mentions were being parsed and stored, but nobody was ever told they'd been
 * mentioned. The stored value is a username ("@Bilal"), and recipients live
 * across three collections with no shared parent, so each is looked up by its
 * own userName field.
 *
 * Case-insensitive and anchored: a mention of "@bilal" should find "Bilal", but
 * must not also match "bilal_2". The username is escaped before going into the
 * regex so a mention containing regex characters can't alter the query.
 *
 * @param {string[]} usernames
 * @returns {Promise<string[]>} unique recipient ids
 */
async function resolveMentions(usernames) {
  const names = [...new Set((usernames || []).filter(Boolean))];
  if (!names.length) return [];

  const patterns = names.map(
    (n) => new RegExp(`^${String(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
  );

  try {
    const [students, instructors, users] = await Promise.all([
      Student.find({ "student.userName": { $in: patterns } }).select("_id"),
      Instructor.find({ userName: { $in: patterns } }).select("_id"),
      User.find({ userName: { $in: patterns } }).select("_id"),
    ]);
    return [
      ...new Set(
        [...students, ...instructors, ...users].map((d) => String(d._id))
      ),
    ];
  } catch (err) {
    // A mention that can't be resolved must not fail the post itself.
    console.error("resolveMentions failed:", err.message);
    return [];
  }
}

module.exports = { resolveMentions };
