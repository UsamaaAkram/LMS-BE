const mongoose = require("mongoose");

// Shop order/payment-proof pipeline (#43, expanded per the client's
// "Shop Payment Verification & Order Management System" brief).
//
// There is no card gateway: money changes hands out-of-band (bank transfer /
// WhatsApp) and this models the proof-of-payment review and the delivery that
// follows. That is deliberate — the brief's own flow is screenshot + manual
// verification, and a real gateway is a separate commercial decision.

// The brief's seven stages, in order. This array IS the timeline the student
// sees, so the order matters and the UI derives progress from it rather than
// keeping its own copy that could drift.
const STATUS_FLOW = [
  "Pending Payment",
  "Pending Verification",
  "Payment Verified",
  "Processing",
  "Product Delivered",
  "Completed",
];
// Rejected is terminal and sits outside the flow — it is not a stage you pass
// through, so putting it in STATUS_FLOW would draw it as the last step of a
// timeline every healthy order also walks.
const STATUSES = [...STATUS_FLOW, "Rejected"];

// Orders created before this expansion carry the old five-value vocabulary.
// They stay valid so an untouched legacy order can still be saved (adding a
// status-history entry, say) instead of throwing a validation error, and any
// write normalises them forward. scripts/backfill-order-statuses.js converts
// the stored rows.
const LEGACY_STATUS_MAP = {
  "Under Review": "Pending Verification",
  Approved: "Payment Verified",
};
const LEGACY_STATUSES = Object.keys(LEGACY_STATUS_MAP);

/** The nine delivery shapes the brief lists, plus a catch-all. */
const DELIVERY_TYPES = [
  "Download Link",
  "Google Drive Link",
  "Google Docs Link",
  "Course Access",
  "External URL",
  "License Key",
  "Activation Code",
  "Login Credentials",
  "Text Instructions",
  "Other",
];

const StatusEventSchema = new mongoose.Schema(
  {
    status: { type: String, default: "" },
    at: { type: Date, default: Date.now },
    // Who moved it. Free text rather than a ref: the actor can be an admin, an
    // instructor or the student themselves, which are three collections.
    byName: { type: String, default: "" },
    byRole: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const DeliverySchema = new mongoose.Schema(
  {
    type: { type: String, enum: DELIVERY_TYPES, default: "Other" },
    /** The link / key / code, depending on type. */
    value: { type: String, default: "" },
    // Credentials are split out because "Login Credentials" is the one shape
    // that is two fields, and the client's brief specifically complains that
    // login details never showed up. Separate fields let the student page
    // label and copy them individually instead of parsing one blob.
    username: { type: String, default: "" },
    password: { type: String, default: "" },
    /** Free-text handover instructions, shown alongside whatever is above. */
    instructions: { type: String, default: "" },
    deliveredAt: { type: Date, default: null },
    deliveredByName: { type: String, default: "" },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    // Human-readable reference. The brief asks for search "by Order ID", and a
    // raw Mongo _id is not something a customer can read off a WhatsApp chat.
    orderId: { type: String, unique: true, sparse: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productTitle: { type: String, required: true }, // denormalized, survives product edits/deletes
    // Snapshotted for the same reason as productTitle: the student's "My
    // Products" card must keep showing what they bought even if the product
    // image is later changed or the product is deleted outright.
    productImageUrl: { type: String, default: "" },
    // The price AS IT WAS when the order was placed.
    //
    // Without this an admin reviewing a payment screenshot has nothing to check
    // the amount against, and once the product's price is edited there is no
    // record of what the customer was actually charged. Free text, matching
    // Product.price (#18), so "Contact Us" is preserved rather than becoming a
    // bogus number.
    pricePaid: { type: String, default: "" },
    studentId: { type: String, required: true },
    studentName: { type: String, default: "" },
    studentEmail: { type: String, default: "" },

    // ---- what the customer submits as proof ----
    paymentScreenshotUrl: { type: String, default: "" },
    transactionId: { type: String, default: "" },
    paymentMethod: { type: String, default: "" },
    /** The brief's "Optional Note" from the customer. */
    customerNote: { type: String, default: "" },

    status: {
      type: String,
      enum: [...STATUSES, ...LEGACY_STATUSES],
      default: "Pending Payment",
    },
    /** Every transition, so the student sees a real history and not just "now". */
    statusHistory: { type: [StatusEventSchema], default: [] },

    delivery: { type: DeliverySchema, default: () => ({}) },
    // Superseded by `delivery`, kept so orders delivered before the expansion
    // still render. The student page falls back to it when delivery.value is
    // empty; dropping it would blank out already-delivered orders.
    deliveredContent: { type: String, default: "" },
    /** Staff-only. Never sent to the student — see toStudentJSON below. */
    adminNote: { type: String, default: "" },
    /** Shown to the student: why a payment was rejected and what to do next. */
    rejectionReason: { type: String, default: "" },
  },
  { timestamps: true }
);

// Covers the queue's own sorts. A text index would not help the brief's search
// fields: three of them (transactionId, orderId, email) are looked up as exact
// or prefix values, not as prose.
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ studentId: 1, createdAt: -1 });
OrderSchema.index({ transactionId: 1 });

/** Normalises a legacy status to its current name; passes others through. */
OrderSchema.statics.normaliseStatus = (s) => LEGACY_STATUS_MAP[s] || s;

/**
 * The student-facing shape. adminNote is internal review commentary and must
 * not leak, and delivery details are withheld until the order actually reaches
 * a delivered state — otherwise a licence key would be readable over the API
 * the moment an admin typed it, before the payment was confirmed.
 */
OrderSchema.methods.toStudentJSON = function () {
  const o = this.toObject();
  delete o.adminNote;
  const released = ["Product Delivered", "Completed"].includes(
    LEGACY_STATUS_MAP[o.status] || o.status
  );
  if (!released) {
    o.delivery = { type: o.delivery?.type || "Other" };
    o.deliveredContent = "";
  }
  return o;
};

const Order = mongoose.model("Order", OrderSchema);

Order.STATUS_FLOW = STATUS_FLOW;
Order.STATUSES = STATUSES;
Order.LEGACY_STATUS_MAP = LEGACY_STATUS_MAP;
Order.DELIVERY_TYPES = DELIVERY_TYPES;

module.exports = Order;
