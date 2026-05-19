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

    // Fetch most recent first
    const messages = await Message.find({ chat: chatId })
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

// Search for messages by content (populates sender from correct model)
exports.searchMessages = async (req, res) => {
  const { chatId } = req.params;
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "No query provided" });
  const messages = await Message.find({
    chat: chatId,
    content: { $regex: query, $options: "i" },
  }).populate("sender", "name userName photo role");
  res.json(messages);
};
