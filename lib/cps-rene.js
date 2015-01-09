var through = require('through2');
var async = require('async');
var tmp = require('tmp');

var fs = require('fs');
var path = require('path');
var extend = require('util')._extend;

var pstools = require('./pstools')

function availableCommands(availableTargets) {
  var cmdTypes = {};

  cmdTypes.AdjustXmlImport = function(systemId, filePaths, cb) {
        var extraArgs = availableTargets[systemId];
        if (!extraArgs) { return; }

        // Menyambung ke RENE Admin Client melalui PsTools
        var inArgs = extend({ sources: filePaths, destination: "D:\\RENE\\Data\\Import\\" }, extraArgs);
        pstools.copyFileToRemote(inArgs, function(err, results) {
          if (err) { console.log(err); return; }
          console.log(results.join('\n'));

          var cmd = "D:\\RENE\\XmlImport\\ReneXmlImport.exe";
          var params = filePaths.map(function(filePath) {
            var fileName = path.basename(filePath);
            return path.join("D:\\RENE\\Data\\Import\\", fileName);
          });

          var inArgs = extend({ cmd: cmd, params: params }, extraArgs);
          pstools.execAtRemote(inArgs, function(err, results) {
            if (err) { cb(err); return; }
            console.log(results.join('\n'));

            tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmp) {
              if (err) { cb(err); return; }

              var localFilePath = path.join(dirPath, 'ReneXmlImport.exe.log');

              var inArgs = extend({ sources: "D:\\RENE\\XmlImport\\ReneXmlImport.exe.log", destination: localFilePath }, extraArgs);
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
        var inArgs = extend({ sources: filePaths, destination: "D:\\MT\\Data\\" }, extraArgs);
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

              var inArgs = extend({ sources: "D:\\MT\\MtTransferAll.exe.log", destination: localFilePath }, extraArgs);
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
  var cmdTypes = availableCommands(remoteTargets || {});

  return through.obj(function(msg, enc, callback) {
    if (!cmdTypes[msg.cmd]) {
      var err = new Error('Cmd not recognized');
      msg.returnChannel.end({ error: err });
      return;
    }

    tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmp) {
      // Save remote fileStreams to local temp directory.
      async.map(Object.keys(msg.fileStreams), function _writeStream(fileName, cb) {
        var fileStream = msg.fileStreams[fileName];
        var outPath = path.join(dirPath, fileName);
        var outStream = fs.createWriteStream(outPath);
        fileStream.pipe(outStream).on('error', function(err) {
          cb(err);
        }).on('finish', function() {
          cb(null, outPath);
        });

      }, function(err, filePaths) {
        // Execute command on target system.
        cmdTypes[msg.cmd](msg.systemId, filePaths, function (err, res) {
          if (err) { msg.returnChannel.end({ error: err }); cleanupTmp(); return; }
          msg.returnChannel.end({ error: null, result: res });
          cleanupTmp();
        });
      });
    });

    callback();  // Not sure why this is required.
  });
};