const Help = `
Run websocket tunnel server or client.
 To run server: wstunnel -s 0.0.0.0:8080
 To run client: wstunnel -t localport:host:port ws[s]://wshost:wsport
 Or client via proxy: wstunnel -t localport:host:port -p http://[user:pass@]host:port ws[s]://wshost:wsport

Now connecting to localhost:localport is same as connecting to host:port on wshost

For security, you can "lock" the tunnel destination on server side, for eample:
 wstunnel -s 0.0.0.0:8080 -t host:port
Server will tunnel incomming websocket connection to host:port only, so client can just run
 wstunnel -t localport ws://wshost:port
If client run:
 wstunnel -t localport:otherhost:otherport ws://wshost:port
 * otherhost:otherport is ignored, tunnel destination is still "host:port" as specified on server.

In client mode, you can bind stdio to the tunnel by running:
 wstunnel -t stdio:host:port ws[s]://wshost:wsport
This allows the command to be used as ssh proxy:
 ssh -o ProxyCommand="wstunnel -c -t stdio:%h:%p https://wstserver" user@sshdestination
Above command will ssh to "user@sshdestination" via the wstunnel server at "https://wstserver"

`
module.exports = (Server, Client) => {
  const optimist = require('optimist')
  let argv = optimist
    .usage(Help)
    .string("s")
    .string("t")
    .string("proxy")
    .alias('t', "tunnel")
    .boolean('c')
    .boolean('http')
    .boolean('wsreconnect')
    .string('wssessionid')  // for debug
    .string('wssecret')  // for debug
    .default('wstimeout', 60*60*24*1)  // one day
    .alias('c', 'anycert')
    .default('c', false)
    .describe('s', 'run as server, listen on [localip:]localport, default localip is 127.0.0.1')
    .describe('tunnel', 'run as tunnel client, specify [localip:]localport:host:port')
    .describe("proxy", "connect via a http proxy server in client mode")
    .describe("c", "accpet any certificates")
    .argv;

  if (argv.s) {
    let server;
    if (argv.t) {
      let [host, port] = argv.t.split(":")
      server = new Server(host, port)
    } else {
      server = new Server()
    }
    if (argv.wsreconnect) {
      server.setWsReconnTimeout(argv.wstimeout)
    }
    server.start(argv.s, (err) => err ? console.log(` Server is listening on ${argv.s}`) : null)
  } else if (argv.t) {
  // client mode

    const uuid = require("machine-uuid");
    uuid((machineId) => {
      require("../lib/httpSetup").config(argv.proxy, argv.c)
      let client = new Client()
      if (argv.http) {
        client.setHttpOnly(true)
      }
      if (argv.wsreconnect) {
        client.setWsReconnTimeout(argv.wstimeout);
      }
      if (argv.wssessionid) {
        client.setWsSessionId(argv.wssessionid);
      }
      if (argv.wssecret) {
        client.setWsSecret(argv.wssecret);
      }

      let wsHostUrl = argv._[0]
      client.verbose()

      let DefaultLocalAddr = "127.0.0.1"
      let localAddr
      let remoteAddr
      let toks = argv.t.split(":")
      if (toks.length === 4) {
        localAddr = `${toks[0]}:${toks[1]}`
        remoteAddr = `${toks[2]}:${toks[3]}`
      } else if (toks.length === 3) {
        remoteAddr = `${toks[1]}:${toks[2]}`;
        if (toks[0] === 'stdio') {
          client.startStdio(wsHostUrl, remoteAddr, {'x-wstclient': machineId}, (err) => {
            if (err) {
              console.error(err)
              process.exit(1)
            }
          })
          return
        } else {
          localAddr = `${DefaultLocalAddr}:${toks[0]}`
        }
      } else if (toks.length === 1) {
        localAddr = `${DefaultLocalAddr}:${toks[0]}`
      }
      client.start(localAddr, wsHostUrl, remoteAddr, {'x-wstclient': machineId});
    })
  } else {
    return console.log(optimist.help());
  }
}

