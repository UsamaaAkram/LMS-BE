const express = require("express");
const router = express.Router();
const Quiz = require("../models/Quiz");
const Course = require("../models/Course");

// CREATE Quiz
router.post("/", async (req, res) => {
  try {
    const { courseID, title, totalMarks, passMark, duration, questions } =
      req.body;
    if (!courseID || !title || !totalMarks || !passMark || !duration) {
      return res
        .status(400)
        .json({ error: "All fields except 'questions' are required." });
    }
    const quiz = new Quiz({
      courseID,
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

// GET ALL (with optional search by title)
router.get("/", async (req, res) => {
  try {
    const query = {};
    if (req.query.search) {
      query.title = { $regex: req.query.search, $options: "i" };
    }
    const quizzes = await Quiz.find(query);
    res.json(quizzes);
  } catch (err) {
    res.status(400).json({ error: err.message });
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
