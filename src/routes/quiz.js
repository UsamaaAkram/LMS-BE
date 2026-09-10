const express = require("express");
const router = express.Router();
const Quiz = require("../models/Quiz");
const Course = require("../models/Course");
const Student = require("../models/Student");

// CREATE Quiz
router.post("/", async (req, res) => {
  try {
    const { courseID, lessonID, title, totalMarks, passMark, duration, questions } =
      req.body;
    if (!courseID || !title || !totalMarks || !passMark || !duration) {
      return res
        .status(400)
        .json({ error: "All fields except 'questions' are required." });
    }
    const quiz = new Quiz({
      courseID,
      lessonID: lessonID || "",
      title,
      totalMarks,
      passMark,
      duration,
      questions: Array.isArray(questions) ? questions : [],
    });
    await quiz.save();
    await Course.findByIdAndUpdate(courseID, { $inc: { quizzesCount: 1 } });
    res.status(201).json(quiz);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET ALL (with optional search by title, or scoped to one course for the
// Course Watch Quiz tab — #29)
router.get("/", async (req, res) => {
  try {
    const query = {};
    if (req.query.search) {
      query.title = { $regex: req.query.search, $options: "i" };
    }
    if (req.query.courseID) {
      query.courseID = req.query.courseID;
    }
    const quizzes = await Quiz.find(query);
    res.json(quizzes);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// NOTE: this must stay ABOVE the "/:id" routes. Express matches in order, so
// while it sat below them the literal path "submitted-quizzes" was captured by
// "/:id", treated as a quiz id, and failed with a cast error — the endpoint
// never actually worked.
//
// GET all student quiz attempts (mirrors /api/assignments/submitted-assignments
// for #34's "Student Submissions" tab).
//
// Per-question review IS available now: the submit route records every answer
// with the question and choice text as it stood at the time. Attempts taken
// before that was added come back with an empty history, and the client shows
// the score alone for those rather than implying detail it doesn't have.
router.get("/submitted-quizzes", async (req, res) => {
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
        for (const quiz of prog.quizzes || []) {
          results.push({
            studentId: student._id,
            studentName:
              student.student.firstName && student.student.lastName
                ? `${student.student.firstName} ${student.student.lastName}`
                : student.student.userName,
            courseId: prog.courseID,
            quizID: quiz.quizID,
            marks: quiz.marks,
            totalMarks: quiz.totalMarks,
            percent:
              quiz.totalMarks > 0
                ? Math.round((quiz.marks / quiz.totalMarks) * 100)
                : 0,
            totalAttempts: quiz.totalAttempts,
            lastAttemptDate: quiz.lastAttemptDate,
            completed: quiz.completed,
            // #34 — newest attempt first, so the review panel opens on the
            // most recent sitting without the client having to sort.
            attempts: [...(quiz.attempts || [])]
              .sort((a, b) => (b.attemptNumber || 0) - (a.attemptNumber || 0))
              .map((a) => ({
                attemptNumber: a.attemptNumber,
                marks: a.marks,
                totalMarks: a.totalMarks,
                percentage: a.percentage,
                passed: a.passed,
                timeTakenSeconds: a.timeTakenSeconds,
                attemptedAt: a.attemptedAt,
                answers: a.answers || [],
              })),
          });
        }
      }
    }

    res.json({ quizzes: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET BY ID
router.get("/:id", async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });
    res.json(quiz);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE BY ID
router.put("/:id", async (req, res) => {
  try {
    // Accept all fields, including questions array
    const quiz = await Quiz.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });
    res.json(quiz);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE BY ID
router.delete("/:id", async (req, res) => {
  try {
    const quiz = await Quiz.findByIdAndDelete(req.params.id);
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });
    // Update Course quizzesCount (-1)
    if (quiz.courseID) {
      await Course.findByIdAndUpdate(quiz.courseID, {
        $inc: { quizzesCount: -1 },
      });
    }
    res.json({ message: "Quiz deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET Quiz for student - removes isCorrect from choices
router.get('/:id/for-student', async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).lean();
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    // Deep clone and strip isCorrect from every choice
    const sanitizedQuiz = {
      ...quiz,
      questions: (quiz.questions || []).map(q => ({
        ...q,
        choices: (q.choices || []).map(({ label, _id }) => ({
          label,
          _id
        }))
      }))
    };

    res.json(sanitizedQuiz);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
