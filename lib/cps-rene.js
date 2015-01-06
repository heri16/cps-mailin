var through = require('through2');
var tmp = require('tmp');

var path = require('path');
var fs = require('fs');
var extend = require('util')._extend;

var pstools = require('./pstools')
var defaults = require('./defaults');

function availableCommands(availableTargets) {
  var cmdTypes = {};

  cmdTypes.AdjustXmlImport = function(systemId, filePaths, cb) {
        var extraArgs = availableTargets[systemId];
        if (!extraArgs) { return; }

        // Menyambung ke RENE Admin Client melalui PsTools
        var inArgs = extend({ sources: filePaths, destination: "d$\\RENE\\Data\\Import" }, extraArgs);
        pstools.copyFileToRemote(inArgs, function(err, results) {
          if (err) { console.log(err); return; }
          console.log(results.join('\n'));

          var cmd = "D:\\RENE\\XmlImport\\ReneXmlImport.exe";
          var params = filePaths.map(function(fp) {
            var fileName = fp.match(/[^\\/]+$/)[0];
            return path.join("D:\\RENE\\Data\\Import\\", fileName);
          });

          var inArgs = extend({ cmd: cmd, params: params }, extraArgs);
          pstools.execAtRemote(inArgs, function(err, results) {
            if (err) { cb(err); return; }
            console.log(results.join('\n'));

            tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmp) {
              if (err) { cb(err); return; }

              var localFilePath = path.join(dirPath, 'ReneXmlImport.exe.log');

              var inArgs = extend({ source: "d$\\RENE\\XmlImport\\ReneXmlImport.exe.log", destination: localFilePath }, extraArgs);
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

  cmdTypes.PluCsvImport = function(systemId, filePaths, cb) {
        var extraArgs = availableTargets[systemId];
        if (!extraArgs) { return; }

        // Menyambung ke RENE Admin Client melalui PsTools
        var inArgs = extend({ sources: filePaths, destination: "d$\\MT\\Data\\" }, extraArgs);
        pstools.copyFileToRemote(inArgs, function(err, results) {
          if (err) { cb(err); return; }
          console.log(results.join('\n'));

          var inArgs = extend({ cmd: "D:\\MT\\MtTransferAll.exe", params: [] }, extraArgs);
          pstools.execAtRemote(inArgs, function(err, results) {
            if (err) { cb(err); return; }
            console.log(results.join('\n'));

            tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmpCb) {
              if (err) { cb(err); return; }

              var localFilePath = path.join(dirPath, 'MtTransferAll.exe.log');

              var inArgs = extend({ source: "d$\\MT\\MtTransferAll.exe.log", destination: localFilePath }, extraArgs);
              pstools.copyFileFromRemote(inArgs, function(err, results) {
                if (err) { cb(err); return; }
                console.log(results.join('\n'));

                fs.readFile(localFilePath, 'utf8', function(err, text) {
                  cleanupTmpCb();
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
  var cmdTypes = availableCommands(remoteTargets || defaults.reneTargets);

  return through.obj(function(msg, enc, cb) {
    if (!cmdTypes[msg.cmd]) {
      var err = new Error('Cmd not recognized');
      msg.returnChannel.end({ error: err });
      return;
    }

    cmdTypes[msg.cmd](msg.systemId, msg.filePaths, function (err, res) {
      if (err) { msg.returnChannel.end({ error: err }); return; }
      msg.returnChannel.end({ error: null, result: res });
    });

    cb();  // Not sure why this is required.
  });
};