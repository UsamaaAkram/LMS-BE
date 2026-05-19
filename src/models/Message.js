const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: true },

    // Make sender use refPath so it can reference User, Instructor, or Student
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "senderModel",
    },
    senderModel: {
      type: String,
      required: true,
      enum: ["User", "Instructor", "Student"],
    },

    type: {
      type: String,
      enum: ["text", "image", "document", "emoji", 'attachment'],
      default: "text",
    },
    content: { type: String, default: "" },
    attachment: { type: String, default: "" },

    reactions: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          refPath: "reactionsUserModel",
        },
        reactionsUserModel: {
          // NEW: if reactions can be from any model too
          type: String,
          enum: ["User", "Instructor", "Student"],
          default: "User", // If ALL reactions are by user, you can use "User" directly
        },
        emoji: { type: String },
      },
    ],

    seenBy: [{ type: mongoose.Schema.Types.ObjectId, refPath: "seenByModel" }],
    seenByModel: {
      type: String,
      enum: ["User", "Instructor", "Student"],
      default: "User",
    },

    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        refPath: "deletedForModel",
        default: [],
      },
    ],
    deletedForModel: {
      type: String,
      enum: ["User", "Instructor", "Student"],
      default: "User",
    },

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

    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", MessageSchema);
