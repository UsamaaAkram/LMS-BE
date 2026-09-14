const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const router = express.Router();

const jwtAuth = require("../middleware/jwtAuth");
const requireRole = require("../middleware/requireRole");
const staffOnly = [jwtAuth, requireRole("admin", "instructor")];
const optionalAuth = require("../middleware/optionalAuth");

const upload = multer();

const EnrollmentRequest = require("../models/EnrollmentRequest");
const Course = require("../models/Course");
const Student = require("../models/Student");
const { sendEnrollmentConfirmedEmail, sendMail } = require("../utils/mailer");
const { notify } = require("../utils/notify");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const s3Client = new S3Client({
  region: "ap-southeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = "bluverse-lms";

async function uploadScreenshotToS3(file) {
  const key = `enrollment-payments/${Date.now()}-${file.originalname}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return {
    url: `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${key}`,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
  };
}

// ENR-<year>-<6 digits>. Retried on collision rather than trusting randomness,
// since requestId is unique-indexed and a clash would 500 the submission.
async function generateRequestId() {
  const year = new Date().getFullYear();
  for (let i = 0; i < 8; i++) {
    const num = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    const candidate = `ENR-${year}-${num}`;
    if (!(await EnrollmentRequest.exists({ requestId: candidate }))) {
      return candidate;
    }
  }
  // Astronomically unlikely; fall back to something guaranteed unique.
  return `ENR-${year}-${Date.now()}`;
}

function pushHistory(doc, to, actor = {}, reason = "") {
  doc.statusHistory.push({
    from: doc.status,
    to,
    byName: actor.name || "",
    byEmail: actor.email || "",
    byRole: actor.role || "",
    reason,
  });
  doc.status = to;
}

// ---------------------------------------------------------------------------
// POST /api/enrollments — submit an enrollment request (#47.2)
//
// Free-access courses skip payment entirely and are granted immediately.
// Paid courses are recorded as "Pending Verification" and grant NOTHING until
// an admin approves (#47.16: payment submission != course access).
// ---------------------------------------------------------------------------
router.post("/", upload.single("paymentScreenshot"), async (req, res) => {
  try {
    const {
      studentId,
      firstName,
      lastName,
      email,
      whatsapp,
      courseId,
      planName,
      invoiceNumber,
      paymentMethod,
      transactionId,
      paymentNote,
    } = req.body || {};

    if (!firstName || !email || !courseId) {
      return res
        .status(400)
        .json({ error: "First name, email and course are required." });
    }
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: "A valid course is required." });
    }
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    // Snapshot the chosen plan so later plan edits can't rewrite history.
    const plan = (course.plans || []).find(
      (p) => p.name === planName && p.isActive !== false
    );
    if (planName && !plan) {
      return res
        .status(400)
        .json({ error: "That plan is not available for this course." });
    }

    const isFree = !!course.freeAccess;

    // Paid courses must carry proof; free ones must not be asked for it.
    if (!isFree) {
      if (!paymentMethod || !transactionId) {
        return res.status(400).json({
          error: "Payment method and transaction ID are required.",
        });
      }
      if (!req.file) {
        return res
          .status(400)
          .json({ error: "A payment screenshot is required." });
      }
    }

    // One live request per student per course, so a double-submit doesn't
    // create two records an admin then has to reconcile.
    if (studentId) {
      const open = await EnrollmentRequest.findOne({
        studentId,
        course: courseId,
        status: { $in: ["Pending Verification", "Under Review", "Payment Verified"] },
      });
      if (open) {
        return res.status(409).json({
          error: "You already have a request in progress for this course.",
          requestId: open.requestId,
        });
      }
    }

    const screenshot =
      !isFree && req.file ? await uploadScreenshotToS3(req.file) : null;

    const doc = new EnrollmentRequest({
      requestId: await generateRequestId(),
      studentId: studentId || "",
      firstName,
      lastName: lastName || "",
      email,
      whatsapp: whatsapp || "",
      course: courseId,
      courseTitle: course.courseTitle || "",
      planName: plan ? plan.name : planName || "",
      planPrice: plan ? plan.price : "",
      planAccessDays: plan ? plan.accessDays ?? null : null,
      invoiceNumber: invoiceNumber || "",
      paymentMethod: isFree ? "" : paymentMethod,
      transactionId: isFree ? "" : transactionId,
      paymentScreenshot: screenshot,
      paymentNote: paymentNote || "",
      isFreeEnrollment: isFree,
      status: isFree ? "Approved" : "Pending Verification",
    });

    doc.statusHistory.push({
      to: doc.status,
      byName: `${firstName} ${lastName || ""}`.trim(),
      byEmail: email,
      byRole: "student",
      reason: isFree ? "Free-access course — granted immediately" : "Submitted",
    });

    // Free courses grant access right away (#47.15).
    if (isFree && studentId && mongoose.Types.ObjectId.isValid(studentId)) {
      doc.approvedAt = new Date();
      doc.accessStartAt = new Date();
      await Student.updateOne(
        { _id: studentId },
        { $addToSet: { enrolledCourses: courseId } }
      );
    }

    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/enrollments — admin queue, with the filters from #47.6
// The review queue — staff only.
router.get("/", staffOnly, async (req, res) => {
  try {
    const { status, courseId, search, paymentMethod } = req.query;
    const q = {};
    if (status) q.status = status;
    if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
      q.course = courseId;
    }
    if (paymentMethod) q.paymentMethod = paymentMethod;
    if (search) {
      const rx = { $regex: String(search).trim(), $options: "i" };
      q.$or = [
        { requestId: rx },
        { firstName: rx },
        { lastName: rx },
        { email: rx },
        { transactionId: rx },
        { courseTitle: rx },
        { whatsapp: rx },
      ];
    }
    const items = await EnrollmentRequest.find(q).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/enrollments/my/:studentId — the student's own "My Enrollments" (#47.10)
// A student's own requests.
router.get("/my/:studentId", jwtAuth, async (req, res) => {
  try {
    const items = await EnrollmentRequest.find({
      studentId: req.params.studentId,
    }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/enrollments/ref/:requestId — status page lookup by human reference
router.get("/ref/:requestId", optionalAuth, async (req, res) => {
  try {
    const doc = await EnrollmentRequest.findOne({
      requestId: req.params.requestId,
    });
    if (!doc) return res.status(404).json({ error: "Request not found" });

    // Staff get the whole record. For everyone else this is a status-only
    // projection: the route has to stay public (someone enrolling has no
    // account yet), references are sequential and therefore guessable, and the
    // full document carries the payment screenshot, transaction id, personal
    // details and the internal review history. Anyone counting upwards from
    // ENR-2026-000001 would have walked the lot.
    const viewerIsStaff =
      !!req.user && ["admin", "instructor"].includes(String(req.user.role));
    if (viewerIsStaff) return res.json(doc);

    res.json({
      requestId: doc.requestId,
      course: doc.course,
      courseTitle: doc.courseTitle,
      planName: doc.planName,
      status: doc.status,
      rejectionReason: doc.rejectionReason,
      isFreeEnrollment: doc.isFreeEnrollment,
      accessStartAt: doc.accessStartAt,
      accessExpiresAt: doc.accessExpiresAt,
      createdAt: doc.createdAt,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/enrollments/:id/status — Under Review / Cancelled etc. (#47.11)
// Staff only.
router.patch("/:id/status", staffOnly, async (req, res) => {
  try {
    const { status, actor } = req.body || {};
    if (!EnrollmentRequest.STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }
    // Approval and rejection have their own endpoints because they carry side
    // effects (granting access, sending mail); this one is for plain moves.
    if (["Approved", "Payment Rejected"].includes(status)) {
      return res.status(400).json({
        error: "Use the approve or reject endpoint for this transition.",
      });
    }
    const doc = await EnrollmentRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Request not found" });
    if (doc.status === "Approved") {
      return res
        .status(400)
        .json({ error: "This request is already approved." });
    }
    pushHistory(doc, status, actor || {});
    await doc.save();
    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/enrollments/:id/approve — verify payment and grant access (#47.7/8/9)
// Grants course access — staff only.
router.post("/:id/approve", staffOnly, async (req, res) => {
  try {
    const { actor } = req.body || {};
    const doc = await EnrollmentRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Request not found" });
    if (doc.status === "Approved") {
      return res.status(400).json({ error: "Already approved." });
    }

    // Resolve the student. The request may have been submitted before the
    // account existed, so fall back to matching on email.
    let studentId = doc.studentId;
    if (!studentId || !mongoose.Types.ObjectId.isValid(studentId)) {
      const byEmail = await Student.findOne({ "student.email": doc.email }, { _id: 1 });
      studentId = byEmail ? String(byEmail._id) : "";
    }
    if (!studentId) {
      return res.status(409).json({
        error:
          "No student account matches this request yet. Create the account first, then approve.",
      });
    }

    const start = new Date();
    const expires =
      doc.planAccessDays && doc.planAccessDays > 0
        ? new Date(start.getTime() + doc.planAccessDays * 86400000)
        : null; // lifetime

    pushHistory(doc, "Approved", actor || {}, "Payment verified");
    doc.studentId = studentId;
    doc.processedByName = actor?.name || "";
    doc.processedByEmail = actor?.email || "";
    doc.approvedAt = start;
    doc.accessStartAt = start;
    doc.accessExpiresAt = expires;
    await doc.save();

    // Grant access last, so a validation failure above never leaves a student
    // with access but no approved record.
    await Student.updateOne(
      { _id: studentId },
      { $addToSet: { enrolledCourses: doc.course } }
    );

    // #47.12 — in-app notification alongside the email, pushed live to any
    // device the student has open.
    await notify(
      studentId,
      {
        type: "enrollment_approved",
        title: "Enrollment approved 🎉",
        body: `Your payment has been verified and ${
          doc.courseTitle || "your course"
        } is now available in your dashboard.`,
        link: "/my-courses",
        actorName: actor?.name || "Bluverse team",
      },
      req.app.get("io")
    );

    // Email is best-effort — a mail outage must not fail the approval (#47.13).
    try {
      await sendEnrollmentConfirmedEmail(
        doc.email,
        `${doc.firstName} ${doc.lastName || ""}`.trim(),
        doc.courseTitle
      );
    } catch (mailErr) {
      console.error("Enrollment approval email failed:", mailErr.message);
    }

    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/enrollments/:id/reject — requires a reason (#47.7)
// Staff only.
router.post("/:id/reject", staffOnly, async (req, res) => {
  try {
    const { reason, actor } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res
        .status(400)
        .json({ error: "A rejection reason is required." });
    }
    const doc = await EnrollmentRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Request not found" });
    if (doc.status === "Approved") {
      return res.status(400).json({
        error: "This request is already approved and cannot be rejected.",
      });
    }

    pushHistory(doc, "Payment Rejected", actor || {}, String(reason).trim());
    doc.rejectionReason = String(reason).trim();
    doc.processedByName = actor?.name || "";
    doc.processedByEmail = actor?.email || "";
    await doc.save();

    if (doc.studentId) {
      await notify(
        doc.studentId,
        {
          type: "enrollment_rejected",
          title: "Payment verification failed",
          body: doc.rejectionReason,
          link: `/enroll-status?ref=${doc.requestId}`,
          actorName: actor?.name || "Bluverse team",
        },
        req.app.get("io")
      );
    }

    try {
      await sendMail({
        to: doc.email,
        subject: "Payment verification failed",
        html: `<p>Hi ${doc.firstName},</p>
               <p>We couldn't verify the payment for your enrollment request
               <strong>${doc.requestId}</strong> (${doc.courseTitle}).</p>
               <p><strong>Reason:</strong> ${doc.rejectionReason}</p>
               <p>You can submit corrected payment details from your dashboard.</p>`,
      });
    } catch (mailErr) {
      console.error("Enrollment rejection email failed:", mailErr.message);
    }

    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
