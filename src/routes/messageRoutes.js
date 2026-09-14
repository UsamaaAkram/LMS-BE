const express = require('express');
const jwtAuth = require("../middleware/jwtAuth");
const router = express.Router();

// Every route in this file requires a signed-in user. These endpoints were
// completely open: anyone on the internet could read and write them without
// a token. jwtAuth accepts student, instructor and admin tokens alike, and
// for students also enforces the active-session check behind Logout.
router.use(jwtAuth);

const messageController = require('../controllers/messageController');

// Announcements (#2) — declared before the /message/:messageId routes so the
// literal paths can never be captured as an id.
router.get('/announcements', messageController.getAnnouncements);
router.post('/announcements', messageController.createAnnouncement);
router.patch('/message/:messageId/pin', messageController.pinMessage);

router.post('/chat/:chatId/message', messageController.sendMessage);
router.get('/chat/:chatId/messages', messageController.getMessages);
router.get('/chat/:chatId/messages/search', messageController.searchMessages);
router.patch('/message/:messageId', messageController.editMessage);
router.delete('/message/:messageId', messageController.deleteMessage);

module.exports = router;