const mongoose = require("mongoose");

const InvoiceItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },
    description: { type: String, required: true },
    unitPrice: { type: Number, required: true },
    qty: { type: Number, required: true, default: 1 },
    total: { type: Number, required: true },
  },
  { _id: false }
);

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceId: { type: String, required: true, unique: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, required: true },
    customerCity: { type: String, default: "" },
    classType: { type: String, default: "" },         // optional — hidden on receipt if empty
    batchNo: { type: String, default: "" },            // optional — hidden on receipt if empty
    items: { type: [InvoiceItemSchema], required: true },
    subTotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },          // percentage e.g. 10 = 10%
    discountAmount: { type: Number, default: 0 },     // calculated RS value
    totalAmount: { type: Number, required: true },
    pendingAmount: { type: Number, default: 0 },       // remaining/unpaid amount
    pendingAmountDate: { type: Date, default: null },  // date the pending amount is due
    amountInWords: { type: String, required: true },
    paymentMethod: {
      type: String,
      enum: ["Cash", "Bank Transfer", "JazzCash", "Easypaisa"],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Completed"],
      default: "Pending",
    },
    dueDate: { type: Date, required: true },
    notes: { type: String, default: "" },
    pdfUrl: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Invoice", InvoiceSchema);