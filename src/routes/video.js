const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Student = require("../models/Student");
const Course = require("../models/Course");
const jwtAuth = require("../middleware/jwtAuth");
const { checkPlanExpiry } = require("../utils/courseAccess");

// POST /api/videos/:videoId/otp
// Returns a short-lived VdoCipher OTP + playbackInfo for the secure player.
// - Requires a valid JWT.
// - Students must be enrolled in the course that contains the video.
// - Stamps a per-viewer email watermark onto playback (traces any leak).
router.post("/:videoId/otp", jwtAuth, async (req, res) => {
  try {
    const secret = process.env.VDOCIPHER_API_SECRET;
    if (!secret) {
      return res
        .status(500)
        .json({ error: "VDOCIPHER_API_SECRET is not configured on the server" });
    }

    const { videoId } = req.params;
    const { courseId } = req.body || {};

    // Enrollment gate — only students are restricted; instructors/admins pass.
    if (req.user.role === "student") {
      if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
        return res.status(400).json({ error: "A valid courseId is required" });
      }
      const course = await Course.findById(courseId);
      if (!course) return res.status(404).json({ error: "Course not found" });
      if (!course.freeAccess) {
        const student = await Student.findById(req.user.id);
        if (!student)
          return res.status(404).json({ error: "Student not found" });
        const enrolled = (student.enrolledCourses || []).some(
          (c) => c.toString() === courseId.toString()
        );
        if (!enrolled) {
          return res.status(403).json({ error: "Not enrolled in this course" });
        }

        // #47.9 — a time-limited plan that has run out. Checked AFTER the
        // enrollment gate above, which is unchanged: this only removes access
        // from someone whose paid window has genuinely elapsed. Lifetime plans
        // and admin-enrolled students are never affected.
        const { expired, expiresAt } = await checkPlanExpiry(
          req.user.id,
          courseId
        );
        if (expired) {
          return res.status(403).json({
            error: "Your access to this course expired on " +
              expiresAt.toISOString().slice(0, 10) +
              ". Renew to continue watching.",
            code: "ACCESS_EXPIRED",
          });
        }
      }
    }

    // Dynamic watermark = the viewer's email (traces any leak)
    const watermark = JSON.stringify([
      {
        type: "rtext",
        text: req.user.email || "Bluverse Digital Hub",
        alpha: "0.60",
        color: "0xFFFFFF",
        size: "16",
        interval: "6000",
      },
    ]);

    const resp = await fetch(
      `https://dev.vdocipher.com/api/videos/${videoId}/otp`,
      {
        method: "POST",
        headers: {
          Authorization: `Apisecret ${secret}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ ttl: 300, annotate: watermark }),
      }
    );

    const data = await resp.json();
    if (!resp.ok) {
      return res
        .status(resp.status)
        .json({ error: data.message || "Failed to get playback token" });
    }

    return res.json({ otp: data.otp, playbackInfo: data.playbackInfo });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
