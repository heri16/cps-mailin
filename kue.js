var kue = require('kue');

// Mailin will store jobs to Microservices (retry with backoff)
var jobs = kue.createQueue();
jobs.on('error', function(err) {});  // Must be bound or will crash

/* Start the Kue jobs processing */
jobs.promote();

/* Start the Kue Web UI */
kue.app.set('title', 'Mailin Job Queue');
kue.app.listen(3000);
console.log('Kue UI started on port 3000');