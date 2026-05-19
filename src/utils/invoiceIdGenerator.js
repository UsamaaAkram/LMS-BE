const Invoice = require("../models/Invoice");

async function generateInvoiceId() {
  const prefix = "657";

  // Find the last invoice sorted by invoiceId descending
  const lastInvoice = await Invoice.findOne({})
    .sort({ invoiceId: -1 })
    .select("invoiceId")
    .lean();

  let nextNumber = 1;

  if (lastInvoice && lastInvoice.invoiceId) {
    const lastNumber = parseInt(lastInvoice.invoiceId.replace(prefix, ""), 10);
    if (!isNaN(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  // Pad to 3 digits minimum: 657001, 657002 ... 657999, 6571000
  const padded = String(nextNumber).padStart(3, "0");
  return `${prefix}${padded}`;
}

module.exports = generateInvoiceId;