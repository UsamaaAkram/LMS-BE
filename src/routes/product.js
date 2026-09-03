const express = require("express");
const router = express.Router();
const multer = require("multer");
const Product = require("../models/Product");
const mongoose = require("mongoose");
const { uniqueSlug } = require("../utils/slugify");
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

// CREATE
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { title, description, category, price, deliveryNote, status } = req.body;
    if (!title || !description || !category || !price) {
      return res
        .status(400)
        .json({ error: "title, description, category, and price are required." });
    }
    let imageUrl = "";
    if (req.file) imageUrl = await uploadToS3(req.file, "shop-products");
    const product = new Product({
      title,
      description,
      category,
      // #18 — free text so "Contact Us" / "Coming Soon" survive; Number()
      // here used to silently turn any label into NaN/0.
      price: String(price),
      imageUrl,
      slug: await uniqueSlug(Product, req.body.slug || title),
      deliveryNote: deliveryNote || "",
      status: status || "draft",
    });
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET ALL — public callers only see published products; the admin page
// passes includeDrafts=true.
router.get("/", async (req, res) => {
  try {
    const query = {};
    if (req.query.includeDrafts !== "true") query.status = "published";
    if (req.query.category) query.category = req.query.category;
    if (req.query.search) {
      query.$or = [
        { title: { $regex: req.query.search, $options: "i" } },
        { description: { $regex: req.query.search, $options: "i" } },
      ];
    }
    const products = await Product.find(query).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET one by slug (#48) — powers /shop/<slug> without exposing an id.
router.get("/slug/:slug", async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug });
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid product id." });
    }
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const { title, description, category, price, deliveryNote, status } = req.body;
    const update = { title, description, category, deliveryNote, status };
    if (price !== undefined) update.price = String(price);
    if (req.file) update.imageUrl = await uploadToS3(req.file, "shop-products");

    // #48 — a slug is a public URL that may already be shared, so it is only
    // filled in when missing or when explicitly supplied; never silently
    // rewritten because the title changed.
    const existing = await Product.findById(req.params.id).select("slug");
    if (!existing) return res.status(404).json({ error: "Product not found" });
    if (req.body.slug) {
      update.slug = await uniqueSlug(Product, req.body.slug, req.params.id);
    } else if (!existing.slug) {
      update.slug = await uniqueSlug(Product, title || "product", req.params.id);
    }
    const product = await Product.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
