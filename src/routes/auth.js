const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Instructor = require('../models/Instructor');
const Student = require('../models/Student');
const generateToken = require('../utils/generateToken');
const parseUserAgent = require('../utils/parseUserAgent');
const router = express.Router();

// A session with no activity in this long is treated as abandoned (e.g.
// browser data was cleared without hitting Logout) and no longer counts
// against the 2-device cap. Mirrors the JWT lifetime by default.
const SESSION_INACTIVITY_MS =
  (parseInt(process.env.SESSION_INACTIVITY_DAYS, 10) || 7) * 24 * 60 * 60 * 1000;

const publicSession = (s) => ({
  id: s.sessionId,
  device: s.device,
  browser: s.browser,
  loginTime: s.loginTime,
  lastActiveTime: s.lastActiveTime,
});


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

      // ── Up to 2 concurrent device sessions ──
      // Drop sessions with no activity in SESSION_INACTIVITY_MS (abandoned —
      // e.g. browser data cleared without hitting Logout) before checking
      // the cap, so those don't hold a slot forever.
      const now = Date.now();
      let sessions = (user.student.activeSessions || []).filter(
        (s) => now - new Date(s.lastActiveTime).getTime() < SESSION_INACTIVITY_MS
      );

      // Caller may pass the id of a session (from a previous 409 response)
      // to evict it and continue logging in — this is the "remove a device"
      // flow, gated behind re-entering the correct password above.
      const { removeSessionId } = req.body;
      if (removeSessionId) {
        sessions = sessions.filter((s) => s.sessionId !== removeSessionId);
      }

      if (sessions.length >= 2) {
        user.student.activeSessions = sessions;
        user.markModified("student.activeSessions");
        await user.save();
        return res.status(409).json({
          message:
            "This account is already signed in on 2 devices. Log out one to continue.",
          limitReached: true,
          sessions: sessions.map(publicSession),
        });
      }

      const jti = crypto.randomUUID();
      const token = generateToken(user, jti);
      const { device, browser } = parseUserAgent(req.headers["user-agent"]);
      sessions.push({
        sessionId: jti,
        device,
        browser,
        ip: req.ip || "",
        loginTime: now,
        lastActiveTime: now,
      });
      user.student.activeSessions = sessions;
      user.markModified("student.activeSessions");
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

// Logout — removes this device's session so it frees a slot and the token
// stops being accepted immediately (see jwtAuth.js). Decodes without
// verifying so logout still works once the token has expired.
router.post('/logout', async (req, res) => {
  try {
    const token =
      req.header('Authorization')?.replace('Bearer ', '') || req.body?.token;
    if (!token) return res.status(400).json({ error: 'No token provided' });

    const decoded = jwt.decode(token);
    if (decoded?.jti) {
      await Student.updateMany(
        { 'student.activeSessions.sessionId': decoded.jti },
        { $pull: { 'student.activeSessions': { sessionId: decoded.jti } } }
      );
    }

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test route
router.get('/', (req, res) => res.send('Auth API works!'));

module.exports = router;