var mailin = require('mailin');
var nodemailer = require('nodemailer');
var mkdirp = require('mkdirp');
var unzip = require('unzip');
var async = require('async');
var edge = require('edge');

var fs = require('fs');

var pstools = require('./lib/pstools')

/* Config-variables */
var SIDs = {
  "3001": {
    host: "28.139.40.15",
    username: "Mailin",
    passwordFile: "data\\3001.pem"
  },
  "jakarta": {
    host: "10.0.5.115",
    username: "Mailin",
    passwordFile: "data\\3001.pem"
  },
};

/* System variables */

var funcNames = {};
funcNames.MasterXmlImport = function(systemId, filePaths, cb) {
        if (!SIDs[systemId]) { return; }
        var SID = SIDs[systemId];

        // Menyambung ke Accurate Client melalui PsTools
        var payload = { sources: filePaths, destination: "c$\\Accurate\\Data\\Import" };
        for (var prop in SID) { payload[prop] = SID[prop]; }

        pstools.copyFileToRemote(payload, function (err, results) {
          if (err) { console.log(err); return; }
          results.forEach(function(res) {
            console.log(res);  
          });

          var payload = { cmd: "C:\\Accurate\\AccXmlImport.exe" };
          for (var prop in SID) { payload[prop] = SID[prop]; }

          pstools.execAtRemote(payload, cb);
        });
};

funcNames.PluCsvImport = function(systemId, filePaths, cb) {
        if (!SIDs[systemId]) { return; }
        var SID = SIDs[systemId];

        // Menyambung ke RENE Admin Client melalui PsTools
        var payload = { sources: filePaths, destination: "d$\\MT\\Data" };
        for (var prop in SID) { payload[prop] = SID[prop]; }

        pstools.copyFileToRemote(payload, function (err, results) {
          if (err) { console.log(err); return; }
          results.forEach(function(res) {
            console.log(res);  
          });

          var payload = { cmd: "D:\\MT\\MtTransferAll.exe" };
          for (var prop in SID) { payload[prop] = SID[prop]; }

          pstools.execAtRemote(payload, cb);
        });
};

// Nodemailer Transporter to smtp-relay.gmail.com
var replyTransporter = nodemailer.createTransport({
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
});

// Nodemailer Function to assist in replying to emails
function replyToEmail(message, response, cb) {
  if (!cb) {
    cb = function(err, res) {
      console.error(err ? err : res);
    };
  }
 
  var mailOptions = {
    from: message.envelopeTo,
    to: message.envelopeFrom,
    inReplyTo: message.messageId,
    subject: 'Re: ' + message.subject,
    text: ( (typeof response === 'string' || response instanceof String) ? response : JSON.stringify(response, null, 2) )
  };

  replyTransporter.sendMail(mailOptions, cb);
}

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
  //console.log(message);
  /* Do something useful with the parsed message here.
   * Use it directly or modify it and post it to a webhook. */
   
  // Uji coba print log
  //console.log(message.to[0].address);
  //message.attachments.forEach(function(eachAttachment, idx) {
  //  console.log(eachAttachment.fileName);
  //});
  
  
  // Mendapatkan satu SAP System Id
  var emailRegexp = /^(.+)@([\w\.]+)$/;
  //var toAddress = "DEV@sap.lmu.co.id";
  //var match = emailRegexp.exec(toAddress);
  //var systemId = match[1];
  //console.log(systemId);
  
  // Mendapatkan semua SAP System Ids
  if (!message.to) { message.to = []; } 
  var systemIds = message.to.map(function(eachTo, idx) {
  	var match = emailRegexp.exec(eachTo.address);
  	return match[1];
  });
  console.info("SIDs: " + systemIds);
  
  // Melakukan untuk setiap systemId (e.g. DEV/PRD)
  systemIds.forEach(function(systemId, idx) {
    //console.info(systemId);
    replyToEmail(message, "Processing SID: " + systemId, function() {});

    // Membuat subfolder baru berdasarkan setiap systemId
    var folderPath = 'data/' + systemId;
    mkdirp(folderPath, function(err) {
      if (err) { console.error(err); replyToEmail(message, err); return; }
      // Tidak ada error, maka...
      
      // Mendapatkan semua attachments
      async.mapLimit(message.attachments, 2, function(eachAttachment, cb) {
        // Menulis setiap attachment ke dalam subfolder (setiap systemId)
        var filePath = folderPath + '/' + eachAttachment.fileName;
        fs.writeFile(filePath, eachAttachment.content, function(err) {
          if (err) { cb(err); return; }
          // Tidak ada error, maka...
          
          // Melepas memory yang terpakai
          delete eachAttachment.content;

          console.info('Attachment Saved: ' + filePath);

          // Extract ke folder kalau zip file
          if (/\.zip$/.test(eachAttachment.fileName)) {
            var unzipParser = fs.createReadStream(filePath).pipe(unzip.Parse());
            var filePaths = [];
            unzipParser.on('entry', function (entry) {
              if (entry.type === 'File') {
                var entryFilePath = folderPath + '/' + entry.path;
                entry.pipe(fs.createWriteStream(entryFilePath)).on('finish', function() {
                  console.info('Attachment ZipEntry: ' + entryFilePath);
                  filePaths.push(entryFilePath);
                });
              }
            });
            unzipParser.on('close', function() {
              cb(null, filePaths);
            });

          } else {
            cb(null, filePath);
          }
        });

      }, function(err, filePaths) {
        if (err) { console.error(err); replyToEmail(message, err); return; }

        // Flatten an array of arrays
        filePaths = filePaths.reduce(function(a, b) {
          return a.concat(b);
        });

        var funcName = message.subject.match(/:?\s?(\w+)$/)[1];
        if (!funcNames[funcName]) { return; }

        funcNames[funcName](systemId, filePaths, function (err, results) {
          if (err) { console.log(err); return; }

          results.forEach(function(res) {
            console.log(res);  
          });

          var replyBody = results.join('\n');

          // Email balik RFC-response nya ke pengirim email.
          replyToEmail(message, replyBody, function(err, info) {
            if (err) {
              console.error("Email-Reply Error: ");
              console.error(err);
              return;
            }
            // Tidak ada error, maka...

            console.info("Email-Reply Server: " + info.response);

            if (info.rejected && info.rejected.length > 0) {
              console.info("Email-Reply Rejected: " + info.rejected);
            }

            if (info.accepted && info.accepted.length > 0) {
              console.info("Email-Reply Accepted: " + info.accepted);
            }

            // END
          });
        });
      });
    });
  });
  
  
});


/* Start the Mailin server. The available options are: 
 *  options = {
 *     port: 25,
 *     webhook: 'http://mydomain.com/mailin/incoming,
 *     disableWebhook: false,
 *     logFile: '/some/local/path'
 *  };
 * Here disable the webhook posting so that you can do what you want with the
 * parsed message. */
mailin.start({
  port: 2500,
  disableWebhook: true // Disable the webhook posting.
});

