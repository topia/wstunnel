// Generated by CoffeeScript 1.10.0
(function() {
  module.exports = function(Server, Client) {
    var argv, host, optimist, port, ref, server;
    optimist = require('optimist');
    argv = optimist.usage("\nRun websocket tunnel server or client.\n  To run server: wstunnel -s 8080\n  To run client: wstunnel -t localport:host:port ws[s]://wshost:wsport\n  Or client via proxy: wstunnel -t localport:host:port -p http://[user:pass@]host:port ws[s]://wshost:wsport\n\nNow connecting to localhost:localport is same as connecting to host:port on wshost\n\nFor security, you can \"lock\" the tunnel destination on server side, for eample:\n  wstunnel -s 8080 -t host:port\nServer will tunnel incomming websocket connection to host:port only, so client can just run\n  wstunnel -t localport ws://wshost:port\nIf client run:\n  wstunnel -t localport:otherhost:otherport ws://wshost:port\n  * otherhost:otherport is ignored, tunnel destination is still \"host:port\" as specified on server.\n\nIn client mode, you can bind stdio to the tunnel by running:\n  wstunnel -t stdio:host:port ws[s]://wshost:wsport\nThis allows the command to be used as ssh proxy:\n  ssh -o ProxyCommand=\"wstunnel -c -t stdio:%h:%p https://wstserver\" user@sshdestination\nAbove command will ssh to \"user@sshdestination\" via the wstunnel server at \"https://wstserver\"\n").string("s").string("t").string("proxy").alias('t', "tunnel").boolean('c').boolean('http').alias('c', 'anycert')["default"]('c', false).describe('s', 'run as server, specify listen port').describe('tunnel', 'run as tunnel client, specify localport:host:port').describe("proxy", "connect via a http proxy server in client mode").describe("c", "accpet any certificates").argv;
    if (argv.s) {
      if (argv.t) {
        ref = argv.t.split(":"), host = ref[0], port = ref[1];
        server = new Server(host, port);
      } else {
        server = new Server();
      }
      return server.start(argv.s, (function(_this) {
        return function(err) {
          if (!err) {
            return console.log(" Server is listening on " + argv.s);
          }
        };
      })(this));
    } else if (argv.t) {
      return require("machine-uuid")(function(machineId) {
        var client, localAddr, remoteAddr, toks, wsHost;
        require("../lib/httpSetup").config(argv.proxy, argv.c);
        client = new Client();
        if (argv.http) {
          client.setHttpOnly(true);
        }
        wsHost = argv._.slice(0)[0];
        client.verbose();
        localAddr = void 0;
        remoteAddr = void 0;
        toks = argv.t.split(":");
        if (toks.length === 4) {
          localAddr = toks[0] + ":" + toks[1];
          remoteAddr = toks[2] + ":" + toks[3];
        } else if (toks.length === 3) {
          if (toks[0] === 'stdio') {
            require("find-free-port")(11200, 12000, '127.0.0.1', (function(_this) {
              return function(err, port) {
                localAddr = "127.0.0.1:" + port;
                remoteAddr = toks[1] + ":" + toks[2];
                return client.start(localAddr, wsHost, remoteAddr, {
                  'x-wstclient': machineId
                }, function() {
                  var conn, net;
                  net = require("net");
                  return conn = net.createConnection({
                    host: '127.0.0.1',
                    port: port
                  }, function() {
                    process.stdin.pipe(conn);
                    conn.pipe(process.stdout);
                    return conn.on('finish', function() {
                      return process.exit(0);
                    });
                  });
                });
              };
            })(this));
            return;
          } else {
            localAddr = "127.0.0.1:" + toks[0];
            remoteAddr = toks[1] + ":" + toks[2];
          }
        } else if (toks.length === 1) {
          localAddr = "127.0.0.1:" + toks[0];
        }
        return client.start(localAddr, wsHost, remoteAddr, {
          'x-wstclient': machineId
        });
      });
    } else {
      return console.log(optimist.help());
    }
  };

}).call(this);

//# sourceMappingURL=wstunnel.js.map
