const express = require("express");
const jwtAuth = require("../middleware/jwtAuth");
const requireSelfOrStaff = require("../middleware/requireSelfOrStaff");
const router = express.Router();


// Anyone signed in could list another account's chats.
// router.param fires for every route carrying :userId, so this covers all
// of them in one place — including the multi-segment paths — and any route
// added later inherits it automatically instead of being forgotten.
router.param("userId", requireSelfOrStaff("userId"));

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
