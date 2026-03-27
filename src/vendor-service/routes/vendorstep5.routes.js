const express = require('express');
const router = express.Router();
const step5Controller = require('../controllers/vendorstep5.controller');

router.post('/', step5Controller.createStep5);
router.put('/:id', step5Controller.updateStep5);
router.get('/:id', step5Controller.getStep5);

module.exports = router;
