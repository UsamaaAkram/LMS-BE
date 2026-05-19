const express = require('express');
const router = express.Router();
const controller = require('../controllers/muteBlockReportController');

router.post('/mute', controller.muteChat);
router.post('/block', controller.blockUser);
router.post('/report', controller.report);

module.exports = router;