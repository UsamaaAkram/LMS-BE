const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Session lifetime. 1h was far too short for a video-course platform — a
// learner mid-course (or a returning user whose login was restored from
// persisted state) would hit "Invalid or expired token" on the enrollment-
// gated video OTP call. Default to 7 days; override with JWT_EXPIRES_IN.
//
// jti identifies this token as a specific device session (see
// Student.activeSessions / jwtAuth.js), so logout / session-limit checks
// don't rely on comparing full token strings.
const generateToken = (user, jti = crypto.randomUUID()) => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role, jti },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

module.exports = generateToken;