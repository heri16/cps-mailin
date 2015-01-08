var through = require('through2');
var tmp = require('tmp');

var path = require('path');
var fs = require('fs');
var extend = require('util')._extend;

var pstools = require('./pstools');

function availableCommands(availableTargets) {
  var cmdTypes = {};
  cmdTypes.MasterXmlImport = function(systemId, filePaths, cb) {
        var extraArgs = availableTargets[systemId];
        if (!extraArgs) { return; }

        // Menyambung ke Accurate Client melalui PsTools
        var inArgs = extend({ sources: filePaths, destination: "c$\\Accurate\\Data\\Import" }, extraArgs);
        pstools.copyFileToRemote(inArgs, function (err, results) {
          if (err) { console.log(err); return; }
          console.log(results.join('\n'));

          var cmd = "C:\\Accurate\\AccXmlExportImport.exe";
          var params = filePaths.map(function(fp) {
            var fileName = fp.match(/[^\\/]+$/)[0];
            return ['-i', path.join("C:\\Accurate\\Data\\Import\\", fileName) ];
          });
          params = params.reduce(function(a, b) { return a.concat(b); }, []);
          params.unshift(extraArgs.accurateDbHost, extraArgs.accurateGdbPath);

          var inArgs = extend({ cmd: cmd, params: params }, extraArgs);
          pstools.execAtRemote(inArgs, function(err, results) {
            if (err) { cb(err); return; }
            console.log(results.join('\n'));

            tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmp) {
              if (err) { cb(err); return; }

              var localFilePath = path.join(dirPath, 'AccXmlExportImport.exe.log');

              var inArgs = extend({ source: "c$\\Accurate\\AccXmlExportImport.exe.log", destination: localFilePath }, extraArgs);
              pstools.copyFileFromRemote(inArgs, function(err, results) {
                if (err) { cb(err); return; }
                console.log(results.join('\n'));

                fs.readFile(localFilePath, 'utf8', function(err, text) {
                  cleanupTmp();
                  cb(err, text);
                });

              });
            });
          });
        });
  };

  return cmdTypes;
};

module.exports = function build(remoteTargets) {
  var cmdTypes = availableCommands(remoteTargets || {});

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