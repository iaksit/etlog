var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.send('autentizace probehla v poradku');
});

module.exports = router;
