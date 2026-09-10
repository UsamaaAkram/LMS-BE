// One-off: converts the pre-expansion order statuses to the brief's vocabulary
// and gives every order a readable reference.
//
// Safe to re-run: each step only touches rows that still need it.
//
//   node scripts/backfill-order-statuses.js
require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../src/models/Order");

const { LEGACY_STATUS_MAP } = Order;

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  for (const [from, to] of Object.entries(LEGACY_STATUS_MAP)) {
    const r = await Order.updateMany({ status: from }, { $set: { status: to } });
    console.log(`status "${from}" -> "${to}": ${r.modifiedCount} updated`);
  }

  // Readable references, oldest first so the sequence follows real order.
  const missing = await Order.find({
    $or: [{ orderId: { $exists: false } }, { orderId: null }, { orderId: "" }],
  })
    .sort({ createdAt: 1 })
    .select("_id createdAt");

  let assigned = 0;
  const perYear = {};
  // Seed each year's counter past whatever is already stored, so a backfill
  // can't hand out a reference that an existing order already holds.
  for (const o of missing) {
    const year = new Date(o.createdAt || Date.now()).getFullYear();
    if (perYear[year] === undefined) {
      const prefix = `ORD-${year}-`;
      const last = await Order.findOne({ orderId: new RegExp(`^${prefix}`) })
        .sort({ orderId: -1 })
        .select("orderId")
        .lean();
      const n = last ? parseInt(String(last.orderId).slice(prefix.length), 10) : 0;
      perYear[year] = Number.isFinite(n) ? n : 0;
    }
    perYear[year] += 1;
    const ref = `ORD-${year}-${String(perYear[year]).padStart(6, "0")}`;
    await Order.updateOne({ _id: o._id }, { $set: { orderId: ref } });
    assigned++;
  }
  console.log(`orderId assigned: ${assigned}`);

  // Seed a first history entry for orders that predate statusHistory, so the
  // student's timeline is not blank for them.
  const noHistory = await Order.find({
    $or: [{ statusHistory: { $exists: false } }, { statusHistory: { $size: 0 } }],
  }).select("_id status createdAt");
  for (const o of noHistory) {
    await Order.updateOne(
      { _id: o._id },
      {
        $set: {
          statusHistory: [
            { status: o.status, at: o.createdAt || new Date(), byName: "", byRole: "", note: "Imported" },
          ],
        },
      }
    );
  }
  console.log(`statusHistory seeded: ${noHistory.length}`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
