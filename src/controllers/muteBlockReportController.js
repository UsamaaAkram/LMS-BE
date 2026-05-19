const User = require('../models/User');
const Report = require('../models/Report');

// Mute Chat for User
exports.muteChat = async (req, res) => {
  const { userId, chatId } = req.body;
  const user = await User.findById(userId);
  if (!user.mutedChats.includes(chatId)) {
    user.mutedChats.push(chatId);
    await user.save();
  }
  res.json(user.mutedChats);
};

// Block User
exports.blockUser = async (req, res) => {
  const { userId, targetId } = req.body;
  const user = await User.findById(userId);
  if (!user.blockedUsers.includes(targetId)) {
    user.blockedUsers.push(targetId);
    await user.save();
  }
  res.json(user.blockedUsers);
};

// Report User/Message
exports.report = async (req, res) => {
  const { reportedBy, targetUser, chat, message, reason } = req.body;
  const report = new Report({ reportedBy, targetUser, chat, message, reason });
  await report.save();
  res.json(report);
};