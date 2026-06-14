const mongoose = require("mongoose");

const LessonSchema = new mongoose.Schema({
  name: String,
  videoUrl: String, // optional fallback (non-DRM)
  vdoId: String, // VdoCipher video id (DRM playback)
  description: String,
});

const CurriculumSchema = new mongoose.Schema({
  topic: String,
  lessons: [LessonSchema],
});

const CourseSchema = new mongoose.Schema(
  {
    courseTitle: { type: String, required: true },
    courseCategory: { type: String },
    courseLevel: { type: String },
    courseDescription: { type: String },
    courseThumbnail: Object,
    courseThumbnailUrl: { type: String },
    courseVideoProvider: { type: String },
    courseVideoUrl: { type: String },
    studentCount: { type: Number, default: 0 },
    quizzesCount: { type: Number, default: 0 },
    curriculum: [CurriculumSchema],
    notes: { type: String },
    duration: { type: String },
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
