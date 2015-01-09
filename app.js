var async = require('async');
var graft = require('graft')();
var kue = require('kue');

var mailin = require('mailin');
var tmp = require('tmp');
var mkdirp = require('mkdirp');
var unzip = require('unzip');
var AdmZip = require('adm-zip');

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var extend = require('util')._extend;

var cps = require('./lib/cps');
var mailer = require('./lib/mailer');


/* Config-variables */

var config = require('./config');

config.mailinSmtpOptions = {
  port: 2500,
  disableWebhook: true // Disable the webhook posting so we can handle emails ourselves.
  // logFile: '/some/local/path'
};

config.mailoutSmtpOptions = {
  host: 'smtp-relay.gmail.com',
  port: 465,
  secure: true,
  tls: {
    ca: [
      fs.readFileSync('certs/d83c1a7f4d0446bb2081b81a1670f8183451ca24.pem'), // Google Internet Authority G2
      fs.readFileSync('certs/710b673d8cccc305993d05edb5ddab1cef3ef464.pem'), // GeoTrust Global CA
      fs.readFileSync('certs/d23209ad23d314232174e40d7f9d62139786633a.pem') // Equifax Secure Certificate Authority
    ],
    rejectUnauthorized: true
  }
};


/* System variables */

// Nodemailer Transporter to smtp-relay.gmail.com
var mailout = mailer.create(config.mailoutSmtpOptions);

// Mailin will store jobs to Microservices (retry with backoff)
var jobs = kue.createQueue();
jobs.on('error', function(err) {});  // Must be bound or will crash

// RENE Microservice Instance
var reneSrv = cps.rene(config.reneTargets);
graft.where({ systemId: '3001' }, reneSrv);
graft.where({ systemId: '3002' }, reneSrv);

// Accurate Microservice Instance
var accurateSrv = cps.accurate(config.accurateTargets);
graft.where({ systemId: 'JAKARTA' }, accurateSrv);
graft.where({ systemId: 'BALI' }, accurateSrv);

/* Event emitted when a pending kue job needs to be processed. */
jobs.process('GraftJS', 1, function(job, done) {
  // Get persisted graftMessage from job data
  var msg = job.data.graftMessage;
  
  // Convert filePaths into filestreams that can be sent via graft jschan
  var fileStreams = {};
  msg.filePaths.forEach(function(filePath) {
    var fileName = path.basename(filePath);
    //var zlibCompress = zlib.createDeflate();
    fileStreams[fileName] = fs.createReadStream(filePath);
  });
  msg.fileStreams = fileStreams;

  // Request to microservices (dispatched by graft.where() pattern-matching)
  var ret = graft.ReadChannel();
  msg.returnChannel = ret;
  graft.write(msg);

  // Reply from microservice (Warning: might not receive any reply on returnChannel)
  ret.on('data', function (msg) {
    console.log(msg);

    if (msg.result && msg.result.join) { msg.result = msg.result.join('\n'); }
    done(msg.error, msg.result);
  });
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


/* Event emitted when a connection with the Mailin smtp server is initiated. */
mailin.on('startMessage', function (messageInfo) {
  /* messageInfo = {
      from: 'sender@somedomain.com',
      to: 'someaddress@yourdomain.com',
      connectionId: 't84h5ugf'
  }; */
  //console.info(messageInfo);
});

/* Event emitted after a message was received and parsed.
 * The message parameters contains the parsed email. */
mailin.on('message', function (message) {

  /* Do something useful with the parsed message here.
   * Use it directly or modify it and post it to a webhook. */
  // console.log(message);
  console.info("dkim: " + message.dkim);
  console.info("spf: " + message.spf);
   
  // Test print all attachments
  //message.attachments.forEach(function(eachAttachment, idx) {
  //  console.log(eachAttachment.fileName);
  //});
  
  // Mendapatkan semua SAP System Ids
  if (!message.to) { message.to = []; } 
  var emailRegexp = /^(.+)@([\w\.]+)$/;
  var systemIds = message.to.map(function(eachTo, idx) {
  	var match = emailRegexp.exec(eachTo.address);
  	return match[1].toUpperCase();
  });
  console.info("SIDs: " + systemIds);
  
  // Melakukan untuk setiap systemId (e.g. DEV/PRD)
  systemIds.forEach(function(systemId, idx) {
    // Membuat temp folder baru berdasarkan systemId
    tmp.dir({ unsafeCleanup: false, dir: './.tmp', prefix: systemId + '-' }, function(err, folderPath, cleanupTmp) {
      if (err) { console.error(err); mailout.replyToEmail(message, err); return; }
      // Tidak ada error, maka...
      
      // Mendapatkan semua attachments
      async.mapLimit(message.attachments, 2, function(eachAttachment, cb) {
        // Menulis setiap attachment ke dalam subfolder (setiap systemId)
        var filePath = path.join(folderPath, eachAttachment.fileName);
        fs.writeFile(filePath, eachAttachment.content, function(err) {
          if (err) { cb(err); return; }
          // Tidak ada error, maka...
          
          // Melepas memory yang terpakai
          delete eachAttachment.content;

          console.info('Attachment Saved: ' + filePath);

          // Extract ke folder kalau zip file
          if (/\.zip$/.test(eachAttachment.fileName)) {
            var filePaths = [];

            var zip = new AdmZip(filePath);
            var zipEntries = zip.getEntries();
            zipEntries.forEach(function(entry) {
              if (!entry.isDirectory) {
                var entryFilePath = path.join(folderPath, entry.entryName);
                zip.extractEntryTo(entry, folderPath, true, true);
                filePaths.push(entryFilePath);
                console.info('Attachment ZipEntry: ' + entryFilePath);
              }
            });
            setImmediate(cb, null, filePaths);

            /*
            // Disabled due to High CPU Usage
            var parser = unzip.Parse()
            fs.createReadStream(filePath).pipe(
               parser
            ).on('finish', function() {
              parser.end();
              setImmediate(cb, null, filePaths);

            }).on('entry', function (entry) {
              if (entry.type === 'File') {
                var entryFilePath = path.join(folderPath, entry.path);

                var writeStream = fs.createWriteStream(entryFilePath);
                writeStream.on('close', function() {
                  filePaths.push(entryFilePath);
                  console.info('Attachment ZipEntry: ' + entryFilePath);
                });

                entry.pipe(writeStream);
                //filePaths.push(entryFilePath);

              } else {
                entry.autodrain();
              }
            });
            */

          } else {
            cb(null, filePath);
          }
        });

      }, function(err, filePathsArrays) {
        if (err) {
          // Called when any first async task has an error
          console.error(err);
          mailout.replyToEmail(message, err);
          cleanupTmp();
          return;
        }

        // Get desired command from the email subject
        var cmd = message.subject.match(/:?\s?(\w+)$/)[1];
        // Flatten an array of arrays of attachment paths
        var filePaths = filePathsArrays.reduce(function(a, b) {
          return a.concat(b);
        }, []);

        // Create data structure needed in the new persisted kue job
        var jobData = {
          title: cmd + ' ' + systemId + ' - ' + message.messageId,
          graftMessage: {
            cmd: cmd,
            systemId: systemId,
            filePaths: filePaths
          },
          sourceMail: {
            from: message.from,
            to: message.to,
            cc: message.cc,
            envelopeFrom: message.envelopeFrom,
            envelopeTo: message.envelopeTo,
            messageId: message.messageId,
            subject: message.subject
          }
        };

        // Create persistent job that will retry graft microservices
        jobs.create('GraftJS', jobData).attempts(15).backoff({ type:'exponential', delay: 2000 }).save(function(err) {
          if (err) { console.error(err); mailout.replyToEmail(message, err); return; }
          mailout.replyToEmail(message, "Job Queued for SID: " + systemId + '\n\n' + "Note: Jangan mengirim data yang sama karena sudah ada mekanisme auto-retry.");

          // END          
        });
      });
    });
  });
  
  
});

/* Start the Kue jobs processing */
jobs.promote();
/* Start the Kue Web UI */
kue.app.set('title', 'Mailin Job Queue');
kue.app.listen(3000);

/* Start the Mailin server */
mailin.start(config.mailinSmtpOptions);

