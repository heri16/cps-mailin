var mailin = require('mailin');

var fs = require('fs');
var domain = require('domain');

var mailjob = require('./lib/mailjob');
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
var d = domain.create();
d.on('error', function(err) { console.log(err); });
mailin.on('message', d.bind(function(message) {
  /* Do something useful with the parsed message here.
   * Use it directly or modify it and post it to a webhook. */
  // console.log(message);
  console.info("dkim: " + message.dkim);
  console.info("spf: " + message.spf);
   
  // Test print all attachments
  //message.attachments.forEach(function(eachAttachment, idx) {
  //  console.log(eachAttachment.fileName);
  //});

  var replyToMessage = function(response) {
    return mailout.replyToEmail(message, response);
  }

  mailjob.onMessage(message, replyToMessage);
}));

/* Start the Mailin server */
mailin.start(config.mailinSmtpOptions);

