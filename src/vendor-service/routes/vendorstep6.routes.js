const express = require('express');
const router = express.Router();
const step6Controller = require('../controllers/vendorstep6.controller');

router.post('/', step6Controller.createStep6);
router.put('/:id', step6Controller.updateStep6);
router.get('/:id', step6Controller.getStep6);

module.exports = router;
