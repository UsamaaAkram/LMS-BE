const mongoose = require("mongoose");

// Per-lesson resources (#15/#16) — replaces the old course-level Notes
// field, which showed the same content on every lesson regardless of
// which one was selected. Scoped Course -> Module (topic) -> Lesson so
// resources never leak across lessons.
const ResourceSchema = new mongoose.Schema({
  title: String,
  link: String,
  description: String,
});

const LessonSchema = new mongoose.Schema({
  name: String,
  videoUrl: String, // optional fallback (non-DRM)
  vdoId: String, // VdoCipher video id (DRM playback)
  description: String,
  resources: [ResourceSchema],
});

const CurriculumSchema = new mongoose.Schema({
  topic: String,
  lessons: [LessonSchema],
});

// #47 — access plans, managed per course by an admin. Embedded rather than a
// separate collection because plans are only ever read in the context of their
// course ("plans dynamically tied to the course"), and the doc is explicit that
// they must not be hard-coded into the frontend.
//
// accessDays: null/0 = lifetime access; otherwise the access window in days.
const PlanSchema = new mongoose.Schema({
  name: { type: String, required: true }, // "Lifetime Access", "3 Months Access"
  price: { type: String, default: "" }, // free text, same rules as course price
  accessDays: { type: Number, default: null },
  description: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
});

const CourseSchema = new mongoose.Schema(
  {
    courseTitle: { type: String, required: true },
    // #48 — readable URL segment, e.g. /courses/tiktok-automation.
    // Sparse so the many existing courses without one don't all collide on null
    // under the unique index.
    slug: { type: String, unique: true, sparse: true, index: true },
    courseCategory: { type: String },
    courseLevel: { type: String },
    courseDescription: { type: String },
    courseThumbnail: Object,
    courseThumbnailUrl: { type: String },
    courseVideoProvider: { type: String },
    courseVideoUrl: { type: String },
    // String, not Number: supports custom labels ("Free", "Contact Us",
    // "Coming Soon") alongside real prices ("Rs. 15,000") — doc #18.
    price: { type: String, default: "" },
    originalPrice: { type: String, default: "" },
    studentCount: { type: Number, default: 0 },
    quizzesCount: { type: Number, default: 0 },
    curriculum: [CurriculumSchema],
    notes: { type: String },
    duration: { type: String },
    // #19: lets anyone watch/enroll with no payment — demo/promo courses.
    freeAccess: { type: Boolean, default: false },
    // #33 LMS Guide — onboarding shown ABOVE the curriculum. Deliberately NOT
    // a module/lesson: it must never count toward progress, lesson count,
    // quiz count or assignment count. Leave lmsGuideVdoId blank to hide it.
    lmsGuideTitle: { type: String, default: "" },
    lmsGuideDescription: { type: String, default: "" },
    lmsGuideVdoId: { type: String, default: "" },
    // #47 — selectable access plans for this course.
    plans: { type: [PlanSchema], default: [] },
    status: {
      type: String,
      enum: ["pending", "draft", "published"],
      default: "pending",
    },
    createdBy: { type: String}, // optional, for owner
  },
  { timestamps: true }
);

module.exports = mongoose.model("Course", CourseSchema);
