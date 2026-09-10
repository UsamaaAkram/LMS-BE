const mongoose = require("mongoose");

// Success Stories page (#30) — student-submitted content wins, admin
// curates/publishes. Platform is auto-detected from the video URL rather
// than picked manually, per the doc's "auto-detected video platform badges".
const SuccessStorySchema = new mongoose.Schema(
  {
    studentName: { type: String, required: true },
    title: { type: String, required: true },
    story: { type: String, required: true },
    videoUrl: { type: String, default: "" },
    platform: {
      type: String,
      enum: ["tiktok", "youtube", "instagram", "facebook", "other"],
      default: "other",
    },
    thumbnailUrl: { type: String, default: "" },
    featured: { type: Boolean, default: false },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SuccessStory", SuccessStorySchema);
