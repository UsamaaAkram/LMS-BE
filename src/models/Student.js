const mongoose = require('mongoose');

const GuardianSchema = new mongoose.Schema({
  isGuardian: { type: Boolean, default: false },
  name: { type: String, default: "" },
  relation: { type: String, default: "" },
  phone: { type: String, default: "" },
  occupation: { type: String, default: "" },
  address: { type: String, default: "" },
}, { _id: false });


const CertificateSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  issuedDate: { type: String, required: true },
  fileUrl: { type: String, default: "" },
  courseID: { type: String, default: "" }
}, { _id: false });

const LessonWatchedSchema = new mongoose.Schema({
  lessonID: { type: String, required: true },
  videoID: { type: String, required: true },
  completed: { type: Boolean, default: false },
  videoTime: { type: Number, default: 0 },
  presentWatch: { type: Number, default: 0 }
}, { _id: false });

const AssignmentSchema = new mongoose.Schema({
  isSubmitted: { type: Boolean, default: false },
  assignmentsID: { type: String, required: true },
  assignmentDate: { type: String, default: null },
  assignment: { type: String, default: null },
}, { _id: false });

const QuizSchema = new mongoose.Schema({
  marks: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  totalAttempts: { type: Number, default: 0 },
  quizID: { type: String, required: true },
  lastAttemptDate: { type: String, default: "" },
  completed: { type: Boolean, default: false },
}, { _id: false });

const ProgressSchema = new mongoose.Schema({
  courseID: { type: String, required: true },
  assignments: [AssignmentSchema],
  lessonWatched: [LessonWatchedSchema],
  quizzes: [QuizSchema],
  grade: { type: mongoose.Schema.Types.Mixed, default: "" },
  grandTotal: { type: Number, default: 0 },
  percent: { type: Number, default: 0 }
}, { _id: false });

const StudentInfoSchema = new mongoose.Schema({
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  userName: { type: String, unique: true, sparse: true },
  password: { type: String, default: "" },
  email: { type: String, required: true, unique: true },
  phoneNumber: { type: String, default: "" },
  address: { type: String, default: "" },
  gender: { type: String, default: "" },
  cnic: { type: String, default: "" },
  dob: { type: String, default: "" },
  age: { type: Number, default: null },
  bio: { type: String, default: "" },
  photo: { type: String, default: "" },
  isDisable: { type: Boolean, default: false },
  current_logged_in_locations: { type: [String], default: [] },
  isDeactivated: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  verificationOtp: { type: String, default: "" },
  verificationOtpExpiry: { type: Date, default: null },
  resetOtp: { type: String, default: "" },
  resetOtpExpiry: { type: Date, default: null }
}, { _id: false });

const AdministrativeSchema = new mongoose.Schema({
  batch: { type: String, default: "" },
  enrolledBy: { type: String, default: "" },
  enrolledBranch: { type: String, default: "" },
  enrollmentDate: { type: String, default: "" },
  studentType: { type: String, default: "onsite" }, // "remote" | "onsite" | "hybrid"
  shift: { type: String, default: "" }
}, { _id: false });

const StudentSchema = new mongoose.Schema({
  student: StudentInfoSchema,
  administrative: AdministrativeSchema,
  role: { type: String, required: true },
  guardian: GuardianSchema,
  enrolledCourses: { type: [String], default: [] },
  progress: [ProgressSchema],
  certificates: [CertificateSchema],
  wishlist: { type: [String], default: [] },
  messages: { type: [String], default: [] },
  tickets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' }],  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Set isDeactivated if current_logged_in_locations > 2
StudentSchema.pre('save', function(next) {
  if (
    this.student &&
    Array.isArray(this.student.current_logged_in_locations) &&
    this.student.current_logged_in_locations.length > 2
  ) {
    this.student.isDeactivated = true;
  }
  next();
});
StudentSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (
    update.student &&
    Array.isArray(update.student.current_logged_in_locations) &&
    update.student.current_logged_in_locations.length > 2
  ) {
    update.student.isDeactivated = true;
  }
  next();
});


StudentSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.student || !this.student.password) return false;
  return await bcrypt.compare(candidatePassword, this.student.password);
};

module.exports = mongoose.model('Student', StudentSchema);