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
  choices: [ChoiceSchema]
});

const QuizSchema = new mongoose.Schema({
  courseID: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  title: { type: String, required: true },
  totalMarks: { type: String, required: true },
  passMark: { type: String, required: true },
  duration: { type: String, required: true },
  questions: { type: [QuestionSchema], default: [] } // <--- allow empty array
}, { timestamps: true });

module.exports = mongoose.model('Quiz', QuizSchema);