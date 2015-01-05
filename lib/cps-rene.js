var through = require('through2');

var pstools = require('./pstools')
var defaults = require('./defaults');

function buildCmds(availableTargets) {
  var cmdTypes = {};

  cmdTypes.AdjustXmlImport = function(systemId, filePaths, cb) {
        if (!availableTargets[systemId]) { return; }
        var SID = availableTargets[systemId];

        // Menyambung ke RENE Admin Client melalui PsTools
        var payload = { sources: filePaths, destination: "d$\\RENE\\Data\\Import" };
        for (var prop in SID) { payload[prop] = SID[prop]; }

        pstools.copyFileToRemote(payload, function (err, results) {
          if (err) { console.log(err); return; }
          results.forEach(function(res) {
            console.log(res);  
          });

          var cmd = "D:\\RENE\\XmlImport\\ReneXmlImport.exe";
          var params = filePaths.map(function(fp) {
            var fileName = fp.match(/[^\\/]+$/)[0];
            return "D:\\RENE\\Data\\Import\\" + fileName;
          });

          var payload = { cmd: cmd, params: params };
          for (var prop in SID) { payload[prop] = SID[prop]; }

          pstools.execAtRemote(payload, cb);
        });
  };

  cmdTypes.PluCsvImport = function(systemId, filePaths, cb) {
        if (!availableTargets[systemId]) { return; }
        var SID = availableTargets[systemId];

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

  return cmdTypes;
};

module.exports = function build(remoteTargets) {
  var cmdTypes = buildCmds(remoteTargets || defaults.reneTargets);

  return through.obj(function(msg, enc, cb) {
    if (!cmdTypes[msg.cmd]) { cb(new Error('Cmd not recognized')); return; }

    cmdTypes[msg.cmd](msg.systemId, msg.filePaths, function (err, results) {
      if (err) { console.log(err); return; }
      msg.returnChannel.end(results);
      cb(err, results);
    });
  });
};