const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  chat: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },
  message: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
  reason: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model("Report", ReportSchema);