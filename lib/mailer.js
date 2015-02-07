var nodemailer = require('nodemailer');

// Default handler
function defaultSendMailCallback(err, info) {
  if (err) {
    console.error("Mailer Error: ");
    console.error(err);
    return;
  }

  console.info("Mailer Server Ident: " + info.response);

  if (info.rejected && info.rejected.length > 0) {
    console.info("Mailer Rejected: " + info.rejected);
  }

  if (info.accepted && info.accepted.length > 0) {
    console.info("Mailer Accepted: " + info.accepted);
  }
};


var Mailer = function _constructor(opts) {
  var opts = opts || {};

  this.transporter = nodemailer.createTransport(opts.transport || {});
  this.sendMailCb = opts.sendMailCallback || defaultSendMailCallback;
};

// Nodemailer Function to assist in replying to emails
Mailer.prototype.replyToEmail = function _replyToEmail(message, response, cb) {
  var mailOptions = {
    from: message.envelopeTo,
    to: message.envelopeFrom,
    cc: message.cc,
    inReplyTo: message.messageId,
    subject: 'Re: ' + message.subject,
    text: ( (typeof response === 'string' || typeof response.toString === "function") ? response.toString() : JSON.stringify(response, null, 2) )
  };

  this.transporter.sendMail(mailOptions, cb || this.sendMailCb);
};

// Nodemailer Function to assist in forwarding emails
Mailer.prototype.forwardEmailTo = function _forwardEmailTo(message, toAddress, cb) {
  forwardedMessage = extend(message, {});
  forwardedMessage.envelope = {
    from: message.envelopeTo,
    to: toAddress
  };

  this.transporter.sendMail(forwardedMessage, cb || this.sendMailCb);
};

module.exports = Mailer;
