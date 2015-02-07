var kue = require('kue');

var graft = require('graft')();
var spdy = require('graft/spdy');

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var domain = require('domain');

var Mailer = require('./lib/mailer');
var CpsRene = require('./lib/cps-rene');
var CpsAccurate = require('./lib/cps-accurate');


/* Config-variables */

var config = require('./config');


/* System variables */

// Nodemailer Transporter to smtp-relay.gmail.com
var mailout = new Mailer(config.mailoutOptions);

// Mailin will store jobs to Microservices (retry with backoff)
var jobs = kue.createQueue({ redis: config.redisOptions });
jobs.on('error', function(err) {});  // Must be bound or will crash

// RENE Microservice Instance
//var reneSrv = spdy.client({ port: 6001 });
var rene = new CpsRene(config.cpsReneOptions);
var reneSrv = rene.service;
graft.where({ systemId: '3001' }, reneSrv);
graft.where({ systemId: '3002' }, reneSrv);

// Accurate Microservice Instance
//var accurateSrv = spdy.client({ port: 6002 });
var accurate = new CpsAccurate(config.cpsAccurateOptions);
var accurateSrv = accurate.service;
graft.where({ systemId: 'JAKARTA' }, accurateSrv);
graft.where({ systemId: 'BALI' }, accurateSrv);

/* Event emitted when a pending kue job needs to be processed. */
jobs.process('GraftJS', 1, function(job, done) {
  //d.run(function() {
    // Get persisted graftMessage from job data
    var msg = job.data.graftMessage;
  
    // Convert filePaths into filestreams that can be sent via graft jschan
    if (msg.filePaths) {
      var fileStreams = {};
      msg.filePaths.forEach(function(filePath) {
        var fileName = path.basename(filePath);
        var fileStream = fs.createReadStream(filePath);

        fileStreams[fileName] = fileStream;
      });
      msg.fileStreams = fileStreams;
    }

    // Reply from microservice (Warning: might not receive any reply on returnChannel)
    var results = [];
    msg.returnChannel = graft.ReadChannel().on('data', function (msg) {
      console.dir(msg);
      
      if (msg.error) { done(msg.error); }
      else if (msg.result) { results.push(msg.result); }

    }).on('end', function() {
      if (results.length > 0) { done(null, results); }
    });

    // Request to microservices (dispatched by graft.where() pattern-matching)
    graft.write(msg);
  //});
});

/* Event emitted when a pending kue job has completed. */
jobs.on('job complete', function(id, result) {
  kue.Job.get(id, function(err, job) {
    if (err) { return; }

    // Store the result in Kue db
    job.data.result = result;
    job.save();

    // Send the result back to the email sender.
    // Email balik hasil nya ke pengirim email.
    if (job.data.sourceMail) { mailout.replyToEmail(job.data.sourceMail, result); }
  });
});

/* Event emitted when a pending kue job has failed an attempt. */
jobs.on('job failed attempt', function(id, errorMsg, attempts) {
  console.log('Job ' + id + ' failed attempt ' + attempts + ' on queue');
});

/* Event emitted when a pending kue job has failed with no further attempts left. */
jobs.on('job failed', function(id, errorMsg) {
  console.log('Job ' + id + ' failed all attempts on queue');
  kue.Job.get(id, function(err, job) {
    if (err) { return; }

    // Send the result back to the email sender.
    // Email balik hasil nya ke pengirim email.
    if (job.data.sourceMail) { mailout.replyToEmail(job.data.sourceMail, errorMsg); }
  });
});

console.log("Ready to process graft jobs.");