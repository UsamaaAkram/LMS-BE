const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    ref: { type: mongoose.Schema.Types.ObjectId }, // points to Student/Instructor in main DB
    refType: {
      type: String,
      enum: ["student", "instructor", "admin"],
      required: true,
    },
    name: { type: String, required: true },
    userName: { type: String, required: true, unique: true },
    password: { type: String }, // <-- add this line!
    firstName: { type: String },
    lastName: { type: String },
    email: { type: String, required: true, unique: true },
    role: {
      type: String,
      enum: ["student", "instructor", "admin"],
      required: true,
    },
    photo: { type: String, default: "" },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // For direct chat blocking
    mutedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chat" }], // For muting chats
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
