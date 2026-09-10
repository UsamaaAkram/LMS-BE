const mongoose = require('mongoose');

const ReplySchema = new mongoose.Schema({
  userID: { type: String, required: true },
  email: { type: String, required: true },
  userName: { type: String },
  name: { type: String },
  message: { type: String, required: true },
  date: { type: String, required: true },
  // #43 conversation view — each reply carries who wrote it so the thread can
  // label it "Student" / "Instructor" / "Admin" beside the name, and can hold
  // its own attachment independent of the ticket's original one.
  role: { type: String, default: "" },
  photo: { type: String, default: "" },
  attachment: { type: Object, default: null }
});

const TicketSchema = new mongoose.Schema({
  TicketID: { type: String, required: true, unique: true },
  Date: { type: String, required: true },
  Subject: { type: String, required: true },
  Priority: { type: String, required: true },
  Category: { type: String, required: true },
  Status: { type: String, required: true },
  Description: { type: String, required: true },
  createdBy: { type: String, required: true }, // User ID of the ticket creator
  // Denormalized at creation time (#41 "shows student info to staff") —
  // createdBy has no model discriminator (could be a Student, Instructor,
  // or User id), so it can't be populate()'d; capturing name/email directly
  // avoids a 3-collection lookup on every list fetch.
  createdByName: { type: String, default: "" },
  createdByEmail: { type: String, default: "" },
  resolvedConfirmed: { type: Boolean, default: null }, // null = not asked yet
  Attachments: Object, //[AttachmentSchema],
  Replies: {type: [ReplySchema], default: []}
}, { timestamps: true });

module.exports = mongoose.model('Ticket', TicketSchema);