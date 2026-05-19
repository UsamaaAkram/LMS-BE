const fs = require("fs").promises;
const express = require("express");
const path = require("path");
const puppeteer = require("puppeteer");

const router = express.Router();
const bcrypt = require("bcryptjs");
const Student = require("../models/Student");
const Course = require("../models/Course");
const Assignment = require("../models/Assignment");
const Quiz = require("../models/Quiz");

const getCourseActualProgress = require("../utils/getCourseActualProgress");

const calculateProgress = require("../utils/calculateProgress");

const multer = require("multer");
const moment = require("moment");

const upload = multer();
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({
  region: "ap-southeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = "bluverse-lms";

// S3 upload helper for student photo (permanent public URL)
async function uploadPhotoToS3(file) {
  const key = `student-photos/${Date.now()}-${file.originalname}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${key}`;
}

// S3 upload helper for certificate PDF
async function uploadCertificateToS3(pdfBuffer, filename) {
  const key = `certificates/${Date.now()}-${filename}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: pdfBuffer,
      ContentType: "application/pdf",
      ContentDisposition: `attachment; filename="${filename}"`,
    })
  );
  return `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${key}`;
}

// Helper: Default progress object for a new course
function getDefaultProgress(courseID) {
  return {
    courseID,
    assignments: [],
    lessonWatched: [],
    quizzes: [],
    grade: "",
    grandTotal: 0,
    percent: 0,
  };
}

// Helper: grade from marks
function getGrade(total) {
  if (total >= 90) return "A+";
  if (total >= 80) return "A";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  if (total >= 50) return "D";
  if (total >= 40) return "E";
  return "F";
}

// Signup API (create student)
router.post("/signup", upload.single("photo"), async (req, res) => {
  try {
    // Student fields from body (flattened or nested)
    const {
      firstName,
      lastName,
      userName,
      password,
      email,
      role,
      phoneNumber,
      address,
      gender,
      cnic,
      dob,
      age,
      bio,
      isDisable,
      current_logged_in_locations,
      isDeactivated,

      // administrative
      batch,
      enrolledBy,
      enrolledBranch,
      enrollmentDate,
      studentType,
      shift,

      // guardian
      isGuardian,
      guardian,

      // education
      education,

      // academic
      enrolledCourses,
      progress,
      certificates,
      wishlist,
      messages,
      tickets,
    } = req.body;

    // Minimal validation
    if (!email || !userName || !password || role !== "student") {
      return res.status(400).json({
        error: "Missing required fields: userName, email, password, role",
      });
    }
    // Duplicates
    const existingEmail = await Student.findOne({ "student.email": email });
    if (existingEmail)
      return res.status(400).json({ error: "Email already registered" });

    const existingUser = await Student.findOne({
      "student.userName": userName,
    });
    if (existingUser)
      return res.status(400).json({ error: "User name already exists" });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Photo upload
    let photoUrl = null;
    if (req.file) {
      photoUrl = await uploadPhotoToS3(req.file);
    }

    // Parse nested/complex fields if sent as JSON string
    let guardianObj = {};
    if (guardian !== undefined && guardian !== null) {
      try {
        guardianObj =
          typeof guardian === "string" ? JSON.parse(guardian) : guardian;
      } catch {
        return res.status(400).json({ error: "Invalid guardian format" });
      }
    }
    let educationArr = [];
    if (education !== undefined && education !== null) {
      try {
        educationArr =
          typeof education === "string" ? JSON.parse(education) : education;
      } catch {
        return res.status(400).json({ error: "Invalid education format" });
      }
    }
    let progressArr = [];
    if (progress !== undefined && progress !== null) {
      try {
        progressArr =
          typeof progress === "string" ? JSON.parse(progress) : progress;
      } catch {
        return res.status(400).json({ error: "Invalid progress format" });
      }
    }
    let certificatesArr = [];
    if (certificates !== undefined && certificates !== null) {
      try {
        certificatesArr =
          typeof certificates === "string"
            ? JSON.parse(certificates)
            : certificates;
      } catch {
        return res.status(400).json({ error: "Invalid certificates format" });
      }
    }

    // Build body per new schema
    const studentDoc = {
      student: {
        firstName: firstName || "",
        lastName: lastName || "",
        userName,
        password: hashedPassword,
        email,
        phoneNumber: phoneNumber || "",
        address: address || "",
        gender: gender || "",
        cnic,
        dob,
        age: age || null,
        bio: bio || "",
        photo: photoUrl,
        isDisable: isDisable !== undefined ? isDisable : true,
        current_logged_in_locations: [],
        isDeactivated: isDeactivated !== undefined ? isDeactivated : false,
      },
      administrative: {
        batch: batch || "",
        enrolledBy: enrolledBy || "",
        enrolledBranch: enrolledBranch || "",
        enrollmentDate: moment().format("YYYY-MM-DD"),
        studentType: studentType || "",
        shift: shift || "",
      },
      role,
      guardian: guardianObj,
      education: educationArr,
      enrolledCourses: enrolledCourses || [],
      progress: progressArr,
      certificates: certificatesArr,
      wishlist: wishlist || [],
      messages: messages || [],
      tickets: tickets || [],
    };

    const newStudent = new Student(studentDoc);
    await newStudent.save();

    // Do not return password
    const responseDoc = newStudent.toObject();
    // if (responseDoc.student) delete responseDoc.student.password;
    res
      .status(201)
      .json({ message: "Student registered", student: responseDoc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit API (patch student)
router.patch("/:id", upload.single("photo"), async (req, res) => {
  try {
    // --- Parse JSON strings for nested objects (from multipart) ---
    if (typeof req.body.student === "string") {
      try {
        req.body.student = JSON.parse(req.body.student);
      } catch (e) {
        req.body.student = {};
      }
    }
    if (typeof req.body.administrative === "string") {
      try {
        req.body.administrative = JSON.parse(req.body.administrative);
      } catch (e) {}
    }
    if (typeof req.body.guardian === "string") {
      try {
        req.body.guardian = JSON.parse(req.body.guardian);
      } catch (e) {}
    }
    // Add others as needed

    const { password, oldPassword } = req.body;
    // Only handle password change if the field is present (could be sent alone in request)
    if (password) {
      const student = await Student.findById(req.params.id);
      // Add your password check logic here (compare with current password hash)
      const isMatch = await bcrypt.compare(
        oldPassword,
        student.student.password
      );

      if (!isMatch) {
        return res.status(400).json({ error: "Current password incorrect." });
      }
      // Hash new password and assign, e.g. with bcrypt:
      student.student.password = await bcrypt.hash(password, 10);
      await student.save();

      // Remove password from outgoing object
      const responseDoc = student.toObject();
      if (responseDoc.student) delete responseDoc.student.password;
      return res.json(responseDoc);
    }

    let updateDoc = {};

    // Patch only fields present, not whole objects, to avoid subdoc overwrite
    // Patch student fields (nested)
    if (req.body.student && typeof req.body.student === "object") {
      for (const key in req.body.student) {
        if (Object.prototype.hasOwnProperty.call(req.body.student, key)) {
          updateDoc[`student.${key}`] = req.body.student[key];
        }
      }
    }
    // Patch administrative fields (nested)
    if (
      req.body.administrative &&
      typeof req.body.administrative === "object"
    ) {
      for (const key in req.body.administrative) {
        if (
          Object.prototype.hasOwnProperty.call(req.body.administrative, key)
        ) {
          updateDoc[`administrative.${key}`] = req.body.administrative[key];
        }
      }
    }
    // Patch guardian fields (nested)
    if (req.body.guardian && typeof req.body.guardian === "object") {
      for (const key in req.body.guardian) {
        if (Object.prototype.hasOwnProperty.call(req.body.guardian, key)) {
          updateDoc[`guardian.${key}`] = req.body.guardian[key];
        }
      }
    }

    // Direct (top-level) arrays/subdocs
    if (req.body.education) updateDoc["education"] = req.body.education;
    if (req.body.enrolledCourses)
      updateDoc["enrolledCourses"] = req.body.enrolledCourses;
    if (req.body.progress) updateDoc["progress"] = req.body.progress;
    if (req.body.certificates)
      updateDoc["certificates"] = req.body.certificates;
    if (req.body.wishlist) updateDoc["wishlist"] = req.body.wishlist;
    if (req.body.messages) updateDoc["messages"] = req.body.messages;
    if (req.body.tickets) updateDoc["tickets"] = req.body.tickets;

    // Support updating only specific fields if sent flat
    const flatFields = [
      "firstName",
      "lastName",
      "email",
      "userName",
      "phoneNumber",
      "address",
      "gender",
      "cnic",
      "dob",
      "age",
      "bio",
      "isDisable",
      "current_logged_in_locations",
      "isDeactivated",
    ];
    for (const f of flatFields) {
      if (req.body[f] !== undefined) {
        updateDoc[`student.${f}`] = req.body[f];
      }
    }

    // Handle photo upload (overwrite student.photo regardless of previous value)
    if (req.body.photo || req.file) {
      let photoUrl = req.body.photo;
      if (req.file) photoUrl = await uploadPhotoToS3(req.file);
      updateDoc["student.photo"] = photoUrl;
    }

    // BEFORE update: get previous student (for course comparison)
    const previousStudent = await Student.findById(req.params.id);

    // Do the update (PATCH only!)
    const updatedStudent = await Student.findByIdAndUpdate(
      req.params.id,
      { $set: updateDoc }, // <-- $set is extra-safe
      { new: true, runValidators: true }
    );

    if (!updatedStudent)
      return res.status(404).json({ error: "Student not found" });

    // ---- Progress creation for new courses ----
    if (req.body.enrolledCourses && Array.isArray(req.body.enrolledCourses)) {
      const prevCourses = previousStudent?.enrolledCourses || [];
      const newCourses = updatedStudent.enrolledCourses || [];
      const newlyAddedCourses = newCourses.filter(
        (c) => !prevCourses.includes(c)
      );
      let needsSave = false;
      for (const courseID of newlyAddedCourses) {
        if (!updatedStudent.progress.some((p) => p.courseID === courseID)) {
          updatedStudent.progress.push(getDefaultProgress(courseID));
          needsSave = true;
        }
      }
      if (needsSave) await updatedStudent.save();
    }

    const responseDoc = updatedStudent.toObject();
    if (responseDoc.student) delete responseDoc.student.password;
    res.json(responseDoc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all
router.get("/", async (req, res) => {
  try {
    const students = await Student.find();
    students.forEach((s) => s.student && delete s.student.password);
    res.json(students);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Summary API with filters
router.get("/summary", async (req, res) => {
  try {
    const {
      batch,
      enrolledBranch,
      enrolledBy,
      studentType,
      shift,
      studentName,
      enrollmentDate,
      email,
    } = req.query;

    // Build Mongoose query
    const query = {};

    // Administrative filters (in subdocuments!)
    if (batch) query["administrative.batch"] = batch;
    if (enrolledBranch) query["administrative.enrolledBranch"] = enrolledBranch;
    if (enrolledBy) query["administrative.enrolledBy"] = enrolledBy;
    if (studentType) query["administrative.studentType"] = studentType;
    if (shift) query["administrative.shift"] = shift;
    if (enrollmentDate) query["administrative.enrollmentDate"] = enrollmentDate;

    // Student name search: match first or last name (case insensitive, partial available)
    if (studentName) {
      query.$or = [
        { "student.firstName": { $regex: studentName, $options: "i" } },
        { "student.lastName": { $regex: studentName, $options: "i" } },
      ];
    }
    // Email search (partial match)
    if (email) {
      query["student.email"] = { $regex: email, $options: "i" };
    }

    const students = await Student.find(query);

    // Extract summary info
    const summaries = students.map((s) => ({
      photo: s.student?.photo || "",
      _id: s._id,
      userName: s.student?.userName || "",
      firstName: s.student?.firstName || "",
      lastName: s.student?.lastName || "",
      enrolledBy: s.administrative?.enrolledBy || "",
      batch: s.administrative?.batch || "",
      enrolledBranch: s.administrative?.enrolledBranch || "",
      coursesLength: Array.isArray(s.enrolledCourses)
        ? s.enrolledCourses.length
        : 0,
      isDisable: !!s.student?.isDisable,
      createdAt: s.createdAt,
      enrollmentDate: s.administrative?.enrollmentDate || "",
      branch: s.administrative?.enrolledBranch || "",
      email: s.student?.email || "",
      percent:
        Array.isArray(s.progress) && s.progress.length > 0
          ? s.progress[0].percent || 0
          : 0,
    }));

    res.json(summaries);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get by ID
router.get("/:id", async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: "Student not found" });
    const responseDoc = student.toObject();
    if (responseDoc.student) delete responseDoc.student.password;
    res.json(responseDoc);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/student/wishlist/add
router.post("/wishlist/add", async (req, res) => {
  try {
    const { studentId, courseId } = req.body;
    if (!studentId || !courseId) {
      return res.status(400).json({ error: "studentId and courseId required" });
    }

    // Add to wishlist only if not already present
    const student = await Student.findByIdAndUpdate(
      studentId,
      { $addToSet: { wishlist: courseId } }, // $addToSet avoids duplicates
      { new: true }
    );
    if (!student) return res.status(404).json({ error: "Student not found" });
    res.json({
      message: "Course added to wishlist",
      wishlist: student.wishlist,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/student/wishlist/remove
router.post("/wishlist/remove", async (req, res) => {
  try {
    const { studentId, courseId } = req.body;
    if (!studentId || !courseId) {
      return res.status(400).json({ error: "studentId and courseId required" });
    }
    // Remove from wishlist
    const student = await Student.findByIdAndUpdate(
      studentId,
      { $pull: { wishlist: courseId } },
      { new: true }
    );
    if (!student) return res.status(404).json({ error: "Student not found" });
    res.json({
      message: "Course removed from wishlist",
      wishlist: student.wishlist,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// get wishlist courses
router.get("/:studentId/wishlist", async (req, res) => {
  try {
    const student = await Student.findById(req.params.studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

    // Fetch the list of wishlisted course IDs
    const wishlistCourseIds = student.wishlist || [];
    // Fetch course objects for all wishlisted IDs
    const courses = await Course.find({ _id: { $in: wishlistCourseIds } });
    res.json({ wishlistCourses: courses });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET all quizzes for a student's enrolled courses
router.get("/:studentId/quizzes", async (req, res) => {
  try {
    // 1. Find the student and their enrolledCourses
    const student = await Student.findById(req.params.studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });
    const enrolledCourseIds = student.enrolledCourses || [];
    // 2. Find quizzes with those courseIDs
    const quizzes = await Quiz.find({ courseID: { $in: enrolledCourseIds } });

    // 3. Map to hide `questions` but add `questionsCount`
    const quizzesNoQuestions = quizzes.map((q) => {
      // Use .toObject() if not using .lean()
      const obj = q.toObject ? q.toObject() : { ...q };
      const count = Array.isArray(q.questions) ? q.questions.length : 0;
      delete obj.questions;
      return { ...obj, questionsCount: count };
    });

    res.json({ quizzes: quizzesNoQuestions });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ***
// POST /api/student/:studentId/submit-quiz
router.post("/:studentId/submit-quiz", async (req, res) => {
  try {
    const { quizID, answers } = req.body;

    if (!quizID || !Array.isArray(answers)) {
      return res
        .status(400)
        .json({ error: "quizID and answers[] are required" });
    }

    // 1. Fetch quiz with all questions and choices
    const quiz = await Quiz.findById(quizID);
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });

    // String to number since your schema is "totalMarks" : String
    const totalMarks = Number(quiz.totalMarks);
    const totalQuestions = quiz.questions.length;

    // Map for quick lookup: questionID --> question object
    const questionMap = {};
    quiz.questions.forEach((q) => {
      questionMap[q._id.toString()] = q;
    });

    // 2. Evaluate answers
    let correctAnswers = 0;
    answers.forEach((ans) => {
      const question = questionMap[ans.questionID];
      if (question) {
        const selectedChoice = question.choices.id(ans.selectedAnswerID);
        if (selectedChoice && selectedChoice.isCorrect) {
          correctAnswers++;
        }
      }
    });

    // 3. Calculate marks based on correct answers and quiz.totalMarks
    // Each correct: (totalMarks / totalQuestions)
    const marks = Math.round((correctAnswers / totalQuestions) * totalMarks);

    // 4. Find student & progress for the course
    const student = await Student.findById(req.params.studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

    // Find courseID for this quiz
    const courseID = quiz.courseID.toString();
    let progress = student.progress.find((p) => p.courseID === courseID);

    if (!progress) {
      return res
        .status(400)
        .json({ error: "Student is not enrolled in this course" });
    }

    // Find or create quiz result in progress.quizzes
    let quizResult = progress.quizzes.find((qr) => qr.quizID === quizID);
    const passMark = Number(quiz.passMark);
    const nowStr = new Date().toISOString();

    if (quizResult) {
      quizResult.marks = marks;
      quizResult.totalMarks = totalMarks;
      quizResult.totalAttempts = (quizResult.totalAttempts || 0) + 1;
      quizResult.lastAttemptDate = nowStr;
      quizResult.completed = marks >= passMark;
    } else {
      quizResult = {
        quizID,
        marks,
        totalMarks,
        totalAttempts: 1,
        lastAttemptDate: nowStr,
        completed: marks >= passMark,
      };
      progress.quizzes.push(quizResult);
    }

    // 🔥 Calculate progress now and store!
    const calc = calculateProgress(progress);
    progress.grandTotal = calc.grandTotal;
    progress.percent = calc.grandTotal;
    progress.grade = calc.grade;

    await student.save();
    res.json({
      message: "Quiz submitted successfully",
      result: {
        marks,
        totalMarks,
        correctAnswers,
        totalQuestions,
        quizID,
        totalAttempts: quizResult.totalAttempts,
        completed: quizResult.completed,
        percent: Math.round((marks / totalMarks) * 100),
        passed: marks >= passMark,
      },
      progress: {
        courseID: progress.courseID,
        percent: progress.percent,
        grandTotal: progress.grandTotal,
        grade: progress.grade,
        detail: calc,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:studentId/quiz/:quizId/result", async (req, res) => {
  try {
    const { studentId, quizId } = req.params;

    // 1. Find the quiz to get the courseID
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });

    // 2. Find the student
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

    // 3. Find progress entry for this course
    const courseID = quiz.courseID.toString();
    const progress = student.progress.find((p) => p.courseID === courseID);
    if (!progress)
      return res.status(404).json({ error: "No progress for course" });

    // 4. Find quiz result for this quiz
    const quizResult = progress.quizzes.find((qr) => qr.quizID === quizId);
    if (!quizResult)
      return res.status(404).json({ error: "No result found for this quiz" });

    res.json({
      quizID: quizResult.quizID,
      marks: quizResult.marks,
      totalMarks: quizResult.totalMarks,
      totalAttempts: quizResult.totalAttempts,
      lastAttemptDate: quizResult.lastAttemptDate,
      completed: quizResult.completed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:studentId/course/:courseId", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;
    // 1. Ensure student exists (and is "authenticated" -- more on this below)
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });
    // 2. Check that user is enrolled in this course
    // enrolledCourses can be string or ObjectId; adjust as needed
    const enrolled = student.enrolledCourses.some(
      (enrolledId) => enrolledId.toString() === courseId
    );
    if (!enrolled) {
      return res
        .status(403)
        .json({ error: "Student not enrolled in this course." });
    }

    // 3. Fetch and return the course
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found." });

    res.json({ course });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// submit assignment
router.post(
  "/:studentId/course/:courseId/assignment/:assignmentId/submit",
  async (req, res) => {
    try {
      const { studentId, courseId, assignmentId } = req.params;
      const { assignment } = req.body; // the assignment content/data

      // 1. Get the student
      const student = await Student.findById(studentId);
      if (!student) return res.status(404).json({ error: "Student not found" });

      // 2. Check enrollment
      const isEnrolled = (student.enrolledCourses || []).some(
        (cid) => cid.toString() === courseId
      );
      if (!isEnrolled)
        return res
          .status(403)
          .json({ error: "Student is not enrolled in this course" });

      // 3. Find the correct progress object by courseId
      const progress = student.progress.find((p) => p.courseID === courseId);
      if (!progress)
        return res
          .status(404)
          .json({ error: "No progress found for this course" });

      // 4. Check if assignment already submitted
      const assignmentProgress = progress.assignments.find(
        (a) => a.assignmentsID === assignmentId
      );
      if (assignmentProgress) {
        return res.status(400).json({ error: "Assignment already submitted" });
      }

      // 5. Mark as submitted (new or update existing)
      const nowStr = new Date().toISOString();
      if (assignmentProgress) {
        assignmentProgress.isSubmitted = false;
        assignmentProgress.assignmentDate = nowStr;
        assignmentProgress.assignment = assignment; // Save assignment content
      } else {
        // If not present (could happen if assignments are created after enrollment)
        progress.assignments.push({
          isSubmitted: false,
          assignmentsID: assignmentId,
          assignmentDate: nowStr,
          assignment: assignment,
        });
      }

      await student.save();

      res.json({
        message: "Assignment submitted successfully",
        assignment: {
          assignmentsID: assignmentId,
          isSubmitted: false,
          assignment,
          assignmentDate: nowStr,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET all published assignments for student's enrolled courses
router.get("/:studentId/published-assignments", async (req, res) => {
  try {
    const { studentId } = req.params;

    // 1. Find the student
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

    // 2. Extract enrolled course IDs
    const courseIds = student.enrolledCourses || [];
    if (courseIds.length === 0) return res.json({ assignments: [] });

    // 3. Fetch all published assignments for those courses
    const assignments = await Assignment.find({
      courseID: { $in: courseIds },
      status: "Published",
    });

    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:studentId/course/:courseId/assignment/:assignmentId/mark-submitted
router.post(
  "/:studentId/course/:courseId/assignment/:assignmentId/mark-submitted",
  async (req, res) => {
    try {
      const { studentId, courseId, assignmentId } = req.params;

      // 1. Find student
      const student = await Student.findById(studentId);
      if (!student) return res.status(404).json({ error: "Student not found" });

      // 2. Check enrollment
      const isEnrolled = (student.enrolledCourses || []).some(
        (cid) => cid.toString() === courseId
      );
      if (!isEnrolled)
        return res
          .status(403)
          .json({ error: "Student is not enrolled in this course" });

      // 3. Find progress for the course
      const progress = student.progress.find((p) => p.courseID === courseId);
      if (!progress)
        return res
          .status(404)
          .json({ error: "No progress found for this course" });

      // 4. Find the assignment progress
      let assignmentProgress = progress.assignments.find(
        (a) => a.assignmentsID === assignmentId
      );
      if (!assignmentProgress) {
        return res
          .status(404)
          .json({ error: "Assignment progress not found for the student." });
      }

      // 5. Update isSubmitted and assignmentDate
      assignmentProgress.isSubmitted = true;
      await student.save();

      res.json({
        message: "Assignment marked as submitted.",
        assignment: assignmentProgress,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// LessonWatched APIs
router.get(
  "/:studentId/course/:courseId/lesson-watched/:lessonId/:videoId",
  async (req, res) => {
    try {
      const { studentId, courseId, lessonId, videoId } = req.params;
      const student = await Student.findById(studentId);
      if (!student) return res.status(404).json({ error: "Student not found" });

      const progress = student.progress.find((p) => p.courseID === courseId);
      if (!progress)
        return res.status(404).json({ error: "No progress for this course" });

      const lessonWatched = (progress.lessonWatched || []).find(
        (lw) =>
          lw.lessonID.toString() === lessonId.toString() &&
          lw.videoID.toString() === videoId.toString()
      );
      if (!lessonWatched)
        return res.json({
          lessonWatched: null,
          message: "No LessonWatched found.",
        });

      res.json({ lessonWatched });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ***
// Add LessonWatched entry
router.post("/:studentId/course/:courseId/lesson-watched", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;
    const { lessonID, videoID, completed, videoTime, presentWatch } = req.body;

    if (!lessonID) return res.status(400).json({ error: "lessonID required" });
    if (!videoID) return res.status(400).json({ error: "videoID required" });

    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

    const progress = student.progress.find((p) => p.courseID === courseId);
    if (!progress)
      return res.status(404).json({ error: "No progress for this course" });

    if (
      progress.lessonWatched.find(
        (lw) => lw.lessonID === lessonID && lw.videoID === videoID
      )
    ) {
      return res.status(400).json({
        error: "LessonWatched already exists for this lessonID and videoID.",
      });
    }

    progress.lessonWatched.push({
      lessonID,
      videoID,
      completed: completed || false,
      videoTime: videoTime || 0,
      presentWatch: presentWatch || 0,
    });

    // 🔥 Calculate Live Progress!
    const calc = calculateProgress(progress);
    progress.grandTotal = calc.grandTotal;
    progress.percent = calc.grandTotal;
    progress.grade = calc.grade;

    await student.save();

    res.status(201).json({
      message: `LessonWatched added for lessonID ${lessonID}`,
      progress: {
        courseID: progress.courseID,
        percent: progress.percent,
        grandTotal: progress.grandTotal,
        grade: progress.grade,
        detail: calc,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ***
// Update LessonWatched entry
router.put(
  "/:studentId/course/:courseId/lesson-watched/:lessonId/:videoId",
  async (req, res) => {
    try {
      const { studentId, courseId, lessonId, videoId } = req.params;
      const { completed, videoTime, presentWatch } = req.body;

      const student = await Student.findById(studentId);
      if (!student) return res.status(404).json({ error: "Student not found" });

      const progress = student.progress.find((p) => p.courseID === courseId);
      if (!progress)
        return res.status(404).json({ error: "No progress for this course" });

      const lw = progress.lessonWatched.find(
        (l) => l.lessonID === lessonId && l.videoID === videoId
      );
      if (!lw)
        return res.status(404).json({
          error: "LessonWatched not found for this lessonID and videoID.",
        });

      if (typeof completed === "boolean") lw.completed = completed;
      if (typeof videoTime === "number") lw.videoTime = videoTime;
      if (typeof presentWatch === "number") lw.presentWatch = presentWatch;

      // 🔑 Recalculate grandTotal/percent here!
      const calc = calculateProgress(progress);
      progress.grandTotal = calc.grandTotal;
      progress.percent = calc.grandTotal;
      progress.grade = calc.grade;

      await student.save();

      res.json({
        message: `LessonWatched for lessonID ${lessonId} and videoID ${videoId} updated.`,
        progress: {
          courseID: progress.courseID,
          percent: progress.percent,
          grandTotal: progress.grandTotal,
          grade: progress.grade,
          detail: calc,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get("/:studentId/all-courses-progress", async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

    const courseIdArr = (student.progress || []).map((p) => p.courseID);
    const courses = await Course.find({ _id: { $in: courseIdArr } });

    const courseMap = {};
    courses.forEach((c) => (courseMap[c._id.toString()] = c.courseTitle));

    const result = (student.progress || []).map((p) => {
      const actual = getCourseActualProgress(p);
      return {
        courseID: p.courseID,
        courseTitle: courseMap[p.courseID] || "Unknown Title",
        ...actual,
      };
    });

    const totalEnrolledCourses = student.enrolledCourses
      ? student.enrolledCourses.length
      : 0;
    const totalWishlist = student.wishlist ? student.wishlist.length : 0;
    const totalCompleteCourses = (student.progress || []).filter(
      (p) => p.percent === 100 || p.grandTotal === 100
    ).length;

    res.json({
      totalEnrolledCourses,
      totalWishlist,
      totalCompleteCourses,
      result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/student/certificate

router.post("/certificate", async (req, res) => {
  try {
    const { studentId, courseId } = req.body;

    // 1. Get student & course
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    // 2. Find student's progress for the course
    const progress = (student.progress || []).find(
      (p) => p.courseID === courseId
    );
    if (!progress)
      return res.status(404).json({ error: "No progress for this course" });

    // 3. Check eligibility
    // (Assume percent is stored, else use calculateProgress(progress))
    const percent =
      typeof progress.percent === "number"
        ? progress.percent
        : calculateProgress(progress).grandTotal;
    if (percent < 70)
      return res.status(403).json({ error: "Not eligible for certificate" });

    // 4. Read and fill HTML certificate template
    const certDir = path.join(__dirname, "../certificates");
    let html = await fs.readFile(path.join(certDir, "index.html"), "utf8");

    // 4a. Read and base64 encode all images for data URI embedding
    const awardBase64 = await fs.readFile(
      path.join(certDir, "award.png"),
      "base64"
    );
    const logoBase64 = await fs.readFile(
      path.join(certDir, "blu_light.PNG"),
      "base64"
    );
    const sideBarBase64 = await fs.readFile(
      path.join(certDir, "side-bar.jpg"),
      "base64"
    );
    const cornerBase64 = await fs.readFile(
      path.join(certDir, "corner.jpg"),
      "base64"
    );

    // 4b. Inject base64-embedded images into HTML
    html = html
      .replace(/\$\{awardBase64\}/g, `data:image/png;base64,${awardBase64}`)
      .replace(/\$\{logoBase64\}/g, `data:image/png;base64,${logoBase64}`)
      .replace(
        /\$\{sideBarBase64\}/g,
        `data:image/jpeg;base64,${sideBarBase64}`
      )
      .replace(/\$\{cornerBase64\}/g, `data:image/jpeg;base64,${cornerBase64}`);

    // Prepare dynamic values
    const studentName =
      student.student?.firstName + " " + student.student?.lastName;
    const courseName = course.title || course.courseTitle || course.name; // Adjust as needed
    const issueDate = new Date().toISOString().split("T")[0];

    // Replace all placeholders (global - handles multiple usages)
    html = html
      .replace(/\$\{studentName\}/g, studentName)
      .replace(/\$\{courseName\}/g, courseName)
      .replace(/\$\{issueDate\}/g, issueDate);

    // Absolute asset paths for puppeteer
    html = html.replace(
      /src="\.\//g,
      `src="file://${certDir.replace(/\\/g, "/")}/`
    );

    // 5. Generate PDF with Puppeteer
    const browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      landscape: true,
      // margin: { top: "10px", right: "10px", left: "10px", bottom: "10px" },
    });
    await browser.close();

    // 6. Upload to S3, get public URL
    const filename = `certificate_${studentName.replace(
      /\s/g,
      "_"
    )}_${courseName.replace(/\s/g, "_")}.pdf`;
    const s3Url = await uploadCertificateToS3(pdfBuffer, filename);

    // 7. Respond with URL
    res.json({
      filename,
      url: s3Url,
      message: "Certificate generated and uploaded.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/student/:studentId/certificates
router.get("/:studentId/certificates", async (req, res) => {
  try {
    const { studentId } = req.params;
    // 1. Find student (with progress)
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

    // 2. Course lookup (for titles)
    const progressArr = Array.isArray(student.progress) ? student.progress : [];
    const courseIdArr = progressArr.map((p) => p.courseID);
    const courses = await Course.find({ _id: { $in: courseIdArr } });

    const courseTitleMap = {};
    courses.forEach((c) => {
      // choose the right field for your course title
      courseTitleMap[c._id.toString()] =
        c.certificateTitle || c.title || c.courseTitle;
    });

    // 3. Assemble response
    const certificates = progressArr.map((p, idx) => {
      // Use stored percent/grandTotal or recalculate if you want
      const marks =
        typeof p.grandTotal === "number"
          ? Math.round(p.grandTotal)
          : calculateProgress
          ? Math.round(calculateProgress(p)?.grandTotal ?? 0)
          : 0;

      return {
        id: String(idx + 1).padStart(2, "0"),
        courseID: p.courseID,
        certificateName: courseTitleMap[p.courseID] || "Unknown",
        marks: marks,
        outOf: 100,
        grade: getGrade(marks),
      };
    });

    res.json(certificates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
