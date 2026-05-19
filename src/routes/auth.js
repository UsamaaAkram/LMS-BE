const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Instructor = require('../models/Instructor');
const Student = require('../models/Student');
const generateToken = require('../utils/generateToken');
const router = express.Router();


// Register
router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  const userExists = await User.findOne({ email });
  if (userExists) return res.status(400).send('User already exists');
  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, password: hashed, role });
  res.json({ user, token: generateToken(user) });
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Try logging in as User
  let user = await User.findOne({ email });

  // If not found, try as Instructor
  if (!user) {
    user = await Instructor.findOne({ email });
  }

  // If still not found, try as Student (use nested query)
  if (!user) {
    user = await Student.findOne({ "student.email": email });
    if (user) {
      // Compare with student.password
      if (!user.student || !user.student.password) {
        return res.status(400).send('Invalid credentials');
      }
      const passwordMatch = await bcrypt.compare(password, user.student.password);
      if (!passwordMatch) {
        return res.status(400).send('Invalid credentials');
      }
      const token = generateToken(user);
      // Exclude the password
      const { password: pwd, ...userWithoutPassword } = user._doc;
      if (userWithoutPassword.student) delete userWithoutPassword.student.password;

      return res.json({
        user: {
          id: user._id,
          name: userWithoutPassword.student?.firstName || userWithoutPassword.student?.userName,
          ...userWithoutPassword
        },
        token
      });
    }
  }

  // No user found or it's User/Instructor
  if (!user) {
    return res.status(400).send('Invalid credentials');
  }

  // This is for User or Instructor where password is not nested
  if (!user.password) {
    return res.status(400).send('Invalid credentials');
  }
  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) {
    return res.status(400).send('Invalid credentials');
  }

  const token = generateToken(user);
  const { password: pwd, ...userWithoutPassword } = user._doc;
  res.json({
    user: {
      id: user._id,
      name: user.name || user.userName,
      ...userWithoutPassword
    },
    token
  });
});

// Test route
router.get('/', (req, res) => res.send('Auth API works!'));

module.exports = router;