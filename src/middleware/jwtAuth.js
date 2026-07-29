const jwt = require("jsonwebtoken");
const Student = require("../models/Student");

// Verifies the Bearer JWT and attaches the decoded payload ({ id, email, role })
// to req.user. Unlike authMiddleware.js (which looks up the User collection),
// this works for student / instructor / admin tokens alike, since the payload
// itself carries id/email/role.
//
// For students, signature validity alone isn't enough: a logged-out token is
// still signature-valid until it naturally expires. So we additionally check
// the token's jti is still present in Student.activeSessions (see
// routes/auth.js) — this is what makes Logout revoke a session immediately
// instead of just forgetting the token client-side. Non-blocking best-effort
// update of lastActiveTime piggybacks on the same lookup.
const jwtAuth = async (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "No token, authorization denied" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;

    if (decoded.role === "student" && decoded.jti) {
      const student = await Student.findOne(
        { _id: decoded.id, "student.activeSessions.sessionId": decoded.jti },
        { _id: 1 }
      );
      if (!student) {
        return res.status(401).json({ error: "Invalid or expired token" });
      }
      // Fire-and-forget so this doesn't add latency to the request.
      Student.updateOne(
        { _id: decoded.id, "student.activeSessions.sessionId": decoded.jti },
        { $set: { "student.activeSessions.$.lastActiveTime": new Date() } }
      ).catch(() => {});
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

module.exports = jwtAuth;
