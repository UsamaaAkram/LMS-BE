const express = require("express");
const router = express.Router();
const Course = require("../models/Course");
const Student = require("../models/Student");
const Assignment = require("../models/Assignment");
const multer = require("multer");
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

// CREATE (POST /api/courses)
router.post("/", upload.single("courseThumbnail"), async (req, res) => {
  try {
    let curriculum = [];
    if (req.body.curriculum) {
      curriculum =
        typeof req.body.curriculum === "string"
          ? JSON.parse(req.body.curriculum)
          : req.body.curriculum;
    }

    let courseThumbnailUrl = "";
    if (req.file) {
      const s3Key = `course-thumbnails/${Date.now()}-${req.file.originalname}`;
      const uploadParams = {
        Bucket: BUCKET,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        // ACL: 'public-read' // Optional if your bucket policy allows public read
      };
      await s3Client.send(new PutObjectCommand(uploadParams));
      // Permanent public URL
      courseThumbnailUrl = `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${s3Key}`;
    } else {
      courseThumbnailUrl = req.body.courseThumbnailUrl || "";
    }

    const courseData = {
      courseTitle: req.body.courseTitle,
      courseCategory: req.body.courseCategory,
      courseLevel: req.body.courseLevel,
      courseDescription: req.body.courseDescription,
      courseThumbnail: null, // Now only using URL
      courseThumbnailUrl, // Permanent public S3 URL
      courseVideoProvider: req.body.courseVideoProvider,
      courseVideoUrl: req.body.courseVideoUrl,
      curriculum,
      studentCount: req.body.studentCount || 0,
      quizzesCount: req.body.quizzesCount || 0,
      notes: req.body.notes,
      status: req.body.status,
      duration: req.body.duration,
      createdBy: req.body.createdBy,
    };

    const course = new Course(courseData);
    await course.save();
    res.status(201).json(course);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET ALL or FILTER by status (unchanged)
router.get("/", async (req, res) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.search) {
      query.courseTitle = { $regex: req.query.search, $options: "i" };
    }
    const courses = await Course.find(query);
    res.json(courses);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET by id (unchanged)
router.get("/:id", async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: "Not found" });
    res.json(course);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE by id (unchanged logic)
router.put("/:id", async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!course) return res.status(404).json({ error: "Not found" });
    res.json(course);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE by id (unchanged logic)
router.delete("/:id", async (req, res) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Course deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET enrolled courses for a student
router.get("/:studentId/enrolled-courses", async (req, res) => {
  try {
    // 1. Find the student by ID
    const student = await Student.findById(req.params.studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

    // 2. Extract enrolledCourses array (array of courseIDs)
    const courseIds = student.enrolledCourses || [];

    // 3. Find all Course docs with those IDs
    const courses = await Course.find({ _id: { $in: courseIds } });

    // 4. Respond with full course list
    res.json({ enrolledCourses: courses });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET published assignments for a course
router.get("/:courseId/assignments", async (req, res) => {
  try {
     const { courseId } = req.params;
    // Only fetch assignments with status "Published"
    const assignments = await Assignment.find({ 
      courseID: courseId, 
      status: "Published" 
    });
    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
