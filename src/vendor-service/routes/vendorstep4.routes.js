const express = require('express');
const router = express.Router();
const step4Controller = require('../controllers/vendorstep4.controller');

router.post('/', step4Controller.createStep4);
router.put('/:id', step4Controller.updateStep4);
router.get('/:id', step4Controller.getStep4);

module.exports = router;
