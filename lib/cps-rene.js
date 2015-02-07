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

  cmdTypes.AdjustXmlImport = function(systemId, filePaths, cb) {
    var extraArgs = availableTargets[systemId];
    if (!extraArgs) { return; }

    // Menyambung ke RENE Admin Client melalui PsTools
    console.log("copyFileToRemote");
    var inArgs = extend({ sources: filePaths, destination: "D:\\RENE\\Data\\Import\\" }, extraArgs);
    pstools.copyFileToRemote(inArgs, function(err, results) {
      if (err) { cb(err); return; }
      console.log(results.join('\n'));

      var cmd = "D:\\RENE\\XmlImport\\ReneXmlImport.exe";
      var params = filePaths.map(function(filePath) {
        var fileName = path.basename(filePath);
        return path.join("D:\\RENE\\Data\\Import\\", fileName);
      });

      console.log("execAtRemote");
      var inArgs = extend({ cmd: cmd, params: params }, extraArgs);
      pstools.execAtRemote(inArgs, function(err, results) {
        if (err) { cb(err); return; }
        console.log(results.join('\n'));

        tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmp) {
          if (err) { cb(err); return; }

          var localFilePath = path.join(dirPath, 'ReneXmlImport.exe.log');

          console.log("copyFileFromRemote");
          var inArgs = extend({ sources: "D:\\RENE\\XmlImport\\ReneXmlImport.exe.log", destination: localFilePath }, extraArgs);
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

  cmdTypes.PluCsvImport = function(systemId, filePaths, cb) {
    var extraArgs = availableTargets[systemId];
    if (!extraArgs) { return; }

    // Menyambung ke RENE Admin Client melalui PsTools
    console.log("copyFileToRemote");
    var inArgs = extend({ sources: filePaths, destination: "D:\\MT\\Data\\" }, extraArgs);
    pstools.copyFileToRemote(inArgs, function(err, results) {
      if (err) { cb(err); return; }
      console.log(results.join('\n'));

      console.log("execAtRemote");
      var inArgs = extend({ cmd: "D:\\MT\\MtTransferAll.exe", params: [] }, extraArgs);
      pstools.execAtRemote(inArgs, function(err, results) {
        if (err) { cb(err); return; }
        console.log(results.join('\n'));

        tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmpCb) {
          if (err) { cb(err); return; }

          var localFilePath = path.join(dirPath, 'MtTransferAll.exe.log');

          console.log("copyFileFromRemote");
          var inArgs = extend({ sources: "D:\\MT\\MtTransferAll.exe.log", destination: localFilePath }, extraArgs);
          pstools.copyFileFromRemote(inArgs, function(err, results) {
            if (err) { cb(err); return; }
            console.log(results.join('\n'));

            fs.readFile(localFilePath, 'utf8', function(err, text) {
              cleanupTmpCb();
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

      //var keepalive = setInterval(function() { msg.returnChannel.write({ heartbeat: new Date().getTime() }) }, 2000);

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
          console.log(outPath);

          //fileStream.on('close', function() { console.log('close in receiver'); });
          //fileStream.on('finish', function() { console.log('finish in receiver'); });
          //fileStream.on('end', function() { console.log('end in receiver'); });

          //outStream.on('close', function() { console.log('close in receiver'); });
          //outStream.on('finish', function() { console.log('finish in receiver'); });
          //outStream.on('end', function() { console.log('end in receiver'); });

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

            //clearInterval(keepalive);
          });
        });
      });

    });
  });
};

if (require.main === module) {
  var config = require('../config');
  require('graft/spdy')
    .server({ port: 6001 })
    .on('ready', function() {
      console.log('Added listening on port', 6001);
    })
    .pipe(module.exports(config.reneTargets));
}
