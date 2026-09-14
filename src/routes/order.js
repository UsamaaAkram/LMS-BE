const express = require("express");
const requireSelfOrStaff = require("../middleware/requireSelfOrStaff");
const router = express.Router();

const multer = require("multer");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const { notify } = require("../utils/notify");
const upload = multer();


const jwtAuth = require("../middleware/jwtAuth");
const requireRole = require("../middleware/requireRole");
const staffOnly = [jwtAuth, requireRole("admin", "instructor")];

const { STATUS_FLOW, STATUSES, LEGACY_STATUS_MAP, DELIVERY_TYPES } = Order;

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

const STAFF = ["admin", "superadmin", "super-admin", "instructor", "teacher"];
const isStaff = (role) => STAFF.includes(String(role || "").toLowerCase());

// The role ALWAYS comes from the verified token, never from the request. These
// checks previously read req.body.role / req.query.role, which the caller
// controls — with no authentication on the route, anyone could simply send
// role:"admin" and pass. Reading req.user means the signature had to verify.
const actorRole = (req) => req.user?.role;
const actorLabel = (req) => req.user?.name || req.user?.email || req.user?.role || "";

/** Statuses at which the delivery fields become visible to the student. */
const DELIVERED_STATES = ["Product Delivered", "Completed"];
const norm = (s) => LEGACY_STATUS_MAP[s] || s;

/**
 * ORD-YYYY-NNNNNN, sequential within the year.
 *
 * Derived from a count rather than a stored counter, so a retry on the unique
 * index is the safety net: two orders placed in the same millisecond would
 * otherwise both compute the same number and the second would be rejected
 * outright instead of taking the next one.
 */
async function nextOrderId() {
  const year = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const last = await Order.findOne({ orderId: new RegExp(`^${prefix}`) })
    .sort({ orderId: -1 })
    .select("orderId")
    .lean();
  let n = last ? parseInt(String(last.orderId).slice(prefix.length), 10) + 1 : 1;
  if (!Number.isFinite(n) || n < 1) n = 1;
  return `${prefix}${String(n).padStart(6, "0")}`;
}

/** Appends a transition and keeps `status` in step. One place, so they can't diverge. */
function applyStatus(order, status, actor, note) {
  order.status = status;
  order.statusHistory.push({
    status,
    at: new Date(),
    byName: actor?.name || "",
    byRole: actor?.role || "",
    note: note || "",
  });
}

/** Best-effort customer notification. Never allowed to fail the request. */
function tellCustomer(req, order, title, body, type) {
  notify(
    order.studentId,
    {
      type: type || "order_status",
      title,
      body,
      link: "/student/my-products",
      actorName: "Bluverse Shop",
    },
    req.app.get("io")
  );
}

// ---------------------------------------------------------------------------
// CREATE — the customer submits payment proof (brief §1).
// ---------------------------------------------------------------------------
// Placing an order requires a signed-in customer.
router.post("/", jwtAuth, upload.single("paymentScreenshot"), async (req, res) => {
  try {
    const {
      productId,
      studentId,
      studentName,
      studentEmail,
      transactionId,
      paymentMethod,
      customerNote,
    } = req.body;
    if (!productId || !studentId) {
      return res.status(400).json({ error: "productId and studentId are required." });
    }
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      // A malformed id used to reach the cast layer and surface as a 500.
      return res.status(404).json({ error: "Product not found" });
    }
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: "Product not found" });

    let paymentScreenshotUrl = "";
    if (req.file) {
      if (req.file.size > 10 * 1024 * 1024) {
        return res
          .status(400)
          .json({ error: "That screenshot is larger than 10MB. Please upload a smaller one." });
      }
      paymentScreenshotUrl = await uploadToS3(req.file, "order-payment-proofs");
    }

    // An order with no proof at all is a dead row in the admin's queue: there
    // is nothing to verify. It is still allowed, but it stays at Pending
    // Payment rather than entering the review queue.
    const hasProof = !!(paymentScreenshotUrl || String(transactionId || "").trim());

    const order = new Order({
      product: productId,
      productTitle: product.title,
      productImageUrl: product.imageUrl || "",
      // Snapshot the price at purchase time so the admin can check the payment
      // screenshot against it, and later edits to the product can't rewrite
      // what this customer was charged.
      pricePaid: product.price ?? "",
      studentId,
      studentName: studentName || "",
      studentEmail: studentEmail || "",
      paymentScreenshotUrl,
      transactionId: String(transactionId || "").trim(),
      paymentMethod: String(paymentMethod || "").trim(),
      customerNote: String(customerNote || "").trim(),
      status: hasProof ? "Pending Verification" : "Pending Payment",
    });
    order.statusHistory.push({
      status: order.status,
      byName: studentName || "Customer",
      byRole: "student",
      note: hasProof ? "Payment proof submitted" : "Order created",
    });

    // Retry once on a unique-index collision from two concurrent submissions
    // computing the same sequence number.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        order.orderId = await nextOrderId();
        await order.save();
        break;
      } catch (e) {
        if (e?.code === 11000 && attempt < 4) continue;
        throw e;
      }
    }

    if (hasProof) {
      tellCustomer(
        req,
        order,
        "Payment proof received",
        `We're verifying your payment for ${order.productTitle}. Reference ${order.orderId}.`
      );
    }
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Static paths must be declared before "/:id", or Express matches them as ids.
// ---------------------------------------------------------------------------

/** The status vocabulary and delivery types, so the UI never hardcodes them. */
router.get("/meta/options", (req, res) => {
  res.json({ statusFlow: STATUS_FLOW, statuses: STATUSES, deliveryTypes: DELIVERY_TYPES });
});

// The student's own orders — "My Products" (brief §4). Uses toStudentJSON so
// delivery details stay sealed until the order is actually delivered.
// A customer's own orders.
// requireSelfOrStaff is applied INLINE here, not via router.param: this file
// authenticates per route rather than with router.use, and Express runs param
// callbacks BEFORE a route's own middleware — so the ownership check would run
// with no req.user and deny every request.
router.get("/my/:studentId", jwtAuth, requireSelfOrStaff("studentId"), async (req, res) => {
  try {
    const orders = await Order.find({ studentId: req.params.studentId }).sort({
      createdAt: -1,
    });
    res.json(orders.map((o) => o.toStudentJSON()));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Look an order up by its readable reference, e.g. from a WhatsApp message. */
// Requires login: references are sequential, and after delivery this
// response carries the licence key or login credentials.
router.get("/ref/:orderId", jwtAuth, async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(isStaff(actorRole(req)) ? order : order.toStudentJSON());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Admin queue (brief §2 and §9) — filters, search, counts.
// ---------------------------------------------------------------------------
// The review queue — staff only.
router.get("/", staffOnly, async (req, res) => {
  try {
    const query = {};
    if (req.query.studentId) query.studentId = req.query.studentId;

    if (req.query.status) {
      // Accept a legacy name in the filter and match BOTH spellings, so a
      // queue filtered by "Pending Verification" still surfaces rows that
      // haven't been backfilled yet.
      const wanted = norm(req.query.status);
      const aliases = Object.keys(LEGACY_STATUS_MAP).filter(
        (k) => LEGACY_STATUS_MAP[k] === wanted
      );
      query.status = { $in: [wanted, ...aliases] };
    }

    const q = String(req.query.search || "").trim();
    if (q) {
      // Escaped: an unescaped "(" or "+" from a search box throws an invalid
      // regex and 500s the whole queue.
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { orderId: rx },
        { studentName: rx },
        { studentEmail: rx },
        { productTitle: rx },
        { transactionId: rx },
      ];
    }

    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const orders = await Order.find(query).sort({ createdAt: -1 }).limit(limit);

    // Counts per stage for the filter chips. Computed over the same search
    // scope minus the status filter, so the chips describe what the current
    // search would return rather than the whole table.
    const countQuery = { ...query };
    delete countQuery.status;
    const grouped = await Order.aggregate([
      { $match: countQuery },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const counts = {};
    grouped.forEach((g) => {
      const k = norm(g._id);
      counts[k] = (counts[k] || 0) + g.n;
    });

    res.json({ orders, counts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Requires a signed-in user.
router.get("/:id", jwtAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: "Order not found" });
    }
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(isStaff(actorRole(req)) ? order : order.toStudentJSON());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Admin review — move the order through the workflow (brief §3).
// ---------------------------------------------------------------------------
// Staff only.
router.patch("/:id/status", staffOnly, async (req, res) => {
  try {
    const { status, deliveredContent, adminNote, rejectionReason } = req.body;
    const role = actorRole(req);
    const actorName = actorLabel(req);
    if (!isStaff(role)) {
      return res.status(403).json({ error: "Only staff can update an order's status." });
    }
    const wanted = norm(status);
    if (!STATUSES.includes(wanted)) {
      return res.status(400).json({ error: "Invalid status." });
    }
    // A rejection the customer can't act on is the complaint this whole brief
    // is about, so the reason is required rather than optional.
    if (wanted === "Rejected" && !String(rejectionReason || "").trim()) {
      return res
        .status(400)
        .json({ error: "Give a reason for the rejection — the customer sees it." });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: "Order not found" });
    }
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Moving to a delivered state with nothing to hand over is how "approved
    // but nothing arrived" happens — the exact failure the client reported.
    if (DELIVERED_STATES.includes(wanted)) {
      const d = order.delivery || {};
      const hasSomething =
        String(d.value || "").trim() ||
        String(d.username || "").trim() ||
        String(d.instructions || "").trim() ||
        String(deliveredContent || "").trim() ||
        String(order.deliveredContent || "").trim();
      if (!hasSomething) {
        return res.status(400).json({
          error:
            "Add the delivery details first — marking this delivered would show the customer an empty product.",
        });
      }
    }

    const before = norm(order.status);
    if (adminNote !== undefined) order.adminNote = adminNote;
    if (deliveredContent !== undefined) order.deliveredContent = deliveredContent;
    if (wanted === "Rejected") order.rejectionReason = String(rejectionReason).trim();

    applyStatus(order, wanted, { name: actorName, role }, adminNote);

    // Stamp the delivery time when it first reaches a delivered state, so a
    // later move to Completed doesn't overwrite when it actually shipped.
    if (DELIVERED_STATES.includes(wanted) && !order.delivery?.deliveredAt) {
      order.delivery.deliveredAt = new Date();
      if (actorName) order.delivery.deliveredByName = actorName;
    }
    await order.save();

    if (before !== wanted) {
      const messages = {
        "Payment Verified": [
          "Payment verified",
          `Your payment for ${order.productTitle} has been verified.`,
        ],
        Processing: ["Order processing", `We're preparing ${order.productTitle}.`],
        "Product Delivered": [
          "Your product is ready",
          `${order.productTitle} has been delivered — open My Products to access it.`,
        ],
        Completed: ["Order completed", `${order.productTitle} is complete. Thank you!`],
        Rejected: [
          "Payment could not be verified",
          order.rejectionReason || `We couldn't verify your payment for ${order.productTitle}.`,
        ],
      };
      const m = messages[wanted];
      if (m) {
        tellCustomer(
          req,
          order,
          m[0],
          m[1],
          wanted === "Product Delivered" ? "order_delivered" : "order_status"
        );
      }
    }
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Delivery (brief §5). Separate from the status patch so an admin can fill the
// details in first and release them as one deliberate action, and so the
// "delivered with nothing attached" case above is impossible to reach.
// ---------------------------------------------------------------------------
// Staff only.
router.patch("/:id/deliver", staffOnly, async (req, res) => {
  try {
    const {
      type,
      value,
      username,
      password,
      instructions,
      markDelivered = true,
    } = req.body;
    const role = actorRole(req);
    const actorName = actorLabel(req);
    if (!isStaff(role)) {
      return res.status(403).json({ error: "Only staff can deliver an order." });
    }
    if (type && !DELIVERY_TYPES.includes(type)) {
      return res.status(400).json({ error: "Invalid delivery type." });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: "Order not found" });
    }
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const t = type || order.delivery?.type || "Other";
    const nextValue = value !== undefined ? String(value).trim() : order.delivery?.value || "";
    const nextUser =
      username !== undefined ? String(username).trim() : order.delivery?.username || "";
    const nextPass =
      password !== undefined ? String(password).trim() : order.delivery?.password || "";
    const nextInstr =
      instructions !== undefined
        ? String(instructions).trim()
        : order.delivery?.instructions || "";

    // Login Credentials is the one type where a bare `value` is meaningless —
    // the client's brief says login details specifically never arrived, so
    // require the username here rather than accepting a blank handover.
    if (t === "Login Credentials" && !nextUser) {
      return res.status(400).json({ error: "Enter the username for the login credentials." });
    }
    if (t !== "Login Credentials" && !nextValue && !nextInstr) {
      return res
        .status(400)
        .json({ error: "Enter the link, key or instructions to hand over." });
    }

    order.delivery = {
      ...(order.delivery ? order.delivery.toObject() : {}),
      type: t,
      value: nextValue,
      username: nextUser,
      password: nextPass,
      instructions: nextInstr,
    };

    if (markDelivered) {
      order.delivery.deliveredAt = order.delivery.deliveredAt || new Date();
      if (actorName) order.delivery.deliveredByName = actorName;
      if (norm(order.status) !== "Completed") {
        applyStatus(order, "Product Delivered", { name: actorName, role }, "Product delivered");
      }
    }
    await order.save();

    if (markDelivered) {
      tellCustomer(
        req,
        order,
        "Your product is ready",
        `${order.productTitle} has been delivered — open My Products to access it.`,
        "order_delivered"
      );
    }
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
