var timeoutPromise = function(timeout) {
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      resolve();
    }, timeout);
  });
}

exports['Should correctly load-balance the operations'] = {
  metadata: {
    requires: {
      generators: true,
      topology: "single"
    }
  },

  test: function(configuration, test) {
    var Mongos = configuration.require.Mongos,
      ObjectId = configuration.require.BSON.ObjectId,
      co = require('co'),
      mockupdb = require('../../../mock');

    // Contain mock server
    var mongos1 = null;
    var mongos2 = null;
    var running = true;
    // Current index for the ismaster
    var currentStep = 0;
    // Primary stop responding
    var stopRespondingPrimary = false;

    // Extend the object
    var extend = function(template, fields) {
      for(var name in template) fields[name] = template[name];
      return fields;
    }

    // Default message fields
    var defaultFields = {
      "ismaster" : true,
      "msg" : "isdbgrid",
      "maxBsonObjectSize" : 16777216,
      "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000,
      "localTime" : new Date(),
      "maxWireVersion" : 3,
      "minWireVersion" : 0,
      "ok" : 1
    }

    // Primary server states
    var serverIsMaster = [extend(defaultFields, {})];
    // Boot the mock
    co(function*() {
      mongos1 = yield mockupdb.createServer(52000, 'localhost');
      mongos2 = yield mockupdb.createServer(52001, 'localhost');

      // Mongos
      co(function*() {
        while(running) {
          var request = yield mongos1.receive();

          // Get the document
          var doc = request.document;
          if(doc.ismaster) {
            request.reply(serverIsMaster[0]);
          } else if(doc.insert) {
            request.reply({ok:1, n:doc.documents, lastOp: new Date()});
          }
        }
      });

      // Mongos
      co(function*() {
        while(running) {
          var request = yield mongos2.receive();

          // Get the document
          var doc = request.document;
          if(doc.ismaster) {
            request.reply(serverIsMaster[0]);
          } else if(doc.insert) {
            request.reply({ok:1, n:doc.documents, lastOp: new Date()});
          }
        }
      });

      // Start dropping the packets
      setTimeout(function() {
        stopRespondingPrimary = true;
        currentIsMasterState = 1;
      }, 5000);

      // Attempt to connect
      var server = new Mongos([
          { host: 'localhost', port: 52000 },
          { host: 'localhost', port: 52001 },
        ], {
        connectionTimeout: 3000,
        socketTimeout: 1000,
        haInterval: 1000,
        size: 1
      });

      // Add event listeners
      server.once('connect', function(_server) {
        _server.insert('test.test', [{created:new Date()}], function(err, r) {
          test.equal(null, err);
          test.equal(52000, r.connection.port);

          _server.insert('test.test', [{created:new Date()}], function(err, r) {
            test.equal(null, err);
            test.equal(52001, r.connection.port);

            _server.insert('test.test', [{created:new Date()}], function(err, r) {
              test.equal(null, err);
              test.equal(52000, r.connection.port);

              running = false;
              server.destroy();
              mongos1.destroy();
              mongos2.destroy();
              test.done();
            });
          });
        });
      });

      server.on('error', function(){});
      server.connect();
    });
  }
}

exports['Should ignore one of the mongos instances due to being outside the latency window'] = {
  metadata: {
    requires: {
      generators: true,
      topology: "single"
    }
  },

  test: function(configuration, test) {
    var Mongos = configuration.require.Mongos,
      ObjectId = configuration.require.BSON.ObjectId,
      co = require('co'),
      mockupdb = require('../../../mock');

    // Contain mock server
    var mongos1 = null;
    var mongos2 = null;
    var running = true;
    // Current index for the ismaster
    var currentStep = 0;
    // Primary stop responding
    var stopRespondingPrimary = false;

    // Extend the object
    var extend = function(template, fields) {
      for(var name in template) fields[name] = template[name];
      return fields;
    }

    // Default message fields
    var defaultFields = {
      "ismaster" : true,
      "msg" : "isdbgrid",
      "maxBsonObjectSize" : 16777216,
      "maxMessageSizeBytes" : 48000000,
      "maxWriteBatchSize" : 1000,
      "localTime" : new Date(),
      "maxWireVersion" : 3,
      "minWireVersion" : 0,
      "ok" : 1
    }

    // Primary server states
    var serverIsMaster = [extend(defaultFields, {})];
    // Boot the mock
    co(function*() {
      mongos1 = yield mockupdb.createServer(52000, 'localhost');
      mongos2 = yield mockupdb.createServer(52001, 'localhost');

      // Mongos
      co(function*() {
        while(running) {
          var request = yield mongos1.receive();

          // Get the document
          var doc = request.document;
          if(doc.ismaster) {
            request.reply(serverIsMaster[0]);
          } else if(doc.insert) {
            request.reply({ok:1, n:doc.documents, lastOp: new Date()});
          }
        }
      });

      // Mongos
      co(function*() {
        while(running) {
          var request = yield mongos2.receive();
          // Delay all the operations by 100 ms
          yield timeoutPromise(100);
          // Get the document
          var doc = request.document;
          if(doc.ismaster) {
            request.reply(serverIsMaster[0]);
          } else if(doc.insert) {
            request.reply({ok:1, n:doc.documents, lastOp: new Date()});
          }
        }
      });

      // Start dropping the packets
      setTimeout(function() {
        stopRespondingPrimary = true;
        currentIsMasterState = 1;
      }, 5000);
    });

    // Attempt to connect
    var server = new Mongos([
        { host: 'localhost', port: 52000 },
        { host: 'localhost', port: 52001 },
      ], {
      connectionTimeout: 3000,
      localThresholdMS: 50,
      socketTimeout: 1000,
      haInterval: 1000,
      size: 1
    });

    // Add event listeners
    server.once('fullsetup', function(_server) {
      server.insert('test.test', [{created:new Date()}], function(err, r) {
        test.equal(null, err);
        test.equal(52000, r.connection.port);

        server.insert('test.test', [{created:new Date()}], function(err, r) {
          test.equal(null, err);
          test.equal(52000, r.connection.port);

          server.destroy();

          // Attempt to connect
          var server2 = new Mongos([
              { host: 'localhost', port: 52000 },
              { host: 'localhost', port: 52001 },
            ], {
            connectionTimeout: 3000,
            localThresholdMS: 500,
            socketTimeout: 1000,
            haInterval: 1000,
            size: 1
          });

          // Add event listeners
          server2.once('fullsetup', function(_server) {
            server2.insert('test.test', [{created:new Date()}], function(err, r) {
              test.equal(null, err);
              test.equal(52001, r.connection.port);

              server2.insert('test.test', [{created:new Date()}], function(err, r) {
                test.equal(null, err);
                test.equal(52000, r.connection.port);

                server2.destroy();
                mongos1.destroy();
                mongos2.destroy();
                running = false;
                test.done();
              });
            });
          });

          server2.connect();
        });
      });
    });

    server.on('error', function(){});
    server.connect();
  }
}
