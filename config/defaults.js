var fs = require('fs');
var path = require('path');

exports.redisOptions = {
  host: 'localhost',
  port: 6379
};

exports.mailinOptions = {
  port: 2500,
  disableWebhook: true, // Disable the webhook posting so we can handle emails ourselves.
  smtpOptions: {
    SMTPBanner: 'CPSSoft Smtp Server',
    validateSender: true,
    validateRecipients: true
  }
  // logFile: '/some/local/path'
};

exports.mailoutOptions = {
  transport: {
    host: 'smtp-relay.gmail.com',
    port: 465,
    secure: true,
    tls: {
      ca: [
        fs.readFileSync(path.join(__dirname, 'certs/d83c1a7f4d0446bb2081b81a1670f8183451ca24.pem')), // Google Internet Authority G2
        fs.readFileSync(path.join(__dirname, 'certs/710b673d8cccc305993d05edb5ddab1cef3ef464.pem')), // GeoTrust Global CA
        fs.readFileSync(path.join(__dirname, 'certs/d23209ad23d314232174e40d7f9d62139786633a.pem')) // Equifax Secure Certificate Authority
      ],
      rejectUnauthorized: true
    }
  }
};

exports.cpsReneOptions = {
  targets: {
    "3001": {
      computerName: "30.139.40.15",
      username: "Mailin",
      passwordFile: "config\\3001.pem"
    },
    "3002": {
      computerName: "30.188.136.245",
      username: "Mailin",
      passwordFile: "config\\3002.pem"
    }
  }
};

exports.cpsAccurateOptions = {
  targets: {
    "JAKARTA": {
      computerName: "10.0.5.115",
      username: "Mailin",
      passwordFile: "config\\3001.pem",
      accurateDbHost: "10.0.4.10", 
      accurateGdbPath: "D:\\JAKARTA.GDB"
    },
    "BALI": {
      computerName: "10.0.5.115",
      username: "Mailin",
      passwordFile: "config\\3001.pem",
      accurateDbHost: "10.0.4.10", 
      accurateGdbPath: "D:\\BALI.GDB"
    }
  }
};
