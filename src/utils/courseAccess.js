const EnrollmentRequest = require("../models/EnrollmentRequest");

/**
 * #47.9 — has a time-limited plan run out?
 *
 * Plan expiry was being STORED but never checked: a "3 Months Access" purchase
 * wrote an expiry date, showed it to the student, and then granted access
 * forever. This is the check that makes the date mean something.
 *
 * Deliberately additive. The existing gate — "is this course in
 * Student.enrolledCourses" — is untouched and still decides access. This only
 * ever takes access AWAY, and only when all of the following hold:
 *
 *   - an approved enrollment request exists for this student + course, AND
 *   - that request carries an expiry date (lifetime plans store null), AND
 *   - the date has passed.
 *
 * Students enrolled by an admin directly (no request record) and lifetime plans
 * are unaffected, so nothing that worked before stops working.
 *
 * @returns {Promise<{expired: boolean, expiresAt?: Date, requestId?: string}>}
 */
async function checkPlanExpiry(studentId, courseId) {
  if (!studentId || !courseId) return { expired: false };
  try {
    // Newest approved request wins: a student who renews gets a second
    // approved record, and the latest one is the one that governs access.
    const req = await EnrollmentRequest.findOne({
      studentId: String(studentId),
      course: courseId,
      status: "Approved",
    })
      .sort({ approvedAt: -1, createdAt: -1 })
      .select("accessExpiresAt requestId");

    if (!req || !req.accessExpiresAt) return { expired: false };
    if (req.accessExpiresAt.getTime() > Date.now()) {
      return { expired: false, expiresAt: req.accessExpiresAt };
    }
    return {
      expired: true,
      expiresAt: req.accessExpiresAt,
      requestId: req.requestId,
    };
  } catch (err) {
    // A lookup failure must never lock a paying student out of content they
    // legitimately bought — fail open and log it.
    console.error("checkPlanExpiry failed:", err.message);
    return { expired: false };
  }
}

module.exports = { checkPlanExpiry };
