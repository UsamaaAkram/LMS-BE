const mongoose = require('mongoose');

const ReplySchema = new mongoose.Schema({
  userID: { type: String, required: true },
  email: { type: String, required: true },
  userName: { type: String },
  name: { type: String },
  message: { type: String, required: true },
  date: { type: String, required: true }
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
  Attachments: Object, //[AttachmentSchema],
  Replies: {type: [ReplySchema], default: []}
}, { timestamps: true });

module.exports = mongoose.model('Ticket', TicketSchema);