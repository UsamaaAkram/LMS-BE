const express = require('express');
const jwtAuth = require("../middleware/jwtAuth");
const router = express.Router();

// Every route in this file requires a signed-in user. These endpoints were
// completely open: anyone on the internet could read and write them without
// a token. jwtAuth accepts student, instructor and admin tokens alike, and
// for students also enforces the active-session check behind Logout.
router.use(jwtAuth);

const controller = require('../controllers/chatUserController');
router.get('/users', controller.getAllChatUsers);
module.exports = router;