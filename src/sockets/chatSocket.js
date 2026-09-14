const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Chat = require("../models/Chat");
const User = require("../models/User");
const Instructor = require("../models/Instructor");
const Student = require("../models/Student");
const Message = require("../models/Message");

// --- USER SOCKET CONNECTION MAP ---
//
// A Set per user, not a single socket id: the platform allows two simultaneous
// devices (#7), so a phone connecting used to overwrite the laptop's socket and
// anything targeted at that user reached only one of them.
const userSockets = {}; // { userId: Set<socketId> }

/** Room every one of a user's devices joins, so emits reach all of them. */
const userRoom = (userId) => `user:${userId}`;
/** Single room for the Community feed (#2.21). */
const COMMUNITY_ROOM = "community";

// Helper to get user by model name
async function getUserByModel(userId, model) {
  switch (model) {
    case "User":
      return await User.findById(userId);
    case "Instructor":
      return await Instructor.findById(userId);
    case "Student":
      return await Student.findById(userId);
    default:
      return null;
  }
}

// --- Get socket id for a userId ---
// Kept returning a single id so existing callers in chatController keep
// working; prefer emitToUser() below, which reaches every device.
function getSocketIdByUserId(userId) {
  const set = userSockets[userId];
  if (!set || set.size === 0) return undefined;
  return set.values().next().value;
}

/** True when the user has at least one live socket (#2.15 presence). */
function isUserOnline(userId) {
  return !!userSockets[userId] && userSockets[userId].size > 0;
}

/** Emit to every device a user has connected. */
function emitToUser(io, userId, event, payload) {
  if (!userId) return;
  io.to(userRoom(userId)).emit(event, payload);
}

function chatSocket(io) {
  // --- HANDSHAKE AUTHENTICATION ---
  //
  // The socket carried private messages, presence and notifications while
  // trusting whatever userId the client sent to registerUser: connecting and
  // emitting someone else's id joined their room and delivered their private
  // traffic. The identity now comes from a verified JWT on the handshake, and
  // an unauthenticated connection is refused outright.
  //
  // Every place the app opens this socket is already behind a login, so
  // rejecting anonymous connections costs nothing.
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace("Bearer ", "");
    if (!token) return next(new Error("unauthorized"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded?.id) return next(new Error("unauthorized"));
      socket.data.authUserId = String(decoded.id);
      socket.data.authRole = decoded.role;
      next();
    } catch (err) {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    // --- REGISTER USER SOCKET ---
    //
    // The disconnect handler used to be registered INSIDE this handler, so a
    // client that re-emitted registerUser (on reconnect, or a remount) stacked
    // a new disconnect listener every time. It is now attached once per socket,
    // below, and cleans up whichever user this socket belongs to.
    socket.on("registerUser", () => {
      // The argument the client sends is deliberately ignored. Identity comes
      // from the verified handshake token, so a client cannot register as
      // anyone but itself. The event is kept because clients still emit it,
      // and it is what triggers joining the room and announcing presence.
      const userId = socket.data.authUserId;
      if (!userId) return;
      socket.data.userId = String(userId);
      if (!userSockets[socket.data.userId]) {
        userSockets[socket.data.userId] = new Set();
      }
      const set = userSockets[socket.data.userId];
      const wasOffline = set.size === 0;
      set.add(socket.id);
      socket.join(userRoom(socket.data.userId));
      // #2.15 — only announce on the transition, not on every extra device.
      if (wasOffline) {
        socket.broadcast.emit("presence", {
          userId: socket.data.userId,
          online: true,
        });
      }
      // Let the newcomer sync the current roster in one go.
      socket.emit("presenceSnapshot", {
        online: Object.keys(userSockets).filter((id) => userSockets[id].size),
      });
    });

    socket.on("disconnect", () => {
      const userId = socket.data.userId;
      if (!userId) return;
      const set = userSockets[userId];
      if (!set) return;
      set.delete(socket.id);
      // Only "offline" once the LAST device drops — otherwise closing one tab
      // would mark a user offline while their phone is still connected.
      if (set.size === 0) {
        delete userSockets[userId];
        socket.broadcast.emit("presence", { userId, online: false, lastSeen: new Date() });
      }
    });

    socket.on("joinChat", ({ chatId }) => {
      socket.join(chatId);
    });

    // #2.21 — Community feed room. Clients join while the tab is open so new
    // posts, replies and reactions arrive without a refresh.
    socket.on("joinCommunity", () => socket.join(COMMUNITY_ROOM));
    socket.on("leaveCommunity", () => socket.leave(COMMUNITY_ROOM));

    socket.on("sendMessage", async (data) => {
      try {
        const {
          chatId,
          sender,
          senderModel,
          type,
          content,
          attachment,
          replyTo,
        } = data;

        const chat = await Chat.findById(chatId);
        if (!chat) {
          socket.emit("error", { message: "Chat not found" });
          return;
        }

        if (!chat.participantsModel) {
          socket.emit("error", {
            message: "Chat missing participantsModel (schema misconfiguration)",
          });
          return;
        }

        if (!senderModel) {
          socket.emit("error", { message: "Missing senderModel in message" });
          return;
        }

        const senderDoc = await getUserByModel(sender, senderModel);
        if (!senderDoc) {
          socket.emit("error", { message: "Invalid sender" });
          return;
        }

        if (chat.isAnnouncement && senderDoc.role !== "admin") {
          socket.emit("error", {
            message: "Only admin can post in announcement group",
          });
          return;
        }

        if (Array.isArray(chat.blocked) && chat.blocked.length > 0) {
          socket.emit("error", {
            message: "This chat is blocked. Unblock to continue messaging.",
          });
          return;
        }

        // Save new message
        const message = new Message({
          chat: chatId,
          sender,
          senderModel,
          type: type || "text",
          content: content || "",
          attachment: attachment || "",
          replyTo,
          participants: chat.participants,
          participantsModel: chat.participantsModel,
        });
        await message.save();

        chat.lastMessage = message._id;
        await chat.save();

        // ---- EMIT chatUnreadUpdate to ALL RECIPIENTS except sender ----
        const recipients = chat.participants.filter(
          (pid) => pid.toString() !== sender.toString()
        );

        for (const recipientId of recipients) {
          const socketId = getSocketIdByUserId(recipientId.toString());
          if (socketId) {
            // Only notify which chat changed
            io.to(socketId).emit("chatUnreadUpdate", { chatId: chat._id });
          }
        }

        // ---- EMIT newMessage ONLY to chat room members ----
        io.to(chatId).emit("newMessage", message);

        // (Optional) Restore chat for users in deletedFor (your previous logic)
      } catch (err) {
        socket.emit("error", {
          message: "Internal server error on sendMessage",
        });
      }
    });

    // #2.14 — typing indicator. stopTyping is explicit so the bubble clears
    // when the sender clears the box or sends, rather than only on a timeout.
    socket.on("typing", ({ chatId, userId, userName }) => {
      socket.to(chatId).emit("typing", { userId, userName });
    });
    socket.on("stopTyping", ({ chatId, userId }) => {
      socket.to(chatId).emit("stopTyping", { userId });
    });

    // #2.13 read receipts.
    //
    // This handler used to only re-broadcast: nothing ever wrote to
    // Message.seenBy, so a receipt disappeared the moment either side
    // refreshed (the same defect the delete handler had). $addToSet persists it
    // and is idempotent, so the client can re-announce freely.
    //
    // io.to (not socket.to) so the SENDER also learns their message was read —
    // they are the one who needs to see the double tick.
    socket.on("messageSeen", async ({ chatId, messageId, userId }) => {
      try {
        if (!messageId || !userId) return;
        if (!mongoose.Types.ObjectId.isValid(messageId)) return;
        await Message.updateOne(
          { _id: messageId },
          { $addToSet: { seenBy: userId } }
        );
        io.to(chatId).emit("messageSeen", { messageId, userId });
      } catch (err) {
        console.error("messageSeen failed:", err.message);
      }
    });

    // Marking a whole conversation read in one round trip, rather than one
    // emit per visible message when a chat is opened.
    socket.on("messagesSeenBulk", async ({ chatId, messageIds, userId }) => {
      try {
        if (!userId || !Array.isArray(messageIds) || !messageIds.length) return;
        const ids = messageIds.filter((id) =>
          mongoose.Types.ObjectId.isValid(id)
        );
        if (!ids.length) return;
        await Message.updateMany(
          { _id: { $in: ids } },
          { $addToSet: { seenBy: userId } }
        );
        io.to(chatId).emit("messagesSeenBulk", { messageIds: ids, userId });
      } catch (err) {
        console.error("messagesSeenBulk failed:", err.message);
      }
    });

    socket.on(
      "reactMessage",
      async ({ chatId, messageId, userId, userModel, emoji }) => {
        try {
          const message = await Message.findById(messageId);
          if (!message) return;

          message.reactions = message.reactions.filter(
            (r) =>
              !(r.user.equals(userId) && r.reactionsUserModel === userModel)
          );
          if (emoji) {
            message.reactions.push({
              user: userId,
              reactionsUserModel: userModel,
              emoji,
            });
          }
          await message.save();

          io.to(chatId).emit("reactMessage", {
            messageId,
            userId,
            userModel,
            emoji,
            reactions: message.reactions,
          });
        } catch (err) {
          socket.emit("error", { message: "Failed to react to message." });
        }
      }
    );

    // #2's "deleted messages reappear on refresh" bug — this handler only
    // ever broadcast the delete, it never persisted anything, so a fresh
    // getMessages() fetch (page refresh) always brought the message back.
    // Sender can delete their own message; an Instructor can delete any
    // message (moderating announcement/group chats).
    socket.on(
      "deleteMessage",
      async ({ chatId, messageId, userId, userModel }) => {
        try {
          const message = await Message.findById(messageId);
          if (!message) return;
          const isOwner = userId && message.sender.equals(userId);
          const isModerator = userModel === "Instructor" || userModel === "User";
          if (!isOwner && !isModerator) {
            return socket.emit("error", {
              message: "You can only delete your own messages.",
            });
          }
          message.isDeleted = true;
          message.deletedAt = new Date();
          await message.save();

          io.to(chatId).emit("deleteMessage", { messageId, userId, userModel });
        } catch (err) {
          socket.emit("error", { message: "Failed to delete message." });
        }
      }
    );

    // Edit a message's content (#2 — no edit mechanism existed at all).
    // Sender-only, mirroring the REST PATCH /api/messages/message/:id.
    socket.on(
      "editMessage",
      async ({ chatId, messageId, userId, content }) => {
        try {
          if (!content || !content.trim()) return;
          const message = await Message.findById(messageId);
          if (!message) return;
          if (!userId || !message.sender.equals(userId)) {
            return socket.emit("error", {
              message: "You can only edit your own messages.",
            });
          }
          message.content = content;
          message.editedAt = new Date();
          await message.save();

          io.to(chatId).emit("editMessage", {
            messageId,
            content,
            editedAt: message.editedAt,
          });
        } catch (err) {
          socket.emit("error", { message: "Failed to edit message." });
        }
      }
    );

    socket.on("closeChat", ({ chatId, userId }) => {
      socket.to(chatId).emit("chatClosed", { chatId, userId });
    });

    socket.on("blockChat", ({ chatId, userId }) => {
      socket.to(chatId).emit("chatBlocked", { chatId, userId });
    });

    socket.on("deleteChat", async ({ chatId, userId }) => {
      try {
        if (!chatId || !userId) return;
        // Soft-delete this chat for this user only
        await Chat.updateOne(
          { _id: chatId },
          { $addToSet: { deletedFor: new mongoose.Types.ObjectId(userId) } }
        );
        const chat = await Chat.findById(chatId);

        // If all have deleted, perform hard delete
        const allDeleted = chat.participants.every((id) =>
          chat.deletedFor.map((d) => d.toString()).includes(id.toString())
        );
        if (allDeleted) {
          await chat.deleteOne();
          await Message.deleteMany({ chat: chatId });
        }

        // Notify only this user (optionally you could broadcast but shouldn't!)
        socket.emit("chatDeleted", { chatId, userId });
      } catch (err) {
        socket.emit("error", { message: "Server error deleting chat" });
      }
    });

    socket.on("newChatCreated", async (data) => {
      const { chatId, participants } = data;
      const newChat = await Chat.findById(chatId);
      if (newChat) {
        for (const pId of participants) {
          const socketId = getSocketIdByUserId(pId);
          if (socketId) {
            io.to(socketId).emit("newChatCreated", newChat);
          }
        }
      }
    });

    socket.on("unblockChat", async ({ chatId, userId }) => {
      // You might fetch latest chat if needed, optionally filter participants
      socket.to(chatId).emit("chatUnblocked", { chatId, userId });
    });
  });
}

module.exports = {
  chatSocket,
  userSockets,
  getSocketIdByUserId,
  isUserOnline,
  emitToUser,
  userRoom,
  COMMUNITY_ROOM,
};
