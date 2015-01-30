var edge = require('edge');

var hello = edge.func('ps', function() {/*
  throw [System.IO.FileNotFoundException] "$file not found."
*/});

hello('', function(err, res) {
 if (err) { console.log("Yeah!"); }
 console.log(res);
});