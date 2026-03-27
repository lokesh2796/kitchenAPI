const express = require('express');
const router = express.Router();
const step3Controller = require('../controllers/vendorstep3.controller');

router.post('/', step3Controller.createStep3);
router.put('/:id', step3Controller.updateStep3);
router.get('/:id', step3Controller.getStep3);

module.exports = router;
