var mailin = require('mailin');

var domain = require('domain');

var Mailjob = require('./lib/mailjob');
var Mailer = require('./lib/mailer');

/* Config-variables */

var config = require('./config');

/* System variables */

// Jobs Queue Adder
var mailjob = new Mailjob({
  kue: {
    redis: config.redisOptions
  }
});

// Nodemailer Transporter to smtp-relay.gmail.com
var mailout = new Mailer(config.mailoutOptions);

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
mailin.start(config.mailinOptions);
