const mongoose = require("mongoose");

// Shop order/payment-proof pipeline (#43) — the actual money exchange
// happens over WhatsApp (#42's "no payment gateway"); this just tracks
// the proof-of-payment review and delivery status on top of that.
const OrderSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productTitle: { type: String, required: true }, // denormalized, survives product edits/deletes
    // The price AS IT WAS when the order was placed.
    //
    // Without this an admin reviewing a payment screenshot has nothing to check
    // the amount against, and once the product's price is edited there is no
    // record of what the customer was actually charged. Snapshotted for the
    // same reason as productTitle: it must survive later edits to the product.
    // Free text, matching Product.price (#18), so "Contact Us" is preserved
    // rather than becoming a bogus number.
    pricePaid: { type: String, default: "" },
    studentId: { type: String, required: true },
    studentName: { type: String, default: "" },
    studentEmail: { type: String, default: "" },
    paymentScreenshotUrl: { type: String, default: "" },
    transactionId: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Pending Payment", "Under Review", "Approved", "Rejected", "Completed"],
      default: "Pending Payment",
    },
    // Filled in by admin once Approved/Completed — the actual
    // link/key/credentials for the student to use.
    deliveredContent: { type: String, default: "" },
    adminNote: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Order", OrderSchema);
