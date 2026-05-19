const mongoose = require("mongoose");
const Chat = require("../models/Chat");
const User = require("../models/User");
const Instructor = require("../models/Instructor");
const Student = require("../models/Student");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const Message = require("../models/Message"); // Adjust path as needed
const BUCKET = "bluverse-lms";

const s3Client = new S3Client({
  region: "ap-southeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// S3 helper
async function uploadFileToS3(file) {
  const key = `chat-attachments/${Date.now()}-${file.originalname}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${key}`;
}

/**
 * Helper: Get a user profile from any model
 */
async function getUserProfile(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  let user = await User.findById(id, "_id name userName role photo");
  if (user) return user;
  let instructor = await Instructor.findById(
    id,
    "_id name userName role photo"
  );
  if (instructor) return instructor;
  // let student = await Student.findById(id, "_id name student.userName role student.photo");
  let student = await Student.findById(id);
  if (student)
    return {
      _id: student._id,
      name: student.student?.firstName + " " + student.student?.lastName,
      userName: student.student?.userName,
      role: "student",
      photo: student.student?.photo,
    };
  return null;
}

/**
 * Helper: Populate participants for chats (and admins for group chats)
 */
async function populateChatsParticipants(chats) {
  return Promise.all(
    chats.map(async (chat) => ({
      ...chat.toObject(),
      participants: await Promise.all(
        chat.participants.map((id) => getUserProfile(id))
      ),
      admin: chat.admin
        ? await Promise.all(chat.admin.map((id) => getUserProfile(id)))
        : [],
    }))
  );
}

// Helper: Get any user by id from all models
async function getAnyUser(id) {
  let user = await User.findById(id);
  if (user) return { ...user.toObject(), source: "User" };
  let instructor = await Instructor.findById(id);
  if (instructor) return { ...instructor.toObject(), source: "Instructor" };
  let student = await Student.findById(id);
  if (student) return { ...student.toObject(), source: "Student" };
  return null;
}

// Robustly populate participants from all models
async function robustPopulateParticipants(participants) {
  return Promise.all(
    participants.map(async (id) => {
      let user = await User.findById(id, "_id name userName role photo").lean();
      if (user) return user;
      let instructor = await Instructor.findById(
        id,
        "_id name userName role photo"
      ).lean();
      if (instructor) return instructor;
      let student = await Student.findById(id).lean();
      if (student)
        return {
          _id: student._id,
          name: student.student?.firstName + " " + student.student?.lastName,
          userName: student.student?.userName,
          role: "student",
          photo: student.student?.photo,
        };
      return null;
    })
  );
}

/**
 * Create Chat (private/group/announcement)
 */
exports.createChat = async (req, res) => {
  try {
    const {
      isGroup,
      participants,
      groupName,
      admin,
      isAnnouncement,
      blockedUsers,
    } = req.body;

    if (!participants || participants.length < 2) {
      return res
        .status(400)
        .json({ error: "At least two participants required." });
    }

    let participantsModel = "User";
    if (participants.length > 0) {
      const profile = await getUserProfile(participants[0]);
      if (profile) {
        if (profile.role === "student") participantsModel = "Student";
        else if (profile.role === "instructor")
          participantsModel = "Instructor";
        else participantsModel = "User";
      }
    }

    // 👉 Always look for any chat between these two (order-insensitive, even if soft deleted)
    let existing = await Chat.findOne({
      isGroup: false,
      participants: { $all: participants, $size: 2 },
      participantsModel,
    });

    if (existing) {
      const userId = participants[0]; // The user who is creating the chat/request
      // 🟢 Restore chat if user had deleted it
      if (
        existing.deletedFor &&
        existing.deletedFor
          .map((id) => id.toString())
          .includes(userId.toString())
      ) {
        await Chat.updateOne(
          { _id: existing._id },
          { $pull: { deletedFor: userId } }
        );
      }
      // 🎯 Now return up-to-date chat data (with participants populated)
      const updated = await Chat.findById(existing._id);
      const popChats = await populateChatsParticipants([updated]);
      return res.status(200).json(popChats[0]);
    }

    let adminModel = participantsModel;
    if (isGroup && admin && admin.length > 0) {
      const adminProfile = await getUserProfile(admin[0]);
      if (adminProfile) {
        if (adminProfile.role === "student") adminModel = "Student";
        else if (adminProfile.role === "instructor") adminModel = "Instructor";
        else adminModel = "User";
      }
    }
    let blockedUsersModel = participantsModel;
    if (blockedUsers && blockedUsers.length > 0) {
      const blockedProfile = await getUserProfile(blockedUsers[0]);
      if (blockedProfile) {
        if (blockedProfile.role === "student") blockedUsersModel = "Student";
        else if (blockedProfile.role === "instructor")
          blockedUsersModel = "Instructor";
        else blockedUsersModel = "User";
      }
    }
    const chat = new Chat({
      isGroup: !!isGroup,
      groupName: isGroup ? groupName : "",
      participants,
      participantsModel,
      admin: isGroup ? admin : [],
      adminModel:
        isGroup && admin && admin.length > 0 ? adminModel : participantsModel,
      blockedUsers: blockedUsers || [],
      blockedUsersModel,
      isAnnouncement: !!isAnnouncement,
    });
    await chat.save();

    const [popChat] = await populateChatsParticipants([chat]);
    const io = req.app.get("io");
    const getSocketIdByUserId = req.app.get("getSocketIdByUserId");

    popChat.participants.forEach((participant) => {
      const idStr =
        typeof participant === "string"
          ? participant
          : participant._id?.toString();
      const socketId = getSocketIdByUserId(idStr);
      if (socketId) {
        io.to(socketId).emit("newChatCreated", popChat);
      }
    });

    res.status(201).json(popChat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Search chats (by group name/participant info)
 */
exports.searchChats = async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "No query provided" });

  const groupChats = await Chat.find({
    isGroup: true,
    groupName: { $regex: query, $options: "i" },
  });

  // search users in all models
  const userPromises = [
    User.find({
      $or: [
        { name: { $regex: query, $options: "i" } },
        { userName: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ],
    }),
    Instructor.find({
      $or: [
        { name: { $regex: query, $options: "i" } },
        { userName: { $regex: query, $options: "i" } },
      ],
    }),
    Student.find({
      $or: [
        { name: { $regex: query, $options: "i" } },
        { userName: { $regex: query, $options: "i" } },
      ],
    }),
  ];
  const results = await Promise.all(userPromises);
  const allFoundUsers = [...results[0], ...results[1], ...results[2]];
  const userIds = allFoundUsers.map((u) => u._id);

  const privateChats = await Chat.find({
    isGroup: false,
    participants: { $in: userIds },
  });

  res.json({
    groupChats: await populateChatsParticipants(groupChats),
    privateChats: await populateChatsParticipants(privateChats),
  });
};

/**
 * Get all chats for a user, populated with participant info
 */
exports.getUserChats = async (req, res) => {
  try {
    const { userId } = req.params;
    // direct find, will return all chats where userId is a participant
    const chats = await Chat.find({
      participants: userId,
      deletedFor: { $ne: userId },
    });
    const popChats = await populateChatsParticipants(chats);
    res.json(popChats);
  } catch (err) {
    res.status(500).json({ error: "Unable to retrieve chats for this user." });
  }
};

// controllers/chatController.js
exports.closeChat = async (req, res) => {
  // Mark chat as closed for user (add to archived list or flag, not full delete)
  // Return updated chat or success
};

// /api/chat/:chatId/block
exports.blockChat = async (req, res) => {
  const { chatId } = req.params;
  const { userId, userModel } = req.body;

  if (!chatId || !userId)
    return res.status(400).json({ error: "Missing chatId or userId" });

  try {
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const otherParticipant = chat.participants.find(
      (id) => id.toString() !== userId.toString()
    );
    if (!otherParticipant)
      return res.status(400).json({ error: "Other participant not found" });

    // Add block record if not already exists
    await Chat.updateOne(
      { _id: chatId },
      {
        $addToSet: {
          blocked: {
            blocker: userId,
            blocked: otherParticipant,
            at: new Date(),
          },
        },
      }
    );
    // Send updated chat if needed
    res.json({ success: true, chatId, userId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.unblockChat = async (req, res) => {
  const { chatId } = req.params;
  const { blocker, blocked } = req.body;

  const isValidObjectId = (id) =>
    typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);

  if (
    !chatId ||
    !blocker ||
    !blocked ||
    !isValidObjectId(blocker) ||
    !isValidObjectId(blocked)
  ) {
    return res
      .status(400)
      .json({ error: "Missing or invalid chatId, blocker, or blocked" });
  }

  try {
    const blockerId = new mongoose.Types.ObjectId(blocker);
    const blockedId = new mongoose.Types.ObjectId(blocked);

    await Chat.updateOne(
      { _id: chatId },
      {
        $pull: {
          blocked: {
            blocker: blockerId,
            blocked: blockedId,
          },
        },
      }
    );
    const chat = await Chat.findById(chatId);
    res.json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteChat = async (req, res) => {
  const { chatId } = req.params;
  const { userId, userModel } = req.body;

  if (!chatId || !userId) {
    return res.status(400).json({ error: "Invalid chatId/userId." });
  }

  try {
    // Mark chat as deleted for THIS user only (soft delete).
    // Optionally: update deletedForModel if needed for audit or filtering.
    await Chat.updateOne(
      { _id: chatId },
      {
        $addToSet: { deletedFor: new mongoose.Types.ObjectId(userId) },
        ...(userModel && { $set: { deletedForModel: userModel } }),
      }
    );

    // Re-fetch chat to re-check state after update
    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    // If EVERY participant has deleted, delete chat and messages for all.
    const allDeleted = chat.participants.every((id) =>
      chat.deletedFor.map((d) => d.toString()).includes(id.toString())
    );

    if (allDeleted && chat.participants.length) {
      await chat.deleteOne();
      await Message.deleteMany({ chat: chatId });
    }

    return res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// MAIN FUNCTION for /:chatId/attachment
exports.uploadAttachment = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { senderId, senderModel, content } = req.body;

    if (!chatId || !senderId) {
      return res.status(400).json({ error: "Missing chatId or senderId" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Upload to S3 (your helper function)
    const url = await uploadFileToS3(req.file);

    // Fetch participants & participantsModel, as stored on the chat
    const chatDoc = await Chat.findById(chatId).lean();
    let participants = [];
    let participantsModel = "User";
    if (chatDoc) {
      participants = chatDoc.participants;
      participantsModel = chatDoc.participantsModel || "User";
    }

    // Create the new message
    const message = new Message({
      chat: chatId,
      sender: senderId,
      senderModel: senderModel || "User",
      type: "attachment",
      content: content || "",
      attachment: url,
      participants,
      participantsModel,
    });
    await message.save();
    await Chat.findByIdAndUpdate(chatId, { lastMessage: message._id });

    // Real-time: Broadcast to all chat participants (same as your regular new message!)
    const io = req.app.get("io"); // MAKE SURE io is attached to app!
    if (io && chatId) {
      io.to(chatId).emit("newMessage", message);
    }

    // Respond to the uploader (HTTP)
    res.status(201).json({ success: true, attachmentUrl: url, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ====== Create Group: only User.admin or Instructor allowed ======
exports.createGroup = async (req, res) => {
  try {
    const { adminId, groupName, participantIds, isAnnouncement } = req.body;

    const adminUser = await getAnyUser(adminId);
    const allowed =
      adminUser &&
      ((adminUser.source === "User" && adminUser.role === "admin") ||
        adminUser.source === "Instructor");

    if (!allowed) {
      return res.status(403).json({ error: "Permission denied" });
    }
    if (!groupName || !participantIds || participantIds.length < 2) {
      return res
        .status(400)
        .json({ error: "Group name and participants required" });
    }

    // Use "Mixed" or dynamically determine from participants, if you want full flexibility
    const chat = new Chat({
      isGroup: true,
      groupName,
      participants: participantIds,
      admin: [adminId],
      participantsModel: "User",
      adminModel: adminUser.source, // "User" or "Instructor"
      isAnnouncement: isAnnouncement || false,
    });

    await chat.save();
    const [popChat] = await populateChatsParticipants([chat]);

    const io = req.app.get("io");
    const getSocketIdByUserId = req.app.get("getSocketIdByUserId");
    popChat.participants.forEach((participant) => {
      const idStr =
        typeof participant === "string"
          ? participant
          : participant._id?.toString();
      const socketId = getSocketIdByUserId(idStr);
      if (socketId) {
        io.to(socketId).emit("newChatCreated", popChat);
      }
    });

    return res.status(201).json(popChat);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ====== Add Member ======
exports.addUserToGroup = async (req, res) => {
  const { chatId } = req.params;
  const { userIdToAdd, requestorId } = req.body;

  const chat = await Chat.findById(chatId);
  const requestor = await getAnyUser(requestorId);

  const allowed =
    chat.isGroup &&
    requestor &&
    ((requestor.source === "User" && requestor.role === "admin") ||
      requestor.source === "Instructor");

  if (!allowed) {
    return res.status(403).json({ error: "Permission denied" });
  }

  if (!chat.participants.includes(userIdToAdd)) {
    chat.participants.push(userIdToAdd);
    await chat.save();
  }

  const [popChat] = await populateChatsParticipants([chat]);
  const io = req.app.get("io");
  const getSocketIdByUserId = req.app.get("getSocketIdByUserId");
  popChat.participants.forEach((participant) => {
    const idStr =
      typeof participant === "string"
        ? participant
        : participant._id?.toString();
    const socketId = getSocketIdByUserId(idStr);
    if (socketId) {
      io.to(socketId).emit("newChatCreated", popChat);
    }
  });

  return res.json(popChat);
};

// ====== Remove Member ======
exports.removeUserFromGroup = async (req, res) => {
  const { chatId } = req.params;
  const { userIdToRemove, requestorId } = req.body;

  const chat = await Chat.findById(chatId);
  const requestor = await getAnyUser(requestorId);

  const allowed =
    chat.isGroup &&
    requestor &&
    ((requestor.source === "User" && requestor.role === "admin") ||
      requestor.source === "Instructor");

  if (!allowed) {
    return res.status(403).json({ error: "Permission denied" });
  }

  chat.participants = chat.participants.filter((id) => id != userIdToRemove);
  await chat.save();

  const [popChat] = await populateChatsParticipants([chat]);
  const io = req.app.get("io");
  const getSocketIdByUserId = req.app.get("getSocketIdByUserId");

  // Notify all remaining participants of updated group
  popChat.participants.forEach((participant) => {
    const idStr =
      typeof participant === "string"
        ? participant
        : participant._id?.toString();
    const socketId = getSocketIdByUserId(idStr);
    if (socketId) io.to(socketId).emit("newChatCreated", popChat);
  });

  // Notify the removed user directly
  const removedSocketId = getSocketIdByUserId(userIdToRemove);
  if (removedSocketId) {
    io.to(removedSocketId).emit("removedFromGroup", {
      chatId,
      groupName: chat.groupName,
    });
  }

  return res.json(popChat);
};

// ====== Mark Chat as Read ======
exports.markChatAsRead = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId, lastReadMessageId } = req.body; // send last message id seen

    const chat = await Chat.findById(chatId);
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    // Always use toString for proper key matching
    if (!chat.lastReadMessageMap) chat.lastReadMessageMap = new Map();
    chat.lastReadMessageMap.set(userId.toString(), lastReadMessageId);

    await chat.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ====== Get Chats With Unread Counts ======
exports.getChatsWithUnreadCounts = async (userId) => {
  const chats = await Chat.find({ participants: userId })
    .populate("lastMessage")
    .lean();

  return Promise.all(
    chats.map(async (chat) => {
      chat.participants = await robustPopulateParticipants(chat.participants);
      // -- rest of your unread count calculation --
      const lastReadMsgId =
        chat.lastReadMessageMap &&
        (chat.lastReadMessageMap[userId] ||
          chat.lastReadMessageMap[userId.toString()]);
      let unreadCount = 0;
      if (lastReadMsgId) {
        unreadCount = await Message.countDocuments({
          chat: chat._id,
          _id: { $gt: lastReadMsgId },
        });
      } else {
        unreadCount = await Message.countDocuments({ chat: chat._id });
      }
      return { ...chat, unreadCount };
    })
  );
};

// ====== List Chats With Unread (API endpoint) ======
exports.chatsListWithUnread = async (req, res) => {
  const { userId } = req.params;
  try {
    const chats = await exports.getChatsWithUnreadCounts(userId);
    res.json(chats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
