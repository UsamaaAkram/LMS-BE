// One-off: gives existing instructors any permission module their record is
// missing, created DISABLED.
//
// Why this is needed: the admin's module toggle screen is built by looping over
// the entries already on the instructor, so a module that was never created has
// no switch and can never be granted. "receipts" was in the Instructor schema's
// enum from the start but was never added at signup, which left every
// instructor permanently locked out of the Receipts / Create Invoice screen
// while being told to ask an administrator to enable it.
//
// Safe to re-run: only adds what is missing, and never changes an existing
// entry — so an already-granted permission is not silently revoked.
//
//   node scripts/backfill-instructor-modules.js
require("dotenv").config();
const mongoose = require("mongoose");
const Instructor = require("../src/models/Instructor");

// Must stay in step with the list in routes/instructor.js.
const EXPECTED = [
  "courses",
  "assignments",
  "students",
  "quiz",
  "quizResults",
  "certificates",
  "messages",
  "tickets",
  "receipts",
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const instructors = await Instructor.find().select("userName modules");
  let changed = 0;

  for (const inst of instructors) {
    const have = new Set((inst.modules || []).map((m) => String(m.name)));
    const missing = EXPECTED.filter((n) => !have.has(n));
    if (!missing.length) continue;

    inst.modules.push(...missing.map((name) => ({ name, isDisable: true })));
    await inst.save();
    changed++;
    console.log(
      `${inst.userName || inst._id}: added ${missing.join(", ")} (disabled)`
    );
  }

  console.log(
    `\n${changed} of ${instructors.length} instructor(s) updated. ` +
      `Enable a module per instructor from All Instructors -> edit.`
  );
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
