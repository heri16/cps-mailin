var through = require('through2');
var async = require('async');
var tmp = require('tmp');

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var extend = require('util')._extend;
var domain = require('domain');

var pstools = require('./pstools')

function availableCommands(availableTargets) {
  var cmdTypes = {};

  cmdTypes.MasterXmlImport = function(systemId, filePaths, cb) {
        var extraArgs = availableTargets[systemId];
        if (!extraArgs) { return; }

        // Menyambung ke Accurate Client melalui PsTools
        console.log("copyFileToRemote");
        var inArgs = extend({ sources: filePaths, destination: "C:\\Accurate\\Data\\Import\\" }, extraArgs);
        pstools.copyFileToRemote(inArgs, function (err, results) {
          if (err) { cb(err); return; }
          console.log(results.join('\n'));

          var cmd = "C:\\Accurate\\AccXmlExportImport.exe";
          var params = filePaths.map(function(filePath) {
            var fileName = path.basename(filePath);
            return ['-i', path.join("C:\\Accurate\\Data\\Import\\", fileName) ];
          });
          params = params.reduce(function(a, b) { return a.concat(b); }, []);
          params.unshift(extraArgs.accurateDbHost, extraArgs.accurateGdbPath);

          console.log("execAtRemote");
          var inArgs = extend({ cmd: cmd, params: params }, extraArgs);
          pstools.execAtRemote(inArgs, function(err, results) {
            if (err) { cb(err); return; }
            console.log(results.join('\n'));

            tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmp) {
              if (err) { cb(err); return; }

              var localFilePath = path.join(dirPath, 'AccXmlExportImport.exe.log');

              console.log("copyFileFromRemote");
              var inArgs = extend({ sources: "C:\\Accurate\\AccXmlExportImport.exe.log", destination: localFilePath }, extraArgs);
              pstools.copyFileFromRemote(inArgs, function(err, results) {
                if (err) { cb(err); return; }
                console.log(results.join('\n'));

                fs.readFile(localFilePath, 'utf8', function(err, text) {
                  cleanupTmp();
                  console.log(text);
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

  return through.obj(function(msg, enc, next) {
    var d = domain.create();
    d.on('error', function(err) {
      if (msg.returnChannel) { msg.returnChannel.end({ error: { message: err.message, stack: err.stack }}); }
      next();
    });

    d.run(function() {
      console.log(msg.cmd);

      if (!cmdTypes[msg.cmd]) {
        throw new Error('Cmd not recognized');
      }

      tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmp) {
        if (err) { cleanupTmp(); throw err; }

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

          setImmediate(setTimeout, function(s) { s.push(null); }, 5000, fileStream);

        }, function(err, filePaths) {
          if (err) { cleanupTmp(); throw err; }

          // Execute command on target system.
          cmdTypes[msg.cmd](msg.systemId, filePaths, function(err, res) {
            if (err) {
              cleanupTmp();
              if (msg.returnChannel) { msg.returnChannel.end({ error: { message: err.message, stack: err.stack }}); }
              next();
              return;
            }
            
            cleanupTmp();
            if (msg.returnChannel) { msg.returnChannel.end({ result: res }); }
            next();  // Release backpressure
          });
        });
      });

    });
  });
};

if (require.main === module) {
  var config = require('../config');
  require('graft/spdy')
    .server({ port: 6002 })
    .on('ready', function() {
      console.log('Added listening on port', 6002);
    })
    .pipe(module.exports(config.reneTargets));
}