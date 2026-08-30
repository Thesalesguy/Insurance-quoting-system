const express = require('express');
const { postQuote, getMetadata } = require('../controllers/quoteController');

const router = express.Router();

router.get('/metadata', getMetadata);
router.post('/quotes', postQuote);

module.exports = router;
