var mailin = require('mailin');

var fs = require('fs');
var domain = require('domain');

var mailjob = require('./lib/mailjob');
var mailer = require('./lib/mailer');

/* Config-variables */

var config = require('./config');

config.mailinSmtpOptions = {
  port: 2500,
  disableWebhook: true, // Disable the webhook posting so we can handle emails ourselves.
  smtpOptions: {
    SMTPBanner: 'CPSSoft Smtp Server',
    validateSender: true,
    validateRecipients: true
  }
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
mailin.on('startMessage', function (connection) {
  /* connection = {
      from: 'sender@somedomain.com',
      to: 'someaddress@yourdomain.com',
      id: 't84h5ugf',
      authentication: { username: null, authenticated: false, status: 'NORMAL' }
    }
  }; */
  console.log(connection);

});

/* Event emitted when a connection with the Mailin smtp server is initiated. */
mailin.on('validateSender', function (connection, email, callback) {
  var senderDomain = email.split('@').pop();
  callback(senderDomain != 'frestive.com' && senderDomain != 'lmu.co.id' ? new Error('Failed sender') : null);
});

/* Event emitted when a connection with the Mailin smtp server is initiated. */
mailin.on('validateRecipient', function (connection, email, callback) {
  var recipientDomain = email.split('@').pop();
  callback(recipientDomain != 'cps.frestive.com' ? new Error('Failed recipient') : null);
});

/* Event emitted after a message was received and parsed. */
var d = domain.create();
d.on('error', function(err) { console.log(err); });
mailin.on('message', d.bind(function (connection, data, content) {
  //console.log(data);
  console.info("dkim: " + data.dkim);
  console.info("spf: " + data.spf);

  /* Do something useful with the parsed message here.
   * Use parsed message `data` directly or use raw message `content`. */
   
  // Test print all attachments
  //message.attachments.forEach(function(eachAttachment, idx) {
  //  console.log(eachAttachment.fileName);
  //});

  var replyToMessage = function(response) {
    return mailout.replyToEmail(data, response);
  }

  mailjob.onMessage(data, replyToMessage);
}));

/* Start the Mailin server */
mailin.start(config.mailinSmtpOptions);

