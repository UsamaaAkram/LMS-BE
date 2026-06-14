const jwt = require("jsonwebtoken");

// Verifies the Bearer JWT and attaches the decoded payload ({ id, email, role })
// to req.user. Unlike authMiddleware.js (which looks up the User collection),
// this works for student / instructor / admin tokens alike, since the payload
// itself carries id/email/role.
const jwtAuth = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "No token, authorization denied" });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

module.exports = jwtAuth;
