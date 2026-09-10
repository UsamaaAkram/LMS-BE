/**
 * #48 — gives every existing course a URL slug.
 *
 * New courses get one on create, but courses that already existed have none, so
 * /courses/<slug> would 404 for them. Idempotent: re-running only fills gaps.
 *
 *   node scripts/backfill-course-slugs.js
 */
require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");
const Course = require("../src/models/Course");
const { uniqueSlug } = require("../src/utils/slugify");

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const missing = await Course.find({
    $or: [{ slug: { $exists: false } }, { slug: null }, { slug: "" }],
  }).select("_id courseTitle slug");

  console.log(`courses without a slug: ${missing.length}`);
  for (const c of missing) {
    const slug = await uniqueSlug(Course, c.courseTitle, c._id);
    await Course.updateOne({ _id: c._id }, { $set: { slug } });
    console.log(`  ${c.courseTitle} -> ${slug}`);
  }

  const total = await Course.countDocuments();
  const withSlug = await Course.countDocuments({
    slug: { $exists: true, $nin: [null, ""] },
  });
  console.log(`done: ${withSlug}/${total} courses have a slug`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
