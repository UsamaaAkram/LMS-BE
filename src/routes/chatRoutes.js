const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// Chat Routes
router.post("/", chatController.createChat);
// /search
router.get("/search", chatController.searchChats);
// /user/:userId/chats
router.get("/:userId/chats", chatController.getUserChats);
// /close
router.post("/:chatId/close", chatController.closeChat);
// /delete
router.delete("/:chatId", chatController.deleteChat);
// /block
router.post("/:chatId/block", chatController.blockChat);
// /unblock
router.post("/:chatId/unblock", chatController.unblockChat);
// Attachment upload
router.post(
  "/:chatId/attachment",
  upload.single("file"),
  chatController.uploadAttachment
);

router.post("/group", chatController.createGroup); // ⬅️  Create group
router.post("/:chatId/addMember", chatController.addUserToGroup); // ⬅️  Add member
router.post("/:chatId/removeMember", chatController.removeUserFromGroup); // ⬅️  Remove member
router.post("/:chatId/read", chatController.markChatAsRead); // ⬅️  Mark chat as read
router.get("/listWithUnread/:userId", chatController.chatsListWithUnread);


module.exports = router;
