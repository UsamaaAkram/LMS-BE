const Instructor = require("../models/Instructor");
const Student = require("../models/Student");
const User = require("../models/User");

// Get all chat users (from all models)
exports.getAllChatUsers = async (req, res) => {
  try {
    const instructors = await Instructor.find(
      {},
      "_id name userName role photo"
    );
    const users = await User.find({}, "_id name userName role photo");

    // Adapt depending on Student schema
    const students = await Student.find({});
    // Flatten students for frontend
    const formattedStudents = students.map((s) => ({
      _id: s._id,
      userName: s?.student?.userName,
      role: "student",
      name:
        s.student.firstName && s.student.lastName
          ? `${s?.student?.firstName} ${s?.student?.lastName}`
          : s.student.userName,
      photo: s?.student?.photo || "",
    }));

    // Format instructors, users if needed (optional)
    const formattedInstructors = instructors.map((i) => ({
      _id: i._id,
      userName: i.userName,
      role: i.role,
      name:   i.firstName && i.lastName
          ? `${i.firstName} ${i.lastName}`
          : i.userName,
      photo: i.photo || "",
    }));

    const formattedUsers = users.map((u) => ({
      _id: u._id,
      userName: u.userName,
      role: u.role,
      name: u.name || "",
      photo: u.photo || "",
    }));

    // Combine
    const allUsers = [
      ...formattedInstructors,
      ...formattedStudents,
      ...formattedUsers,
    ];

    res.json(allUsers);
  } catch (err) {
    res.status(500).json({ error: "Unable to retrieve users." });
  }
};
