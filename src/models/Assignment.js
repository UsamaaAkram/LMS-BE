const mongoose = require('mongoose');

const AssignmentSchema = new mongoose.Schema({
  courseID: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  instructions: { type: String, required: true },
  lastDate: { type: Date, required: true },
  status: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Assignment', AssignmentSchema);