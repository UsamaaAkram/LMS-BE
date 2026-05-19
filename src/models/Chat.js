const mongoose = require("mongoose");

const ChatSchema = new mongoose.Schema(
  {
    isGroup: { type: Boolean, default: false },
    groupName: { type: String, default: "" },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        refPath: "participantsModel",
      },
    ],
    participantsModel: {
      type: String,
      enum: ["User", "Instructor", "Student"],
    },
    admin: [{ type: mongoose.Schema.Types.ObjectId, refPath: "adminModel" }], // Group admin/instructor
    adminModel: {
      type: String,
      enum: ["User", "Instructor", "Student"],
    },
    blocked: [
      {
        blocker: { type: mongoose.Schema.Types.ObjectId },
        blocked: { type: mongoose.Schema.Types.ObjectId },
        at: { type: Date, default: Date.now },
      },
    ],
    isAnnouncement: { type: Boolean, default: false }, // Announcement group only
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    // ADD THESE TWO FIELDS for delete handling:
    deletedFor: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
    deletedForModel: {
      type: String,
      enum: ["User", "Instructor", "Student"],
      default: "User",
    },

    lastReadMessageMap: {
      type: Map,
      of: mongoose.Schema.Types.ObjectId,
      default: {},
    },
    
  },
  { timestamps: true }
);

module.exports = mongoose.model("Chat", ChatSchema);
