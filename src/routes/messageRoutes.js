const express = require('express');
const router = express.Router();
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