var async = require('async');
var kue = require('kue');

var tmp = require('tmp');
var unzip = require('unzip');
var AdmZip = require('adm-zip');

var fs = require('fs');
var path = require('path');

var Mailjob = function _constructor(opts) {
  var opts = opts || {};

  // Mailin will store jobs to Microservices (retry with backoff)
  this.jobs = kue.createQueue(opts.kue || {});
  this.jobs.on('error', function(err) {});  // Must be bound or will crash
};

Mailjob.prototype.onMessage = function _onMessage(message, replyToMessage) {
  var self = this;

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
      if (err) { console.error(err); replyToMessage(err); return; }
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
          replyToMessage(err);
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
          title: cmd + ' on ' + message.receivedDate + ' - ' + message.messageId,
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
        self.jobs.create(systemId, jobData).delay(50).attempts(15).backoff({ delay: 60*1000, type:'fixed' }).save(function(err) {
          if (err) { console.error(err); replyToMessage(err); return; }
          replyToMessage("Job Queued for SID: " + systemId + '\n\n' + "Note: Jangan mengirim data yang sama karena sudah ada mekanisme auto-retry.");

          // END          
        });
      });
    });
  });
  
};

module.exports = Mailjob;
