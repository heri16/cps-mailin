var mailin = require('mailin');
var mkdirp = require('mkdirp');
var async = require('async');

var fs = require('fs');

var zerosap = require('sap-zerorpc');


/* Config-variables */

/* System variables */


/* Event emitted when a connection with the Mailin smtp server is initiated. */
mailin.on('startMessage', function (messageInfo) {
  /* messageInfo = {
      from: 'sender@somedomain.com',
      to: 'someaddress@yourdomain.com',
      connectionId: 't84h5ugf'
  }; */
  console.log(messageInfo);
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
  var systemIds = message.to.map(function(eachTo, idx) {
  	var match = emailRegexp.exec(eachTo.address);
  	return match[1];
  });
  console.log("SIDs: " + systemIds);
  
  // Melakukan untuk setiap systemId (e.g. DEV/PRD)
  systemIds.forEach(function(systemId, idx) {
    //console.log(systemId);

    // Membuat subfolder baru berdasarkan setiap systemId
    var folderPath = 'data/' + systemId;
    mkdirp(folderPath, function(err) {
      if (err) { return console.log(err); }
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

          console.log('Attachment: ' + filePath);
          cb(null, filePath);
        });

      }, function(err, filePaths) {
        // Menyambung ke SAP melalui ZeroRPC
        var sapClient = zerosap.getSapClient(systemId);

        // Melakukan upload ke SAP berdasarkan setiap systemId
        sapClient.uploadFiles(filePaths, function(err, res) {
          if(err) { return console.log(err); }

          // XML Files successfully uploaded.
          console.log("Checksums: " + res);

          // Mentafsirkan command yang di inginkan
          var funcName = message.subject.match(/:?\s?(\w+)$/)[1];
          try {
            var jsonString = message.text.match(/({[\s\S]+})/)[1];
            var funcParams = JSON.parse(jsonString);
          } catch(ex) {
            var funcParams = {};
            console.log(ex);
          }

          // Waktu nya untuk melakukan Remote-Function-Call ke ABAP.
          sapClient.call(funcName, funcParams, function(err, res) {
            if(err) { return console.log(err); }
            console.log("RFC Response: ");
            console.log(res);
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
  port: 2525,
  disableWebhook: true // Disable the webhook posting.
});

