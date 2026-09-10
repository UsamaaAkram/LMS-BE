const mongoose = require('mongoose');

const ChoiceSchema = new mongoose.Schema({
  label: { type: String },
  isCorrect: { type: Boolean }
});

const QuestionSchema = new mongoose.Schema({
  question: { type: String },
  questionType: {
    label: { type: String },
    value: { type: String }
  },
  // Optional note shown alongside the answer when an instructor reviews an
  // attempt (#32.4 / #34). Blank on existing questions, which simply means
  // nothing extra is displayed.
  explanation: { type: String, default: "" },
  choices: [ChoiceSchema]
});

const QuizSchema = new mongoose.Schema({
  courseID: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  // Optional — scopes the quiz to one lesson for the Course Watch Quiz tab
  // (#29). Left unset, a quiz stays course-wide (e.g. a final exam).
  lessonID: { type: String, default: "" },
  title: { type: String, required: true },
  totalMarks: { type: String, required: true },
  passMark: { type: String, required: true },
  duration: { type: String, required: true },
  questions: { type: [QuestionSchema], default: [] } // <--- allow empty array
}, { timestamps: true });

module.exports = mongoose.model('Quiz', QuizSchema);