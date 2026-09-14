const jwt = require("jsonwebtoken");

// For routes that are PUBLIC but behave differently for staff.
//
// The shop and the success-stories listings must work logged out, yet the admin
// screens read the same endpoints with ?includeDrafts=true. A hard jwtAuth
// would break the public page; no auth at all means the flag is open to
// everyone. So: if a Bearer token is present and valid, attach req.user; if it
// is missing or bad, carry on as an anonymous visitor.
//
// It never rejects — deciding what an anonymous caller may see is the route's
// job, not this middleware's.
const optionalAuth = (req, _res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return next();
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    // An expired or forged token is treated exactly like no token at all.
    // Note this deliberately skips the student active-session check that
    // jwtAuth performs: nothing here is student-specific, and the only thing
    // a token buys on these routes is the staff draft view.
  }
  next();
};

module.exports = optionalAuth;
