// One-off: writes the default record type onto invoices that never got one.
//
// Invoice.mode has `default: "online"`, but rows created before the field
// existed stored nothing. The invoice table labels anything that is not
// "onsite" as Online, so those rows displayed as Online while an exact
// `mode: "online"` filter skipped them — visible in the All tab, absent from
// the Online tab.
//
// The controller now treats "not onsite" as online, so the UI is already
// correct without this. Running it makes the stored data match what is shown,
// which keeps reporting and any future exact-match query honest.
//
// Safe to re-run: only touches rows with no value, and never changes "onsite".
//
//   node scripts/backfill-invoice-mode.js
require("dotenv").config();
const mongoose = require("mongoose");
const Invoice = require("../src/models/Invoice");

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const missing = { $in: [null, ""] };
  const before = await Invoice.countDocuments({ mode: missing });
  console.log(`Invoices with no record type: ${before}`);

  if (before) {
    const r = await Invoice.updateMany(
      { mode: missing },
      { $set: { mode: "online" } }
    );
    console.log(`Set to "online": ${r.modifiedCount}`);
  }

  const online = await Invoice.countDocuments({ mode: "online" });
  const onsite = await Invoice.countDocuments({ mode: "onsite" });
  const stillMissing = await Invoice.countDocuments({ mode: missing });
  console.log(
    `\nNow: online=${online}  onsite=${onsite}  still missing=${stillMissing}`
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
