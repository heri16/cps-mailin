var through = require('through2');

var nodemailer = require('nodemailer');

exports.wrap = function wrap(transporter) {
  var mailer = { transporter: transporter };

  // Default handler
  var defaultCb = function mailerCallback(err, info) {
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

  // Nodemailer Function to assist in replying to emails
  mailer.replyToEmail = function replyToEmail(message, response, cb) {
    var mailOptions = {
      from: message.envelopeTo,
      to: message.envelopeFrom,
      cc: message.cc,
      inReplyTo: message.messageId,
      subject: 'Re: ' + message.subject,
      text: ( (typeof response === 'string' || response instanceof String) ? response : JSON.stringify(response, null, 2) )
    };

    transporter.sendMail(mailOptions, cb || defaultCb);
  };

  // Nodemailer Function to assist in forwarding emails
  mailer.forwardEmailTo = function forwardEmailTo(message, toAddress, cb) {

    forwardedMessage = extend(message, {});
    forwardedMessage.envelope = {
      from: message.envelopeTo,
      to: toAddress
    };

    transporter.sendMail(forwardedMessage, cb || defaultCb);
  };

  return mailer;
};