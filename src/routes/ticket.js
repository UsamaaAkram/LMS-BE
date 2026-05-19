const express = require("express");
const router = express.Router();
const multer = require("multer");
const Ticket = require("../models/Ticket");
const upload = multer();

// AWS S3 setup
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({
  region: "ap-southeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = "bluverse-lms";

// Random TicketID Utility
function generateTicketID() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 9; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id + Date.now().toString().slice(-3);
}

// Helper: Upload file to S3 and get signed GET URL
async function uploadAttachmentToS3(file) {
  const key = `ticket-attachments/${Date.now()}-${file.originalname}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      // ACL: 'public-read' // optional; bucket policy should allow public read
    })
  );
  // Return permanent public S3 URL for the uploaded file
  return `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${key}`;
}

// CREATE (single attachment only)
router.post("/", upload.single("Attachments"), async (req, res) => {
  try {
    const { Date, Subject, Priority, Category, Status, Description, createdBy, Replies } =
      req.body;
    if (
      !Date ||
      !Subject ||
      !Priority ||
      !Category ||
      !Status ||
      !Description || 
      !createdBy // <--- require createdBy!
    ) {
      return res
        .status(400)
        .json({ error: "All fields except Attachments and Replies required." });
    }
    const TicketID = generateTicketID();

    // Upload file to S3 (if attached)
    let Attachments = null;
    if (req.file) {
      Attachments = await uploadAttachmentToS3(req.file);
    }

    let repliesArr = [];
    if (Replies) {
      if (typeof Replies === "string") {
        try {
          repliesArr = JSON.parse(Replies);
        } catch {
          repliesArr = [];
        }
      } else if (Array.isArray(Replies)) {
        repliesArr = Replies;
      }
    }
    const ticket = new Ticket({
      TicketID,
      Date,
      Subject,
      Priority,
      Category,
      Status,
      Description,
      Attachments,
      Replies: repliesArr,
      createdBy, 
    });
    await ticket.save();
    res.status(201).json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET ALL + Search/Filter
router.get("/", async (req, res) => {
  try {
    const query = {};
    // if (req.query.Subject)
    //   query.Subject = { $regex: req.query.Subject, $options: "i" };
    if (req.query.TicketID) query.TicketID = req.query.TicketID;
    if (req.query.Category) query.Category = req.query.Category;
    if (req.query.Priority) query.Priority = req.query.Priority;
    if (req.query.Status) query.Status = req.query.Status;
    const tickets = await Ticket.find(query);
    res.json(tickets);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET BY ID
router.get("/:id", async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE (single attachment only)
router.put("/:id", upload.single("Attachments"), async (req, res) => {
  try {
    const { Date, Subject, Priority, Category, Status, Description, Replies } =
      req.body;
    if (
      !Date ||
      !Subject ||
      !Priority ||
      !Category ||
      !Status ||
      !Description
    ) {
      return res
        .status(400)
        .json({ error: "All fields except Attachments and Replies required." });
    }
    // Upload file to S3 if present
    let Attachments = req.body.Attachments || null;
    if (req.file) {
      Attachments = await uploadAttachmentToS3(req.file);
    }
    let repliesArr = [];
    if (Replies) {
      if (typeof Replies === "string") {
        try {
          repliesArr = JSON.parse(Replies);
        } catch {
          repliesArr = [];
        }
      } else if (Array.isArray(Replies)) {
        repliesArr = Replies;
      }
    }

    const updateFields = {
      Date,
      Subject,
      Priority,
      Category,
      Status,
      Description,
      Attachments,
      Replies: repliesArr,
    };
    const ticket = await Ticket.findByIdAndUpdate(req.params.id, updateFields, {
      new: true,
      runValidators: true,
    });
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const ticket = await Ticket.findByIdAndDelete(req.params.id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    res.json({ message: "Ticket deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET ALL BY USER + Search/Filter
router.get("/by-user/:userId", async (req, res) => {
  try {
    const query = { createdBy: req.params.userId }; // Always filter by user

    // if (req.query.Subject)
    //   query.Subject = { $regex: req.query.Subject, $options: "i" };
    if (req.query.TicketID)
      query.TicketID = req.query.TicketID;
    if (req.query.Category)
      query.Category = req.query.Category;
    if (req.query.Priority)
      query.Priority = req.query.Priority;
    if (req.query.Status)
      query.Status = req.query.Status;

    const tickets = await Ticket.find(query);
    res.json(tickets);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
