var through = require('through2');

var pstools = require('./pstools');
var defaults = require('./defaults');

function availableCommands(availableTargets) {
  var cmdTypes = {};
  cmdTypes.MasterXmlImport = function(systemId, filePaths, cb) {
        if (!availableTargets[systemId]) { return; }
        var SID = availableTargets[systemId];

        // Menyambung ke Accurate Client melalui PsTools
        var payload = { sources: filePaths, destination: "c$\\Accurate\\Data\\Import" };
        for (var prop in SID) { payload[prop] = SID[prop]; }

        pstools.copyFileToRemote(payload, function (err, results) {
          if (err) { console.log(err); return; }
          results.forEach(function(res) {
            console.log(res);  
          });

          var cmd = "C:\\Accurate\\AccXmlExportImport.exe";
          var params = filePaths.map(function(fp) {
            var fileName = fp.match(/[^\\/]+$/)[0];
            return ['-i', "C:\\Accurate\\Data\\Import\\" + fileName];
          });
          params = params.reduce(function(a, b) {
            return a.concat(b);
          }, []);
          params.unshift(SID.accurateDbHost, SID.accurateGdbPath);

          var payload = { cmd: cmd, params: params };
          for (var prop in SID) { payload[prop] = SID[prop]; }

          pstools.execAtRemote(payload, cb);
        });
  };

  return cmdTypes;
};

module.exports = function build(remoteTargets) {
  var cmdTypes = availableCommands(remoteTargets || defaults.accurateTargets);

  return through.obj(function(msg, enc, cb) {
    if (!cmdTypes[msg.cmd]) {
      var err = new Error('Cmd not recognized');
      msg.returnChannel.end({ error: err });
      return;
    }

    cmdTypes[msg.cmd](msg.systemId, msg.filePaths, function (err, res) {
      if (err) { msg.returnChannel.end({ error: err}); return; }
      msg.returnChannel.end({ error: null, result: res });
    });

    cb();  // Not sure why this is required.
  });
};