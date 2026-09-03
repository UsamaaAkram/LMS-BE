/**
 * #48 — gives every existing shop product a URL slug, so /shop/<slug> works
 * for products created before slugs existed. Idempotent.
 *
 *   node scripts/backfill-product-slugs.js
 */
require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");
const Product = require("../src/models/Product");
const { uniqueSlug } = require("../src/utils/slugify");

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const missing = await Product.find({
    $or: [{ slug: { $exists: false } }, { slug: null }, { slug: "" }],
  }).select("_id title slug");

  console.log(`products without a slug: ${missing.length}`);
  for (const p of missing) {
    const slug = await uniqueSlug(Product, p.title, p._id);
    await Product.updateOne({ _id: p._id }, { $set: { slug } });
    console.log(`  ${p.title} -> ${slug}`);
  }

  const total = await Product.countDocuments();
  const withSlug = await Product.countDocuments({
    slug: { $exists: true, $nin: [null, ""] },
  });
  console.log(`done: ${withSlug}/${total} products have a slug`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
