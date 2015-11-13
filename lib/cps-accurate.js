var graft = require('graft');
var through2 = require('through2');
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

  cmdTypes.MasterXmlImport = function(systemId, filePaths, logger, cb) {
    var extraArgs = availableTargets[systemId];
    if (!extraArgs) { return; }

    // Menyambung ke Accurate Client melalui PsTools
    logger.log("copyFileToRemote");
    var inArgs = extend({ sources: filePaths, destination: "C:\\Accurate\\Data\\Import\\" }, extraArgs);
    pstools.copyFileToRemote(inArgs, function (err, results) {
      if (err) { cb(err); return; }
      logger.log(results.join('\n'));

      logger.log("enablePowershellRemoting");
      pstools.enablePowershellRemoting(extraArgs, function(err, results) {
        if (err) { cb(err); return; }
        logger.log(results.join('\n'));

        var cmd = "C:\\Accurate\\AccXmlExportImport.exe";
        var params = filePaths.map(function(filePath) {
          var fileName = path.basename(filePath);
          return ['-i', path.join("C:\\Accurate\\Data\\Import\\", fileName) ];
        });
        params = params.reduce(function(a, b) { return a.concat(b); }, []);
        params.unshift(extraArgs.accurateDbHost, extraArgs.accurateGdbPath);

        logger.log("execAtRemote");
        var inArgs = extend({ cmd: cmd, params: params }, extraArgs);
        pstools.execAtRemote(inArgs, function(err, results) {
          if (err) { cb(err); return; }
          logger.log(results.join('\n'));

          tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmp) {
            if (err) { cb(err); return; }

            var localFilePath = path.join(dirPath, 'AccXmlExportImport.exe.log');

            logger.log("copyFileFromRemote");
            var inArgs = extend({ sources: "C:\\Accurate\\AccXmlExportImport.exe.log", destination: localFilePath }, extraArgs);
            pstools.copyFileFromRemote(inArgs, function(err, results) {
              if (err) { cb(err); return; }
              logger.log(results.join('\n'));

              fs.readFile(localFilePath, 'utf8', function(err, text) {
                cleanupTmp();
                logger.log(text);
                cb(err, text);
              });

            });
          });
        });
      });
    });
  };

  return cmdTypes;
};


function buildDownloadService() {
  return through2.obj(function(msg, enc, next) {
    var self= this;

    if (msg.returnChannel) { msg.returnChannel.on('finish', function() { console.warn('finish event in returnChannel'); }); }

    var d = domain.create();
    d.on('error', function(err) {
      console.warn(err);
      if (msg.returnChannel && !msg.returnChannel.ended) { msg.returnChannel.end({ error: { message: err.message, stack: err.stack }}); }
      next();  // Release backpressure
    });

    // Remote logger via graft/libchan return channel
    var logger = {
      log: function remoteLog() {
        console.log.apply(console, arguments);
        if (msg.returnChannel && !msg.returnChannel.ended) { msg.returnChannel.write({ log: Array.prototype.slice.call(arguments) }); }
      }
    };

    d.run(function() {
      if (!('fileStreams' in msg)) { throw new Error("msg.fileStreams missing"); }

      // Write msg.fileStreams to temporary directory      
      tmp.dir({ unsafeCleanup: true }, function(err, dirPath, cleanupTmp) {
        if (err) { cleanupTmp(); throw err; }

        // Save remote fileStreams to local temp directory.
        async.map(Object.keys(msg.fileStreams), function _writeStream(fileName, cb) {
          var fileStream = msg.fileStreams[fileName];
          var outPath = path.join(dirPath, fileName);
          var outStream = fs.createWriteStream(outPath);

          //fileStream.on('open', function() { logger.log('open event in origin file'); });
          //fileStream.on('error', function(err) { logger.log('error event in origin file'); });
          //fileStream.on('readable', function() { logger.log('readable event in origin file'); });
          //fileStream.on('end', function() { logger.log('end event in origin file'); });
          //fileStream.on('close', function() { logger.log('close event in origin file'); });

          //outStream.on('pipe', function() { logger.log('pipe event in destination file'); });
          //outStream.on('open', function() { logger.log('open event in destination file'); });
          //outStream.on('error', function(err) { logger.log('error event in destination file'); });
          //outStream.on('drain', function() { logger.log('drain event in destination file'); });
          //outStream.on('finish', function() { logger.log('finish event in destination file'); });

          // Pipe remote ReadableStream to local WritableStream
          fileStream.on('error', function(err) { cb(err); });
          outStream.on('error', function(err) { cb(err); });
          outStream.on('open', function() { logger.log("File %s at local destination opened for writing.", fileName); });
          fileStream.on('end', function() { logger.log("File %s from remote origin read to end.", fileName); fileStream._read(); });  // Workaround: Bug with finish message that does not call done() to release backpressure
          outStream.on('finish', function() { logger.log("Written %d bytes to file %s", outStream.bytesWritten, outPath); cb(null, outPath); });
          //fileStream.pipe(through2()).pipe(outStream);  // Needed intermediate passthrough-stream due to bug in jschan-spdy library.
          fileStream.pipe(outStream);

        }, function(err, filePaths) {
          if (err) { cleanupTmp(); throw err; }

          msg.filePaths = filePaths;
          delete msg.fileStreams;
          self.push(msg);

          next();
        });
      });
    });
  });
};

  function buildExecutionService(commandName, commandFunc) {
    return through2.obj(function(msg, enc, next) {
      var d = domain.create();
      d.on('error', function(err) {
        console.warn(err);
        if (msg.returnChannel && !msg.returnChannel.ended) { msg.returnChannel.end({ error: { message: err.message, stack: err.stack }}); }
        next();  // Release backpressure
      });

      // Remote logger via graft/libchan return channel
      var logger = {
        log: function remoteLog() {
          console.log.apply(console, arguments);
        if (msg.returnChannel && !msg.returnChannel.ended) { msg.returnChannel.write({ log: Array.prototype.slice.call(arguments) }); }
        }
      };

      d.run(function() {
        if (!('systemId' in msg)) { throw new Error("msg.systemId missing"); }
        if (!('filePaths' in msg)) { throw new Error("msg.filePaths missing"); }

        // Begin heartbeat before long-running execution
        if (msg.returnChannel) {
          var heartbeat = function() { if (!msg.returnChannel.ended) msg.returnChannel.write({ systemId: msg.systemId, heartbeat: new Date().getTime() }) };
          var keepalive = setInterval(heartbeat, 5000);
          setImmediate(heartbeat);
        }
        setImmediate(next);  // Release backpressure after first heartbeat

        // Execute command on target system.
        logger.log("Executing %s ...", commandName);
        commandFunc(msg.systemId, msg.filePaths, logger, function(err, res) {
          if (msg.returnChannel && !msg.returnChannel.ended) {          
            if (heartbeat) { clearInterval(keepalive); }

            if (err) {
              msg.returnChannel.write({ error: { message: err.message, stack: err.stack }});
            } else {
              msg.returnChannel.write({ result: res });
            }
          
            msg.returnChannel.end();
          }

          //next();  // Release backpressure
        });
      });
    });
  };


var CpsAccurate = function _constructor(opts) {
  var opts = opts || {};

  this.cmdTypes = availableCommands(opts.targets || {});

};

CpsAccurate.prototype.getService = function _getService() {
  if (this.service) { return this.service; }

  this._buildExecService = buildExecutionService;
  this._buildFileService = buildDownloadService;

  this.service = graft();
  this.fileService = this._buildFileService();
  this.fileService.pipe(this.service);
  this.execServices = {};

  this.service.branch(function(msg) { return ('fileStreams' in msg); }, this.fileService);
  for (var cmdName in this.cmdTypes) {
    this.execServices[cmdName] = this._buildExecService(cmdName, this.cmdTypes[cmdName]);
    this.service.where({ cmd: cmdName }, this.execServices[cmdName]);
  }

  return this.service;
};

module.exports = CpsAccurate;


if (require.main === module) {
  var config = require('../config');
  var accurate = new CpsAccurate(config.cpsAccurateOptions);

  require('graft/ws')
    .server({ port: 6002 })
    .on('ready', function() {
      console.log('Added listener on port', 6002);
    })
    .pipe(accurate.getService());
}
