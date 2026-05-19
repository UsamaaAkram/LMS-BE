const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

router.post('/chat/:chatId/message', messageController.sendMessage);
router.get('/chat/:chatId/messages', messageController.getMessages);
router.get('/chat/:chatId/messages/search', messageController.searchMessages);

module.exports = router;