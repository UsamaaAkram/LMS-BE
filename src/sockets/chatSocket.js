const mongoose = require("mongoose");
const Chat = require("../models/Chat");
const User = require("../models/User");
const Instructor = require("../models/Instructor");
const Student = require("../models/Student");
const Message = require("../models/Message");

// --- USER SOCKET CONNECTION MAP ---
const userSockets = {}; // { userId: socketId }

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
function getSocketIdByUserId(userId) {
  return userSockets[userId];
}

function chatSocket(io) {
  io.on("connection", (socket) => {
    // --- REGISTER USER SOCKET ---
    socket.on("registerUser", (userId) => {
      userSockets[userId] = socket.id;
      socket.on("disconnect", () => {
        delete userSockets[userId];
      });
    });

    socket.on("joinChat", ({ chatId }) => {
      socket.join(chatId);
    });

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

    socket.on("typing", ({ chatId, userId }) => {
      socket.to(chatId).emit("typing", { userId });
    });

    socket.on("messageSeen", ({ chatId, messageId, userId }) => {
      socket.to(chatId).emit("messageSeen", { messageId, userId });
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

    socket.on(
      "deleteMessage",
      async ({ chatId, messageId, userId, userModel }) => {
        socket
          .to(chatId)
          .emit("deleteMessage", { messageId, userId, userModel });
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

module.exports = { chatSocket, userSockets, getSocketIdByUserId };
