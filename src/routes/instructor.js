const express = require("express");
const bcrypt = require("bcryptjs");
const Instructor = require("../models/Instructor");
const Student = require("../models/Student");
const Course = require("../models/Course");
const Quiz = require("../models/Quiz");
const User = require("../models/User");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// AWS S3 setup
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({
  region: "ap-southeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = "bluverse-lms";

async function uploadPhotoToS3(file) {
  const key = `instructor-photos/${Date.now()}-${file.originalname}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      // ACL: 'public-read' // Optional if bucket policy already allows public read
    })
  );
  return `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${key}`;
}

// Instructor Signup API (with photo upload)
router.post("/signup", upload.single("photo"), async (req, res) => {
  try {
    const {
      userName,
      email,
      password,
      role,
      firstName,
      lastName,
      phoneNumber,
      bio,
      education,
      experience,
    } = req.body;

    if (!userName || !email || !password || role !== "instructor") {
      return res.status(400).json({ error: "Missing or invalid fields" });
    }

    const existingEmail = await Instructor.findOne({ email });
    if (existingEmail)
      return res.status(400).json({ error: "Email already registered" });
    const existingUser = await Instructor.findOne({ userName });
    if (existingUser)
      return res.status(400).json({ error: "User name already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const modulesList = [
      { name: "courses", isDisable: true },
      { name: "assignments", isDisable: true },
      { name: "students", isDisable: true },
      { name: "quiz", isDisable: true },
      { name: "quizResults", isDisable: true },
      { name: "certificates", isDisable: true },
      { name: "messages", isDisable: true },
      { name: "tickets", isDisable: true },
    ];

    let educationList = [];
    let experienceList = [];
    if (education !== undefined && education !== null) {
      try {
        educationList =
          typeof education === "string" ? JSON.parse(education) : education;
      } catch (err) {
        return res.status(400).json({ error: "Invalid education format" });
      }
    }
    if (experience !== undefined && experience !== null) {
      try {
        experienceList =
          typeof experience === "string" ? JSON.parse(experience) : experience;
      } catch (err) {
        return res.status(400).json({ error: "Invalid experience format" });
      }
    }

    let photoUrl = null;
    if (req.file) {
      photoUrl = await uploadPhotoToS3(req.file);
    }

    const instructor = new Instructor({
      userName,
      email,
      password: hashedPassword,
      role,
      isDisable: true,
      firstName,
      lastName,
      phoneNumber,
      bio,
      photo: photoUrl,
      education: educationList,
      experience: experienceList,
      modules: modulesList,
      courses: [],
      assignments: [],
      students: [],
      quiz: [],
      quizResults: [],
      certificates: [],
      messages: [],
    });

    await instructor.save();
    res.status(201).json({ message: "Instructor registered", instructor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit instructor profile (PATCH /api/instructor/:id), with photo upload
router.patch("/:id", upload.single("photo"), async (req, res) => {
  try {
    const instructorId = req.params.id;
    const updateFields = { ...req.body };
    const { password, oldPassword } = updateFields;
    delete updateFields.password;
    delete updateFields.oldPassword;

    // Parse stringified fields if needed
    if (typeof updateFields.education === "string") {
      try {
        updateFields.education = JSON.parse(updateFields.education);
      } catch {
        return res.status(400).json({ error: "Invalid education format" });
      }
    }
    if (typeof updateFields.experience === "string") {
      try {
        updateFields.experience = JSON.parse(updateFields.experience);
      } catch {
        return res.status(400).json({ error: "Invalid experience format" });
      }
    }

    // Handle photo upload
    if (req.file) {
      updateFields.photo = await uploadPhotoToS3(req.file);
    }

    // ── Resolve the target record: an Instructor, or a User (e.g. admin) ──
    const instructor = await Instructor.findById(instructorId);

    if (instructor) {
      // Password change (instructor) — only if a new password is provided
      if (password) {
        const isMatch = await bcrypt.compare(oldPassword, instructor.password);
        if (!isMatch) {
          return res.status(400).json({ error: "Current password incorrect." });
        }
        updateFields.password = await bcrypt.hash(password, 10);
      }

      const updatedInstructor = await Instructor.findByIdAndUpdate(
        instructorId,
        { $set: updateFields },
        { new: true, runValidators: true }
      );

      const { password: outPwd, ...instructorWithoutPassword } =
        updatedInstructor._doc;
      return res.json({
        message: "Instructor profile updated",
        instructor: {
          id: updatedInstructor._id,
          ...instructorWithoutPassword,
        },
      });
    }

    // Fallback: the id belongs to a User account (admin / generic user).
    // Map the profile fields that exist on the User schema.
    const userAcc = await User.findById(instructorId);
    if (!userAcc) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const userUpdate = {};
    ["firstName", "lastName", "userName", "photo"].forEach((f) => {
      if (updateFields[f] !== undefined) userUpdate[f] = updateFields[f];
    });
    const fn = updateFields.firstName ?? userAcc.firstName ?? "";
    const ln = updateFields.lastName ?? userAcc.lastName ?? "";
    if (fn || ln) userUpdate.name = `${fn} ${ln}`.trim();

    if (password) {
      if (userAcc.password && oldPassword) {
        const ok = await bcrypt.compare(oldPassword, userAcc.password);
        if (!ok) {
          return res.status(400).json({ error: "Current password incorrect." });
        }
      }
      userUpdate.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await User.findByIdAndUpdate(
      instructorId,
      { $set: userUpdate },
      { new: true, runValidators: true }
    );

    const { password: uPwd, ...userWithoutPassword } = updatedUser._doc;
    return res.json({
      message: "Profile updated",
      instructor: {
        id: updatedUser._id,
        ...userWithoutPassword,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all instructors (GET /api/instructor)
router.get("/", async (req, res) => {
  try {
    const instructors = await Instructor.find();
    const instructorsWithoutPassword = instructors.map((instr) => {
      const { password, ...rest } = instr._doc;
      return {
        id: instr._id,
        ...rest,
      };
    });
    res.json({ instructors: instructorsWithoutPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/student-quiz-results", async (req, res) => {
  try {
    const { studentId, courseId } = req.query;

    let students = [];
    if (studentId) {
      const student = await Student.findById(studentId);
      if (!student) return res.status(404).json({ error: "Student not found" });
      students = [student];
    } else {
      students = await Student.find();
    }

    // Get all unique course and quiz IDs you'll need
    const allCourseIds = new Set();
    const allQuizIds = new Set();

    // Gather IDs for later lookup
    students.forEach((student) => {
      let filteredProgresses = student.progress;
      if (courseId) {
        filteredProgresses = filteredProgresses.filter(
          (prog) => prog.courseID === courseId
        );
      }
      filteredProgresses.forEach((prog) => {
        allCourseIds.add(prog.courseID);
        prog.quizzes.forEach((q) => allQuizIds.add(q.quizID));
      });
    });

    // Fetch maps for titles
    const coursesArr = await Course.find({
      _id: { $in: Array.from(allCourseIds) },
    });
    const coursesMap = {};
    coursesArr.forEach((c) => (coursesMap[c._id.toString()] = c.courseTitle));

    const quizzesArr = await Quiz.find({
      _id: { $in: Array.from(allQuizIds) },
    });
    const quizzesMap = {};
    quizzesArr.forEach((qz) => (quizzesMap[qz._id.toString()] = qz.title));

    // Build results
    const results = [];
    for (const student of students) {
      let filteredProgresses = student.progress;
      if (courseId) {
        filteredProgresses = filteredProgresses.filter(
          (prog) => prog.courseID === courseId
        );
      }
      filteredProgresses.forEach((prog) => {
        prog.quizzes.forEach((q) => {
          results.push({
            studentId: student._id,
            studentName:
              student.student?.firstName?.length && student.student?.lastName?.length
                ? student.student?.firstName +
                  " " +
                  (student.student?.lastName || "")
                : student.student.userName,
            courseId: prog.courseID,
            courseTitle: coursesMap[prog.courseID] || "",
            quizID: q.quizID,
            quizTitle: quizzesMap[q.quizID] || "",
            marks: q.marks,
            totalMarks: q.totalMarks,
            percent: q.totalMarks
              ? Math.round((q.marks / q.totalMarks) * 100)
              : 0,
            totalAttempts: q.totalAttempts || 1,
            lastAttemptDate: q.lastAttemptDate,
            completed: q.completed,
          });
        });
      });
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get instructor by id (GET /api/instructor/:id)
router.get("/:id", async (req, res) => {
  try {
    const instructor = await Instructor.findById(req.params.id);
    if (!instructor) {
      return res.status(404).json({ error: "Instructor not found" });
    }
    const { password, ...instructorWithoutPassword } = instructor._doc;
    res.json({
      instructor: {
        id: instructor._id,
        ...instructorWithoutPassword,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
