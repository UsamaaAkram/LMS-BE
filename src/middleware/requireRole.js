// Role guard. Use AFTER jwtAuth (which sets req.user = { id, email, role }).
// Returns 403 unless the authenticated user's role is in the allowed list.
//
//   router.use(jwtAuth, requireRole("admin", "instructor"));
//
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res
      .status(403)
      .json({ error: "Forbidden: you do not have access to this resource" });
  }
  next();
};

module.exports = requireRole;
