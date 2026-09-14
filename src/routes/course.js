const express = require("express");
const router = express.Router();

const jwtAuth = require("../middleware/jwtAuth");
const requireRole = require("../middleware/requireRole");
// Staff = anyone who may administer the catalogue and the queues.
const staffOnly = [jwtAuth, requireRole("admin", "instructor")];

const Course = require("../models/Course");
const Student = require("../models/Student");
const Assignment = require("../models/Assignment");
const Quiz = require("../models/Quiz");
const Instructor = require("../models/Instructor");
const Enrollment = require("../models/Enrollment");
const { uniqueSlug } = require("../utils/slugify");
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
// Creating a course is a staff action; this was open to anyone.
router.post("/", staffOnly, upload.single("courseThumbnail"), async (req, res) => {
  try {
    let curriculum = [];
    if (req.body.curriculum) {
      curriculum =
        typeof req.body.curriculum === "string"
          ? JSON.parse(req.body.curriculum)
          : req.body.curriculum;
    }

    // #47 plans — arrive JSON-encoded over multipart. Tolerate malformed input
    // rather than 500ing the whole course creation over one bad field.
    let plans = [];
    if (req.body.plans) {
      try {
        plans =
          typeof req.body.plans === "string"
            ? JSON.parse(req.body.plans)
            : req.body.plans;
      } catch {
        plans = [];
      }
      if (!Array.isArray(plans)) plans = [];
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
      // #18: kept as free text so "Free" / "Contact Us" / "Rs. 15,000" all
      // survive. Number() here used to silently turn every label into 0.
      price: req.body.price || "",
      originalPrice: req.body.originalPrice || "",
      // This route is multipart, so a boolean arrives as the string "true".
      freeAccess:
        req.body.freeAccess === true || req.body.freeAccess === "true",
      curriculum,
      studentCount: req.body.studentCount || 0,
      quizzesCount: req.body.quizzesCount || 0,
      notes: req.body.notes,
      status: req.body.status,
      duration: req.body.duration,
      createdBy: req.body.createdBy,
      lmsGuideTitle: req.body.lmsGuideTitle || "",
      lmsGuideDescription: req.body.lmsGuideDescription || "",
      lmsGuideVdoId: req.body.lmsGuideVdoId || "",
      plans,
      // #48 — derived from the title, de-duplicated. An admin-supplied slug
      // wins so a course URL can be curated.
      slug: await uniqueSlug(Course, req.body.slug || req.body.courseTitle),
    };

    const course = new Course(courseData);
    await course.save();
    res.status(201).json(course);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET ALL or FILTER by status (unchanged)
// studentCount used to be a static field set (or not) at creation time and
// never updated as students enrolled/left — hence "Enrolled: 0" even with
// real enrollments. Enrollment.model is unused (see delete handler below);
// Student.enrolledCourses is the actual source of truth, so compute live.
async function attachLiveStudentCounts(courses) {
  const ids = courses.map((c) => c._id.toString());
  const counts = await Student.aggregate([
    { $match: { enrolledCourses: { $in: ids } } },
    { $unwind: "$enrolledCourses" },
    { $match: { enrolledCourses: { $in: ids } } },
    { $group: { _id: "$enrolledCourses", count: { $sum: 1 } } },
  ]);
  const countById = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  courses.forEach((c) => {
    c.studentCount = countById[c._id.toString()] || 0;
  });
}

router.get("/", async (req, res) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.search) {
      query.courseTitle = { $regex: req.query.search, $options: "i" };
    }
    const courses = await Course.find(query);
    await attachLiveStudentCounts(courses);
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
    await attachLiveStudentCounts([course]);
    res.json(course);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE by id
// Staff only.
router.put("/:id", staffOnly, async (req, res) => {
  try {
    const body = { ...req.body };

    // #48 — keep a slug present and unique.
    //
    // Deliberately NOT re-slugged on every title edit: the slug is a public URL
    // that may already be shared or indexed, and silently changing it would
    // break those links. It's only filled in when missing, or when an admin
    // sends one explicitly.
    const existing = await Course.findById(req.params.id).select("slug");
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (body.slug) {
      body.slug = await uniqueSlug(Course, body.slug, req.params.id);
    } else if (!existing.slug) {
      body.slug = await uniqueSlug(
        Course,
        body.courseTitle || "course",
        req.params.id
      );
    } else {
      delete body.slug; // leave the current one alone
    }

    const course = await Course.findByIdAndUpdate(req.params.id, body, {
      new: true,
    });
    if (!course) return res.status(404).json({ error: "Not found" });
    res.json(course);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET one by slug (#48) — powers /courses/<slug> without exposing an id.
// Registered before "/:id" would matter, but the distinct /slug/ prefix keeps
// the two from ever being ambiguous.
router.get("/slug/:slug", async (req, res) => {
  try {
    const course = await Course.findOne({ slug: req.params.slug });
    if (!course) return res.status(404).json({ error: "Course not found" });
    await attachLiveStudentCounts([course]);
    res.json(course);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE by id — cascades to all data linked to the course
// Staff only.
router.delete("/:id", staffOnly, async (req, res) => {
  try {
    const courseId = req.params.id;

    const course = await Course.findByIdAndDelete(courseId);
    if (!course) return res.status(404).json({ error: "Not found" });

    // 1) Course-linked content
    await Assignment.deleteMany({ courseID: courseId });
    await Quiz.deleteMany({ courseID: courseId });

    // 2) Student side — enrollment, wishlist, progress & certificates for this course
    await Student.updateMany(
      {},
      {
        $pull: {
          enrolledCourses: courseId,
          wishlist: courseId,
          progress: { courseID: courseId },
          certificates: { courseID: courseId },
        },
      }
    );

    // 3) Instructor course-list references
    await Instructor.updateMany({}, { $pull: { courses: courseId } });

    // 4) Orphaned enrollment records (legacy model, if any)
    try {
      await Enrollment.deleteMany({ course: courseId });
    } catch (e) {
      /* Enrollment model unused — ignore */
    }

    res.json({
      message: "Course and all related data deleted",
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET enrolled courses for a student
// A student's own enrolments — requires a signed-in user.
router.get("/:studentId/enrolled-courses", jwtAuth, async (req, res) => {
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
// Course content — requires a signed-in user.
router.get("/:courseId/assignments", jwtAuth, async (req, res) => {
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
