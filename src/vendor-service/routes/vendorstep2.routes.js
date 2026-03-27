const express = require('express');
const router = express.Router();
const step2Controller = require('../controllers/vendorstep2.controller');

router.post('/', step2Controller.createStep2);
router.put('/:id', step2Controller.updateStep2);
router.get('/:id', step2Controller.getStep2);

module.exports = router;
