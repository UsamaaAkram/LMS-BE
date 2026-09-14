const express = require("express");
const jwtAuth = require("../middleware/jwtAuth");
const router = express.Router();

// Every route in this file requires a signed-in user. These endpoints were
// completely open: anyone on the internet could read and write them without
// a token. jwtAuth accepts student, instructor and admin tokens alike, and
// for students also enforces the active-session check behind Logout.
router.use(jwtAuth);

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
