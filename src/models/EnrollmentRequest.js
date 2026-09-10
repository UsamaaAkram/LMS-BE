const mongoose = require("mongoose");

// #47 — a student's request to enroll, and the payment verification around it.
//
// Deliberately separate from the legacy `Enrollment` model (a vestigial stub)
// and from `Student.enrolledCourses`, which stays the single source of truth for
// "does this student have access". This collection records the REQUEST and its
// approval history; access is only written to Student.enrolledCourses once an
// admin approves. That separation is what enforces the doc's core security rule:
// submitting payment is not the same as being granted access.

// Every status change is appended here so there is a real audit trail (#47.11).
const StatusHistorySchema = new mongoose.Schema(
  {
    from: { type: String, default: "" },
    to: { type: String, required: true },
    byName: { type: String, default: "" },
    byEmail: { type: String, default: "" },
    byRole: { type: String, default: "" },
    reason: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const STATUSES = [
  "Pending Verification",
  "Under Review",
  "Payment Verified",
  "Approved",
  "Payment Rejected",
  "Cancelled",
  "Expired",
];

const EnrollmentRequestSchema = new mongoose.Schema(
  {
    // Human-facing reference used in the UI and in WhatsApp messages.
    requestId: { type: String, required: true, unique: true, index: true },

    // Student — captured at submit time. studentId may be absent because the
    // doc allows enrolling before an account exists.
    studentId: { type: String, default: "" },
    firstName: { type: String, required: true },
    lastName: { type: String, default: "" },
    email: { type: String, required: true },
    whatsapp: { type: String, default: "" },

    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    courseTitle: { type: String, default: "" }, // denormalized for lists

    // Chosen plan, snapshotted so later edits to the course's plans cannot
    // retroactively change what this student actually agreed to.
    planName: { type: String, default: "" },
    planPrice: { type: String, default: "" },
    planAccessDays: { type: Number, default: null },

    invoiceNumber: { type: String, default: "" },

    // Payment — absent entirely for free-access courses.
    paymentMethod: { type: String, default: "" },
    transactionId: { type: String, default: "" },
    paymentScreenshot: { type: Object, default: null },
    paymentNote: { type: String, default: "" },
    isFreeEnrollment: { type: Boolean, default: false },

    status: {
      type: String,
      enum: STATUSES,
      default: "Pending Verification",
      index: true,
    },
    rejectionReason: { type: String, default: "" },

    processedByName: { type: String, default: "" },
    processedByEmail: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    accessStartAt: { type: Date, default: null },
    accessExpiresAt: { type: Date, default: null }, // null = lifetime

    statusHistory: { type: [StatusHistorySchema], default: [] },
  },
  { timestamps: true }
);

EnrollmentRequestSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model("EnrollmentRequest", EnrollmentRequestSchema);
