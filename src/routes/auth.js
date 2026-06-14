const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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
      // Block login until the email is verified.
      // Gate on a pending OTP so pre-existing accounts (which never had a
      // verification step) are not locked out — only accounts with an
      // outstanding verification code are blocked.
      if (!user.student.emailVerified && user.student.verificationOtp) {
        return res.status(403).json({
          message: "Please verify your email before logging in.",
          needsVerification: true,
          email: user.student.email,
        });
      }

      // ── Single-device login ──
      // Keep only still-valid (non-expired) session tokens. If any remain,
      // the account is already active on another device — block this login.
      const activeTokens = (user.student.current_logged_in_locations || [])
        .filter((t) => {
          try {
            jwt.verify(t, process.env.JWT_SECRET);
            return true;
          } catch {
            return false; // expired / invalid → drop it
          }
        });
      if (activeTokens.length > 0) {
        // Persist the cleaned list (drops any expired tokens)
        user.student.current_logged_in_locations = activeTokens;
        user.markModified("student.current_logged_in_locations");
        await user.save();
        return res.status(409).json({
          message:
            "You're already logged in on another device. Please log out there first.",
          alreadyLoggedIn: true,
        });
      }

      const token = generateToken(user);
      // Record this as the one active session
      user.student.current_logged_in_locations = [token];
      user.markModified("student.current_logged_in_locations");
      await user.save();

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

// Logout — clears the current session token so the account can log in again.
// Matches by the token string itself (works even if the token has expired).
router.post('/logout', async (req, res) => {
  try {
    const token =
      req.header('Authorization')?.replace('Bearer ', '') || req.body?.token;
    if (!token) return res.status(400).json({ error: 'No token provided' });

    await Student.updateMany(
      { 'student.current_logged_in_locations': token },
      { $pull: { 'student.current_logged_in_locations': token } }
    );

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test route
router.get('/', (req, res) => res.send('Auth API works!'));

module.exports = router;