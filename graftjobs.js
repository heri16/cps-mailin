var kue = require('kue');
var cluster = require('cluster');

var through2 = require('through2');
var graft = require('graft')();
var spdy = require('graft/spdy');  // Buggy ByteStream on Windows
var ws = require('graft/ws');  // ByteStream Ok on Windows

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var domain = require('domain');

var Mailer = require('./lib/mailer');

/* Config-variables */

var config = require('./config');
var clusterWorkerSize = 1;

/* System variables */

// Nodemailer Transporter to smtp-relay.gmail.com
var mailout = new Mailer(config.mailoutOptions);

// Mailin will store jobs to Microservices (retry with backoff)
var jobs = kue.createQueue({ redis: config.redisOptions });
jobs.on('error', function(err) { console.log( 'Oops... ', err ); });  // Must be bound or will crash
process.once( 'uncaughtException', function(err){
  console.error( 'Something bad happened, uncaughtException:', err );
  jobs.shutdown( 1000, function(err2){
    console.error( 'Kue shutdown result: ', err2||'OK' );
    process.exit( 0 );
  });
});

// Build job processing function with seperate graft streams (so they don't block on each other)
var buildProcessGraftJob = function(graft) {
  /* Function called when a pending kue job needs to be processed. */
  return (function processGraftJob(job, ctx, done) {
    console.log("Job %d processing...", job.id);

    var d = domain.create();
    d.on('error', function(err) {
      done(err);
    });

    d.run(function() {
      // Get persisted graftMessage from job data
      var msg = job.data.graftMessage;
      if (msg) { job.progress(1, 8); }
  
      // Convert filePaths into filestreams that can be sent via graft jschan
      if (msg.filePaths) {
        var fileStreams = {};
        msg.filePaths.forEach(function(filePath) {
          var fileName = path.basename(filePath);
          var fileStream = fs.createReadStream(filePath);

          fileStream.on('open', function() { console.log('open event in origin file'); });
          fileStream.on('error', function() { console.log('error event in origin file'); });
          fileStream.on('end', function() { console.log('end event in origin file'); });
          fileStream.on('close', function() { console.log('close event in origin file'); });
          //fileStream.push(null);

          fileStreams[fileName] = fileStream;
          job.progress(2, 8, 'files-some-ready');
          job.log("File ready: %s", fileName);
        });
        msg.fileStreams = fileStreams;
        job.progress(3, 8, 'files-all-ready');
      }

      // Reply from microservice (Warning: might not receive any reply on returnChannel)
      var results = [];
      var isError = false;
      msg.returnChannel = graft.ReadChannel();
      msg.returnChannel.pipe(through2.obj(function(msg, enc, cb) {
        console.dir(msg);
        job.progress(6, 8, 'channel-returning-data');
      
        if (msg.error) {
          isError = true;
          done(msg.error);
        } else if ('log' in msg) {
          if ( Array.isArray(msg.log) ) {
            job.log.apply(job, msg.log); 
          } else if ('length' in msg.log ) {
            job.log.apply(job, Array.prototype.slice.call(msg.log));
          }
        } else if ('result' in msg) {
          results.push(msg.result);
          job.log("Result: %s", JSON.stringify(msg.result) );
        }

        cb();
      }));
      msg.returnChannel.on('unpipe', function() {
        job.progress(7, 8, 'channel-ended');
        job.log("Microservice response ended with %d results.", results.length);

        if (!isError) {
          if (results.length === 0) {
            done(new Error("Graft returnChannel ended with no results. Likely timeout issue."));
          } else {
            done(null, results);
          }
        }
      });

      // Send Request to microservices
      job.progress(4, 8, 'request-sending');
      job.log("Sending request to Microservice");
      graft.write(msg);  // Note: Request message dispatched by graft.where() pattern-matching
      job.progress(5, 8, 'request-sent');
      job.log("Sent request to Microservice");
    });
  });
};

if (cluster.isMaster) {
  /* Master Logic */
  
  /* Event emitted when a pending kue job has completed. */
  jobs.on('job complete', function(id, result) {
    console.log("Job %d completed.", id);
    kue.Job.get(id, function(err, job) {
      if (err) { console.error(err); return; }

      // Store the result in Kue db
      //job.data.success = true;
      //job.set('data', JSON.stringify(job.data));

      // Send the result back to the email sender.
      // Email balik hasil nya ke pengirim email.
      if (job.data.sourceMail) { mailout.replyToEmail(job.data.sourceMail, "Job " + job.id + " Completed: \n" + result); }
    });
  });

  /* Event emitted when a pending kue job has failed an attempt. */
  //jobs.on('job failed attempt', function(id, errorMsg, attempts) {});
  //  console.log("Job %d failed attempt %d on queue...", id, attempts);
  //  if (job.data.sourceMail) { mailout.replyToEmail(job.data.sourceMail, "Job " + job.id + " Retry due to: \n" + errorMsg); }
  //});

  /* Event emitted when a pending kue job has failed with no further attempts left. */
  jobs.on('job failed', function(id, errorMsg) {
    console.log("Job %d failed all attempts on queue.", id);
    kue.Job.get(id, function(err, job) {
      if (err) { console.error(err); return; }

      // Send the result back to the email sender.
      // Email balik hasil nya ke pengirim email.
      if (job.data.sourceMail) { mailout.replyToEmail(job.data.sourceMail, "Job " + job.id + " Failed: \n" + errorMsg); }
    });
  });

  // Fork workers in cluster that will process jobs
  for (var i = 0; i < clusterWorkerSize; i++) {
    cluster.fork();
  }

  // Recover all stuck active jobs
  jobs.active( function( err, ids ) {
    ids.forEach( function( id ) {
      kue.Job.get( id, function( err, job ) {
        // Your application should check if job is a stuck one
        job.inactive();
      });
    });
  });

} else {
  /* Worker Logic */
  var processGraftJob = buildProcessGraftJob(graft);

  // RENE Microservice Instance
  //var CpsRene = require('./lib/cps-rene');
  //var rene = new CpsRene(config.cpsReneOptions);
  //var reneSrv = rene.getService();
  
  var reneSrv = ws.client({ host: '10.0.4.15', port: 6001, reconnectTimeout: 1000 });
  reneSrv.on('ready', function() { console.log("ready event on rene microservice"); });
  reneSrv.session.on('error', function() { console.log("error event on rene microservice"); });
  reneSrv.session.on('close', function() { console.log("close event on rene microservice"); });

  if (config.cpsReneOptions.targets !== null && typeof config.cpsReneOptions.targets === 'object') {
    Object.keys(config.cpsReneOptions.targets).forEach(function(target, idx) {
      // Route graft jobs to relevant microservice
      graft.where({ systemId: target }, reneSrv);
      // Register event handler such that pending kue job will be processed
      reneSrv.once('ready', function() {
        jobs.process(target, 1, function(job, ctx, done) {
          if (!ctx.isMicroservicePauseBinded && reneSrv.session) {
            var resume = function() { console.log("resuming %s", target); ctx.resume(); };
            var pause = function() { console.log("pausing %s", target); reneSrv.once('ready', resume); ctx.pause(); };

            reneSrv.session.on('error', pause);
            reneSrv.session.on('close', pause);
            ctx.isMicroservicePauseBinded = true;
          }

          if (Object.keys(job.data).length > 1) {
            processGraftJob(job, ctx, done);
          } else {
            done();
          }
        });

        // Create initial job to initialize worker context
        jobs.create(target, { title: "Ready" }).save();
      });
    });
  }

  // Accurate Microservice Instance
  //var CpsAccurate = require('./lib/cps-accurate');
  //var accurate = new CpsAccurate(config.cpsAccurateOptions);
  //var accurateSrv = accurate.getService();

  var accurateSrv = ws.client({ host: '10.0.4.15', port: 6002, reconnectTimeout: 1000 });
  accurateSrv.on('ready', function() { console.log("ready event on accurate microservice"); });
  accurateSrv.session.on('error', function() { console.log("error event on accurate microservice"); });
  accurateSrv.session.on('close', function() { console.log("close event on accurate microservice"); });

  if (config.cpsAccurateOptions.targets !== null && typeof config.cpsAccurateOptions.targets === 'object') {
    Object.keys(config.cpsAccurateOptions.targets).forEach(function(target, idx) {
      // Route graft jobs to relevant microservice
      graft.where({ systemId: target }, accurateSrv);
      // Register event handler such that pending kue job will be processed
      accurateSrv.once('ready', function() {
        jobs.process(target, 1, function(job, ctx, done) {
          if (!ctx.isMicroservicePauseBinded && accurateSrv.session) {
            var resume = function() { console.log("resuming %s", target); ctx.resume(); };
            var pause = function() { console.log("pausing %s", target); accurateSrv.once('ready', resume); ctx.pause(); };

            accurateSrv.session.on('error', pause);
            accurateSrv.session.on('close', pause);
            ctx.isMicroservicePauseBinded = true;
          }

          if (Object.keys(job.data).length > 1) {
            processGraftJob(job, ctx, done);
          } else {
            done();
          }
        });

        // Create initial job to initialize worker context
        jobs.create(target, { title: "Ready" }).save();
      });
    });
  }

  console.log("Worker %s ready to process graft jobs.", cluster.worker.id);
}
