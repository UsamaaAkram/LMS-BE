const mongoose = require("mongoose");

// Shop (#42) — monetized accounts, AI tool subscriptions, VPNs/RDPs/hosting,
// etc. Buy Now hands off to WhatsApp (no payment gateway); Order below
// tracks the manual payment-proof/delivery pipeline on top of that (#43).
const ProductSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    // #48 — readable URL segment, e.g. /shop/capcut-pro. Sparse so existing
    // products without one don't collide on null under the unique index.
    slug: { type: String, unique: true, sparse: true, index: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    // #18 applies to the Shop too ("must work everywhere price is shown ...
    // Shop cards, Product details page"). String, so "Contact Us" / "Coming
    // Soon" work alongside real amounts. Legacy numeric rows read back as
    // strings; the frontend's coursePrice helper handles the "0" case.
    price: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    // How delivery works once an order is approved — free text for the
    // admin reviewing the order to know what to hand over, not
    // auto-generated (these are real accounts/keys/subscriptions).
    deliveryNote: { type: String, default: "" },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", ProductSchema);
