// Run once at startup or via admin tool
const Chat = require("./models/Chat");
const User = require("./models/User");

async function createAnnouncementGroup() {
  const allUsers = await User.find({});
  const adminUsers = await User.find({ role: "admin" });

  let group = await Chat.findOne({ isAnnouncement: true });
  if (!group) {
    group = new Chat({
      isGroup: true,
      isAnnouncement: true,
      groupName: "Announcements",
      participants: allUsers.map(u => u._id),
      admin: adminUsers.map(u => u._id)
    });
    await group.save();
  }
  return group;
}

module.exports = createAnnouncementGroup;