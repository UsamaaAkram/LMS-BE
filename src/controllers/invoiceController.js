const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs").promises;
const Invoice = require("../models/Invoice");
const User = require("../models/User");
const { getCatalogItem, INVOICE_ITEMS } = require("../utils/invoiceCatalog");
const generateInvoiceId = require("../utils/invoiceIdGenerator");
const amountToWords = require("../utils/amountToWords");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({
  region: "ap-southeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = "bluverse-lms";

async function uploadInvoicePdfToS3(pdfBuffer, filename) {
  const key = `invoices/${Date.now()}-${filename}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: pdfBuffer,
      ContentType: "application/pdf",
      ContentDisposition: `attachment; filename="${filename}"`,
    })
  );
  return `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${key}`;
}

/**
 * Build the invoice PDF HTML from a saved invoice document.
 * Shared by create and update so the rendered receipt stays consistent.
 */
async function buildInvoiceHtml(invoice, createdByName) {
  const invoicesDir = path.join(__dirname, "../invoices");
  let html = await fs.readFile(path.join(invoicesDir, "template.html"), "utf8");

  const logoBase64 = await fs.readFile(path.join(invoicesDir, "logo.PNG"), "base64");
  const stampBase64 = await fs.readFile(path.join(invoicesDir, "stamp.PNG"), "base64");

  html = html
    .replace(/\$\{logoBase64\}/g, `data:image/png;base64,${logoBase64}`)
    .replace(/\$\{stampBase64\}/g, `data:image/png;base64,${stampBase64}`);

  const itemsRows = invoice.items
    .map(
      (item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td class="fw-bold">${item.description}</td>
        <td class="text-center">${item.qty}</td>
        <td class="text-right">Rs. ${item.unitPrice.toLocaleString()}</td>
        <td class="text-right">Rs. ${item.total.toLocaleString()}</td>
      </tr>`
    )
    .join("");

  const createdDate = new Date(invoice.createdAt).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
  const dueDateFormatted = new Date(invoice.dueDate).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });

  const statusBadgeClass =
    invoice.paymentStatus === "Completed" ? "status-completed" : "status-pending";

  const discountRow =
    invoice.discountAmount > 0
      ? `<div class="row"><span>Discount ${invoice.discount}%</span><span>- Rs. ${invoice.discountAmount.toLocaleString()}</span></div>`
      : "";

  // Pending amount (+ optional date) — only if there is a pending amount
  let pendingRow = "";
  if (invoice.pendingAmount && invoice.pendingAmount > 0) {
    const pendingDate = invoice.pendingAmountDate
      ? new Date(invoice.pendingAmountDate).toLocaleDateString("en-US", {
          year: "numeric", month: "short", day: "numeric",
        })
      : "";
    pendingRow =
      `<div class="row"><span>Pending Amount</span><span>Rs. ${invoice.pendingAmount.toLocaleString()}</span></div>` +
      (pendingDate
        ? `<div class="row"><span>Pending By</span><span>${pendingDate}</span></div>`
        : "");
  }

  // Optional enrollment details — hidden on receipt if empty
  const classTypeRow = invoice.classType
    ? `<p>Class Type : ${invoice.classType}</p>`
    : "";
  const batchNoRow = invoice.batchNo
    ? `<p>Batch No : ${invoice.batchNo}</p>`
    : "";

  const notesSection = invoice.notes
    ? `<div class="notes" style="margin-bottom:10px;"><h6>Notes</h6><p>${invoice.notes}</p></div>`
    : "";

  html = html
    .replace(/\$\{invoiceId\}/g, invoice.invoiceId)
    .replace(/\$\{createdDate\}/g, createdDate)
    .replace(/\$\{dueDate\}/g, dueDateFormatted)
    .replace(/\$\{customerName\}/g, invoice.customerName)
    .replace(/\$\{customerEmail\}/g, invoice.customerEmail)
    .replace(/\$\{customerPhone\}/g, invoice.customerPhone)
    .replace(/\$\{customerCity\}/g, invoice.customerCity)
    .replace(/\$\{paymentMethod\}/g, invoice.paymentMethod)
    .replace(/\$\{paymentStatus\}/g, invoice.paymentStatus)
    .replace(/\$\{statusBadgeClass\}/g, statusBadgeClass)
    .replace(/\$\{itemsRows\}/g, itemsRows)
    .replace(/\$\{subTotal\}/g, invoice.subTotal.toLocaleString())
    .replace(/\$\{totalAmount\}/g, invoice.totalAmount.toLocaleString())
    .replace(/\$\{createdByName\}/g, createdByName);

  // These contain HTML with $ signs, so use split/join
  html = html.split("${discountRow}").join(discountRow);
  html = html.split("${pendingRow}").join(pendingRow);
  html = html.split("${classTypeRow}").join(classTypeRow);
  html = html.split("${batchNoRow}").join(batchNoRow);
  html = html.split("${notesSection}").join(notesSection);

  return html;
}

async function generateInvoicePdfBuffer(html) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", right: "10mm", left: "10mm", bottom: "12mm" },
  });
  await browser.close();
  return pdfBuffer;
}

/**
 * CREATE Invoice
 */
exports.createInvoice = async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      customerCity,
      classType,
      batchNo,
      items,
      discount,
      paymentMethod,
      paymentStatus,
      dueDate,
      notes,
      pendingAmount,
      pendingAmountDate,
      createdBy,
    } = req.body;

    if (
      !customerName ||
      !customerEmail ||
      !customerPhone ||
      !items ||
      !Array.isArray(items) ||
      items.length === 0 ||
      !paymentMethod ||
      !dueDate ||
      !createdBy
    ) {
      return res
        .status(400)
        .json({ error: "All required fields must be provided." });
    }

    // Resolve items — catalog items by itemId, plus manually charged custom items
    const resolvedItems = [];
    for (const item of items) {
      const qty = item.qty || 1;

      // Manually charged fee: custom description + amount (not from catalog)
      if (item.isManual || item.itemId === "MANUAL") {
        const unitPrice = Number(item.unitPrice);
        if (!item.description || !unitPrice || unitPrice <= 0) {
          return res.status(400).json({
            error: "Manual fee requires a description and a valid amount.",
          });
        }
        resolvedItems.push({
          itemId: "MANUAL",
          description: item.description,
          unitPrice,
          qty,
          total: unitPrice * qty,
        });
        continue;
      }

      const catalogItem = getCatalogItem(item.itemId);
      if (!catalogItem) {
        return res
          .status(400)
          .json({ error: `Invalid item: ${item.itemId}` });
      }
      resolvedItems.push({
        itemId: catalogItem.itemId,
        description: catalogItem.description,
        unitPrice: catalogItem.unitPrice,
        qty,
        total: catalogItem.unitPrice * qty,
      });
    }

    // Calculate totals
    const subTotal = resolvedItems.reduce((sum, item) => sum + item.total, 0);
    const discountPercent = discount || 0;
    const discountAmount = Math.round((subTotal * discountPercent) / 100);
    const totalAmount = subTotal - discountAmount;
    const amountWords = amountToWords(totalAmount);

    const invoiceId = await generateInvoiceId();

    const invoice = new Invoice({
      invoiceId,
      customerName,
      customerEmail,
      customerPhone,
      customerCity,
      classType: classType || "",
      batchNo: batchNo || "",
      items: resolvedItems,
      subTotal,
      discount: discountPercent,
      discountAmount,
      totalAmount,
      pendingAmount: Number(pendingAmount) || 0,
      pendingAmountDate: pendingAmountDate || null,
      amountInWords: amountWords,
      paymentMethod,
      paymentStatus: paymentStatus || "Pending",
      dueDate,
      notes: notes || "",
      createdBy,
    });

    await invoice.save();

    // Get admin name for signature
    let createdByName = "Admin";
    try {
      const adminUser = await User.findById(createdBy).select("name userName");
      if (adminUser) {
        createdByName = adminUser.name || adminUser.userName || "Admin";
      }
    } catch (e) {}

    // ===== GENERATE PDF =====
    const html = await buildInvoiceHtml(invoice, createdByName);
    const pdfBuffer = await generateInvoicePdfBuffer(html);

    // Upload to S3
    const filename = `invoice_${invoiceId}.pdf`;
    const pdfUrl = await uploadInvoicePdfToS3(pdfBuffer, filename);

    invoice.pdfUrl = pdfUrl;
    await invoice.save();

    res.status(201).json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET All Invoices
 */
exports.getAllInvoices = async (req, res) => {
  try {
    const query = {};
    if (req.query.paymentStatus) query.paymentStatus = req.query.paymentStatus;
    if (req.query.paymentMethod) query.paymentMethod = req.query.paymentMethod;
    if (req.query.customerCity) {
      query.customerCity = { $regex: req.query.customerCity, $options: "i" };
    }
    if (req.query.search) {
      query.$or = [
        { customerName: { $regex: req.query.search, $options: "i" } },
        { customerEmail: { $regex: req.query.search, $options: "i" } },
        { invoiceId: { $regex: req.query.search, $options: "i" } },
      ];
    }
    const invoices = await Invoice.find(query).sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET Single Invoice
 */
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * UPDATE Invoice (+ regenerate PDF)
 */
exports.updateInvoice = async (req, res) => {
  try {
    const {
      paymentStatus,
      paymentMethod,
      dueDate,
      notes,
      classType,
      batchNo,
      pendingAmount,
      pendingAmountDate,
    } = req.body;

    const updateFields = {};
    if (paymentStatus) updateFields.paymentStatus = paymentStatus;
    if (paymentMethod) updateFields.paymentMethod = paymentMethod;
    if (dueDate) updateFields.dueDate = dueDate;
    if (notes !== undefined) updateFields.notes = notes;
    if (classType !== undefined) updateFields.classType = classType;
    if (batchNo !== undefined) updateFields.batchNo = batchNo;
    if (pendingAmount !== undefined)
      updateFields.pendingAmount = Number(pendingAmount) || 0;
    if (pendingAmountDate !== undefined)
      updateFields.pendingAmountDate = pendingAmountDate || null;

    const invoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    // Regenerate PDF if any rendered field changed
    if (Object.keys(updateFields).length > 0) {
      let createdByName = "Admin";
      try {
        const adminUser = await User.findById(invoice.createdBy).select("name userName");
        if (adminUser) createdByName = adminUser.name || adminUser.userName || "Admin";
      } catch (e) {}

      const html = await buildInvoiceHtml(invoice, createdByName);
      const pdfBuffer = await generateInvoicePdfBuffer(html);

      const filename = `invoice_${invoice.invoiceId}.pdf`;
      const pdfUrl = await uploadInvoicePdfToS3(pdfBuffer, filename);
      invoice.pdfUrl = pdfUrl;
      await invoice.save();
    }

    res.json(invoice);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE Invoice
 */
exports.deleteInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    res.json({ message: "Invoice deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET Item Catalog
 */
exports.getItemCatalog = async (req, res) => {
  res.json(INVOICE_ITEMS);
};