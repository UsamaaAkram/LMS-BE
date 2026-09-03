const express = require("express");
const router = express.Router();
const multer = require("multer");
const Order = require("../models/Order");
const Product = require("../models/Product");
const upload = multer();

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const s3Client = new S3Client({
  region: "ap-southeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = "bluverse-lms";

async function uploadToS3(file, folder) {
  const key = `${folder}/${Date.now()}-${file.originalname}`;
  await s3Client.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: file.buffer, ContentType: file.mimetype })
  );
  return `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${key}`;
}

// CREATE — student submits payment proof after buying via WhatsApp (#43).
router.post("/", upload.single("paymentScreenshot"), async (req, res) => {
  try {
    const { productId, studentId, studentName, studentEmail, transactionId } = req.body;
    if (!productId || !studentId) {
      return res.status(400).json({ error: "productId and studentId are required." });
    }
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: "Product not found" });

    let paymentScreenshotUrl = "";
    if (req.file) paymentScreenshotUrl = await uploadToS3(req.file, "order-payment-proofs");

    const order = new Order({
      product: productId,
      productTitle: product.title,
      // Snapshot the price at purchase time so the admin can check the payment
      // screenshot against it, and later edits to the product can't rewrite
      // what this customer was charged.
      pricePaid: product.price ?? "",
      studentId,
      studentName: studentName || "",
      studentEmail: studentEmail || "",
      paymentScreenshotUrl,
      transactionId: transactionId || "",
      status: paymentScreenshotUrl || transactionId ? "Under Review" : "Pending Payment",
    });
    await order.save();
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET ALL (admin review queue), or scoped to one student ("My Orders" — #43)
router.get("/", async (req, res) => {
  try {
    const query = {};
    if (req.query.studentId) query.studentId = req.query.studentId;
    if (req.query.status) query.status = req.query.status;
    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin review — Approve/Reject/Complete, with delivered content once
// approved (#43's "product delivery" + status workflow).
router.patch("/:id/status", async (req, res) => {
  try {
    const { status, deliveredContent, adminNote } = req.body;
    if (!["Pending Payment", "Under Review", "Approved", "Rejected", "Completed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    order.status = status;
    if (deliveredContent !== undefined) order.deliveredContent = deliveredContent;
    if (adminNote !== undefined) order.adminNote = adminNote;
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
