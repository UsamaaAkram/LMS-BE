const express = require("express");
const router = express.Router();
const Assignment = require("../models/Assignment");
const Student = require("../models/Student");
const calculateProgress = require("../utils/calculateProgress");

// CREATE
router.post("/", async (req, res) => {
  try {
    const { courseID, title, description, instructions, lastDate, status } =
      req.body;
    if (
      !courseID ||
      !title ||
      !description ||
      !instructions ||
      !lastDate ||
      !status
    ) {
      return res.status(400).json({ error: "All fields are required." });
    }
    const assignment = new Assignment({
      courseID,
      title,
      description,
      instructions,
      lastDate,
      status,
    });
    await assignment.save();
    res.status(201).json(assignment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET ALL, search by title or filter by status
router.get("/", async (req, res) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.search)
      query.title = { $regex: req.query.search, $options: "i" };
    const assignments = await Assignment.find(query);
    res.json(assignments);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ***
// GET submitted assignments, filter by studentId or courseId
router.get("/submitted-assignments", async (req, res) => {
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

    const results = [];
    for (const student of students) {
      let progresses = student.progress || [];
      if (courseId) {
        progresses = progresses.filter((p) => p.courseID === courseId);
      }
      for (const prog of progresses) {
        // 💡 Calculate latest progress for this course WITHOUT saving
        const calc = calculateProgress(prog);

        for (const assignment of prog.assignments || []) {
          results.push({
            studentId: student._id,
            studentName:
              student.student.firstName && student.student.lastName
                ? `${student?.student?.firstName} ${student?.student?.lastName}`
                : student.student.userName,
            courseId: prog.courseID,
            assignmentsID: assignment.assignmentsID,
            assignmentDate: assignment.assignmentDate,
            assignment: assignment.assignment,
            isSubmitted: assignment.isSubmitted,
            progress: {
              percent: calc.grandTotal,
              grandTotal: calc.grandTotal,
              grade: calc.grade,
              detail: calc, // remove if you want only marks
            },
          });
        }
      }
    }

    res.json({ assignments: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET by ID
router.get("/:id", async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ error: "Not found" });
    res.json(assignment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE
router.put("/:id", async (req, res) => {
  try {
    const { courseID, title, description, instructions, lastDate, status } =
      req.body;
    if (
      !courseID ||
      !title ||
      !description ||
      !instructions ||
      !lastDate ||
      !status
    ) {
      return res.status(400).json({ error: "All fields are required." });
    }
    const assignment = await Assignment.findByIdAndUpdate(
      req.params.id,
      { courseID, title, description, instructions, lastDate, status },
      { new: true, runValidators: true }
    );
    if (!assignment) return res.status(404).json({ error: "Not found" });
    res.json(assignment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const assignment = await Assignment.findByIdAndDelete(req.params.id);
    if (!assignment) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Assignment deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
