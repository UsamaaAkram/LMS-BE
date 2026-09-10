const express = require("express");
const router = express.Router();
const multer = require("multer");
const Ticket = require("../models/Ticket");
const { notify } = require("../utils/notify");
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

// TicketID format (#12) — was a random 12-char alphanumeric blob, now a
// readable SUP-<year>-<5 digits> id matching the doc's example (#SUP-2026-00125).
function generateTicketID() {
  const year = new Date().getFullYear();
  const num = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  return `SUP-${year}-${num}`;
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
    const {
      Date,
      Subject,
      Priority,
      Category,
      Status,
      Description,
      createdBy,
      createdByName,
      createdByEmail,
      Replies,
    } = req.body;
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
      createdByName: createdByName || "",
      createdByEmail: createdByEmail || "",
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
    // Read-only locking (#41) — once Closed, nothing (including new
    // replies, which go through this same route) can change it.
    const existing = await Ticket.findById(req.params.id);
    if (existing?.Status === "Closed") {
      return res
        .status(400)
        .json({ error: "This ticket is closed and locked from further changes." });
    }
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

// Staff-side resolve/close (#41) — a dedicated status transition instead
// of routing every status change through the full-ticket PUT, and blocks
// further edits once Closed (read-only locking).
router.patch("/:id/status", async (req, res) => {
  try {
    const { Status } = req.body;
    if (!["Opened", "Inprogress", "Resolved", "Closed"].includes(Status)) {
      return res.status(400).json({ error: "Invalid status." });
    }
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    if (ticket.Status === "Closed") {
      return res
        .status(400)
        .json({ error: "This ticket is closed and locked from further changes." });
    }
    ticket.Status = Status;
    if (Status === "Resolved") ticket.resolvedConfirmed = null; // awaiting student confirmation
    await ticket.save();
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// #43 — append a single reply to the conversation.
//
// Replies used to be sent through the full-ticket PUT, which meant the client
// had to resend the ENTIRE Replies array. Two people replying at the same time
// would each submit an array built from a stale read, so the second write
// silently dropped the first reply. $push appends server-side, so concurrent
// replies can't clobber each other and the client never sends the history back.
router.post("/:id/reply", upload.single("attachment"), async (req, res) => {
  try {
    const { userID, email, userName, name, message, role, photo } =
      req.body || {};
    if (!userID || !email || !message || !String(message).trim()) {
      return res
        .status(400)
        .json({ error: "userID, email and a non-empty message are required." });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    // Resolved/Closed tickets are read-only for everyone (#43 item 6).
    if (ticket.Status === "Closed" || ticket.Status === "Resolved") {
      return res.status(400).json({
        error: `This ticket is ${ticket.Status.toLowerCase()} and no longer accepts replies.`,
      });
    }

    let attachment = null;
    if (req.file) attachment = await uploadAttachmentToS3(req.file);

    const reply = {
      userID,
      email,
      userName: userName || "",
      name: name || "",
      message: String(message).trim(),
      date: new Date().toISOString(),
      role: role || "",
      photo: photo || "",
      attachment,
    };

    const updated = await Ticket.findByIdAndUpdate(
      req.params.id,
      {
        $push: { Replies: reply },
        // A reply from staff moves an untouched ticket into "Inprogress" so the
        // status timeline reflects reality without a second manual step.
        ...(ticket.Status === "Opened" && role && role !== "student"
          ? { $set: { Status: "Inprogress" } }
          : {}),
      },
      { new: true }
    );

    // #43.8 — tell the other side. A staff reply notifies the ticket owner; a
    // student reply notifies whichever staff have already replied, so we don't
    // spam everyone with an admin role.
    const isStaffReply = role && role !== "student";
    if (isStaffReply) {
      await notify(
        ticket.createdBy,
        {
          type: "ticket_reply",
          title: `Support replied to ${ticket.TicketID}`,
          body: String(message).trim().slice(0, 140),
          link: "/support-tickets",
          actorName: name || userName || "Support",
        },
        req.app.get("io")
      );
    } else {
      const staffIds = (updated.Replies || [])
        .filter((r) => r.role && r.role !== "student")
        .map((r) => r.userID);
      await notify(
        staffIds,
        {
          type: "ticket_reply",
          title: `New reply on ${ticket.TicketID}`,
          body: String(message).trim().slice(0, 140),
          link: "/instructor/instructor-tickets",
          actorName: name || userName || "Student",
        },
        req.app.get("io")
      );
    }

    res.status(201).json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Student confirms whether a "Resolved" ticket is actually fixed (#41's
// "was your issue resolved?" flow). Yes -> Closed (locked). No -> reopened
// to Inprogress so staff can keep working it.
router.post("/:id/confirm-resolved", async (req, res) => {
  try {
    const { confirmed } = req.body;
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });

    // Already finished — nothing left to confirm.
    if (ticket.Status === "Closed") {
      return res
        .status(400)
        .json({ error: "This ticket is closed and locked from further changes." });
    }

    // #43 item 4: the prompt is offered once support has actually responded —
    // either a staff reply landed on the thread, or staff explicitly moved the
    // ticket to Resolved. Asking before anyone replied makes no sense.
    const hasStaffReply = (ticket.Replies || []).some(
      (r) => r.role && r.role !== "student"
    );
    if (ticket.Status !== "Resolved" && !hasStaffReply) {
      return res.status(400).json({
        error: "Support hasn't replied to this ticket yet.",
      });
    }

    ticket.resolvedConfirmed = !!confirmed;
    // Yes -> done and read-only. No -> stays open so staff can keep working it.
    ticket.Status = confirmed ? "Closed" : "Inprogress";
    await ticket.save();
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
