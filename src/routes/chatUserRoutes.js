const express = require('express');
const router = express.Router();
const controller = require('../controllers/chatUserController');
router.get('/users', controller.getAllChatUsers);
module.exports = router;