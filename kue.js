var kue = require('kue');

var config = require('./config');

// Mailin will store jobs to Microservices (retry with backoff)
var jobs = kue.createQueue({ redis: config.redisOptions });
jobs.on('error', function(err) { console.warn(err); });  // Must be bound or will crash

/* Start the Kue Web UI */
kue.app.set('title', 'Mailin Job Queue');
kue.app.listen(3000);
console.log('Kue UI started on port 3000');
