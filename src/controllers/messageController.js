const Message = require("../models/Message");
const Chat = require("../models/Chat");

// Send new message, supports senderModel (User, Instructor, Student)
exports.sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { sender, senderModel, type, content, attachment, replyTo } =
      req.body;
    if (!sender || !senderModel) {
      return res
        .status(400)
        .json({ error: "Sender and senderModel are required." });
    }
    const message = new Message({
      chat: chatId,
      sender,
      senderModel,
      type: type || "text",
      content,
      attachment: attachment || "",
      replyTo,
    });
    await message.save();
    await Chat.findByIdAndUpdate(chatId, { lastMessage: message._id });
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get messages, paginated (auto-populates sender from correct model)
exports.getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;

    // Fetch most recent first (isDeleted excluded — a deleted message
    // reappearing on refresh was the actual reported bug: #2)
    const messages = await Message.find({ chat: chatId, isDeleted: { $ne: true } })
      .sort({ createdAt: -1 }) // DESCENDING: newest first
      .skip(skip)
      .limit(limit)
      .populate("sender", "name userName photo role photo")
      .populate("replyTo");

    // Optional: Return reversed array to display oldest at top, newest at bottom
    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Edit a message's content (#2 — no edit endpoint existed at all before
// this; only the original sender may edit their own message).
exports.editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content, userId } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Content is required." });
    }
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });

    const isOwner = userId && message.sender.toString() === userId.toString();

    // #2.1 — staff may edit a published announcement (the requirement is that
    // an announcement can be corrected without posting a duplicate).
    //
    // Deliberately limited to the announcement channel: allowing staff to edit
    // any message would let an instructor silently rewrite what a student said
    // in a normal conversation, which is a different thing entirely.
    let staffMayEdit = false;
    if (!isOwner && isStaff(actorRole(req))) {
      const chat = await Chat.findById(message.chat).select("isAnnouncement");
      staffMayEdit = !!chat?.isAnnouncement;
    }

    if (!isOwner && !staffMayEdit) {
      return res
        .status(403)
        .json({ error: "You can only edit your own messages." });
    }
    message.content = content;
    message.editedAt = new Date();
    await message.save();
    res.json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete a message for everyone (#2's delete-reappears bug — deletedFor
// existed on the schema for a per-user "delete for me" but nothing ever
// wrote to it or filtered by it; this is a real delete instead).
// The sender can always delete their own message; an Instructor can
// delete any message (moderating announcement/group chats).
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId, userModel } = req.body;
    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ error: "Message not found" });
    const isOwner = userId && message.sender.toString() === userId.toString();
    const isModerator = userModel === "Instructor" || userModel === "User";
    if (!isOwner && !isModerator) {
      return res
        .status(403)
        .json({ error: "You can only delete your own messages." });
    }
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();
    res.json({ message: "Message deleted." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Search for messages by content (populates sender from correct model)
exports.searchMessages = async (req, res) => {
  const { chatId } = req.params;
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "No query provided" });
  const messages = await Message.find({
    chat: chatId,
    isDeleted: { $ne: true },
    content: { $regex: query, $options: "i" },
  }).populate("sender", "name userName photo role");
  res.json(messages);
};

// ---------------------------------------------------------------------------
// Announcements (#2.1 / #2.4 / #2.7)
//
// Announcements already exist as a real thing: a Chat flagged isAnnouncement,
// which only admins may post into (enforced in the socket handler). What was
// missing was a way to MANAGE them — the Announcements page was template
// scaffolding backed by a static list, with no create, edit, delete or pin.
//
// These endpoints work off that same channel rather than introducing a second
// announcements store, so anything published here also appears in the
// Announcement group in Messages, and vice versa.
// ---------------------------------------------------------------------------

const STAFF = ["admin", "superadmin", "super-admin", "instructor", "teacher"];
const isStaff = (role) => STAFF.includes(String(role || "").toLowerCase());

// Always the verified token, never the request body. These checks used to read
// req.body.role on routes with no authentication, so "role":"admin" in the
// payload was enough to publish, edit or pin an announcement.
const actorRole = (req) => req.user?.role;

/** The announcement channel, or null if one has not been created yet. */
async function findAnnouncementChat() {
  return Chat.findOne({ isAnnouncement: true });
}

// GET /api/messages/announcements — pinned first, then newest.
exports.getAnnouncements = async (req, res) => {
  try {
    const chat = await findAnnouncementChat();
    // Not an error: it only means no announcement group exists yet, and the
    // page should show its empty state rather than a failure.
    if (!chat) return res.json({ chatId: null, announcements: [] });

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const announcements = await Message.find({
      chat: chat._id,
      isDeleted: { $ne: true },
    })
      .sort({ isPinned: -1, pinnedAt: -1, createdAt: -1 })
      .limit(limit)
      .populate("sender", "name userName photo role");

    res.json({ chatId: chat._id, announcements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/messages/announcements — publish a new announcement.
exports.createAnnouncement = async (req, res) => {
  try {
    const { sender, senderModel, content, attachment } = req.body || {};
    const role = actorRole(req);
    if (!sender || !senderModel) {
      return res
        .status(400)
        .json({ error: "Sender and senderModel are required." });
    }
    if (!content || !String(content).trim()) {
      return res.status(400).json({ error: "Write the announcement first." });
    }
    if (!isStaff(role)) {
      return res
        .status(403)
        .json({ error: "Only staff can publish announcements." });
    }
    const chat = await findAnnouncementChat();
    if (!chat) {
      return res.status(404).json({
        error:
          "No announcement group exists yet. Create the Announcements group first.",
      });
    }

    const message = await Message.create({
      chat: chat._id,
      sender,
      senderModel,
      type: attachment ? "attachment" : "text",
      content: String(content).trim(),
      attachment: attachment || "",
    });
    chat.lastMessage = message._id;
    await chat.save();

    const populated = await Message.findById(message._id).populate(
      "sender",
      "name userName photo role"
    );

    // Reaches anyone who has the Announcement group open in Messages.
    try {
      req.app.get("io")?.to(String(chat._id)).emit("newMessage", populated);
    } catch (e) {
      console.error("announcement broadcast failed:", e.message);
    }

    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/messages/message/:messageId/pin — staff only (#2.7).
exports.pinMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { pinned } = req.body || {};
    const role = actorRole(req);
    if (!isStaff(role)) {
      return res
        .status(403)
        .json({ error: "Only staff can pin announcements." });
    }
    const message = await Message.findById(messageId);
    if (!message || message.isDeleted) {
      return res.status(404).json({ error: "Message not found" });
    }
    message.isPinned = !!pinned;
    message.pinnedAt = pinned ? new Date() : null;
    await message.save();
    res.json(message);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
