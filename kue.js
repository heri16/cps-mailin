var kue = require('kue');

var config = require('./config');

// Mailin will store jobs to Microservices (retry with backoff)
var jobs = kue.createQueue({ redis: config.redisOptions });
jobs.on('error', function(err) { console.warn(err); });  // Must be bound or will crash

// Watchdog: Fix stuck inactive jobs (if any)
jobs.watchStuckJobs()

/* Start the Kue Web UI */
kue.app.set('title', 'Mailin Job Queue');
kue.app.listen(8000);
console.log('Kue UI started on port 8000');
