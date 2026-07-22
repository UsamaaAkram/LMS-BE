const jwt = require('jsonwebtoken');

// Session lifetime. 1h was far too short for a video-course platform — a
// learner mid-course (or a returning user whose login was restored from
// persisted state) would hit "Invalid or expired token" on the enrollment-
// gated video OTP call. Default to 7 days; override with JWT_EXPIRES_IN.
const generateToken = user => {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

module.exports = generateToken;