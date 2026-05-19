const mongoose = require('mongoose');

const EducationSchema = new mongoose.Schema({
  degree: { type: String },
  university: { type: String },
  fromDate: { type: Date },
  toDate: { type: Date }
}, { _id: false });

const ExperienceSchema = new mongoose.Schema({
  company: { type: String },
  position: { type: String },
  fromDate: { type: Date },
  toDate: { type: Date }
}, { _id: false });

const ModulesSchema = new mongoose.Schema({
  courses: { type: Boolean, default: false },
  assignments: { type: Boolean, default: false },
  students: { type: Boolean, default: false },
  quiz: { type: Boolean, default: false },
  quizResults: { type: Boolean, default: false },
  certificates: { type: Boolean, default: false },
  messages: { type: Boolean, default: false },
  tickets: { type: Boolean, default: false }
}, { _id: false });

const InstructorSchema = new mongoose.Schema({
  firstName:  { type: String },
  lastName:   { type: String },
  userName:   { type: String, required: true, unique: true },
  email:      { type: String, required: true, unique: true }, // <-- REQUIRED!
  password: { type: String, required: true },
  role:       { type: String, required: true },
  phoneNumber:{ type: String },
  bio:        { type: String },
  photo:      Object,
  isDisable:   { type: Boolean, default: true },
  education:  { type: [EducationSchema], default: [] },
  experience: { type: [ExperienceSchema], default: [] },

  modules:    { 
    type: [ 
      {
        name: { type: String, enum: [
          'courses', 'assignments', 'students', 
          'quiz', 'quizResults', 'certificates', 'messages', 'tickets'
        ], required: true },
        isDisable: { type: Boolean, default: true }
      }
    ], 
    default: [
      { name: 'courses', isDisable: true },
      { name: 'assignments', isDisable: true },
      { name: 'students', isDisable: true },
      { name: 'quiz', isDisable: true },
      { name: 'quizResults', isDisable: true },
      { name: 'certificates', isDisable: true },
      { name: 'messages', isDisable: true },
      { name: 'tickets', isDisable: true }
    ]
  },

  // Empty lists for future reference/relations:
  courses:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],        // to be populated
  assignments:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Assignment' }],    // to be populated
  students:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],       // to be populated
  quiz:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'Quiz' }],          // to be populated
  quizResults:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'QuizResult' }],    // to be populated
  certificates: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Certificate' }],   // to be populated
  messages:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],       // to be populated

}, { timestamps: true });

module.exports = mongoose.model('Instructor', InstructorSchema);