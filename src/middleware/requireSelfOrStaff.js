// Authorisation, as opposed to authentication.
//
// jwtAuth proves WHO is calling. It does not stop a signed-in student reading
// somebody else's records by editing the id in the URL — every
// /:studentId/... endpoint was reachable by any authenticated user for any
// student. This closes that.
//
// Staff pass through unconditionally: an instructor reviewing a submission or
// an admin opening a student's profile is legitimately operating on an id that
// is not their own.
//
//   router.get("/:studentId/certificates", jwtAuth, requireSelfOrStaff(), ...)
//
// Must run AFTER jwtAuth — without req.user it denies, which is the safe
// direction but means a misordered route fails closed and loudly rather than
// silently letting everyone through.

const STAFF = ["admin", "superadmin", "super-admin", "instructor", "teacher"];

const requireSelfOrStaff = (param = "studentId") => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "No token, authorization denied" });
  }
  if (STAFF.includes(String(req.user.role || "").toLowerCase())) return next();

  const target = req.params[param];
  // A route that names a parameter this middleware cannot find is a wiring
  // mistake, not an authorised request. Deny rather than wave it through.
  if (!target) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (String(req.user.id) !== String(target)) {
    return res
      .status(403)
      .json({ error: "Forbidden: this record belongs to another account" });
  }
  next();
};

module.exports = requireSelfOrStaff;
