
let wst_client;
const net = require("net");
const WsStream = require("./WsStream");
const StreamServing = require("./wssession/StreamServing");
const url = require('url');
const log = require("lawg");
const ClientConn = require("./httptunnel/ClientConn");
const etagHeader = require("./etagHeader");
const createWsClient = () => new (require('websocket').client)();

module.exports = (wst_client = class wst_client extends require('events').EventEmitter {
  /*
  emit Events:
  'tunnel' (WsStream|ClientConn) when a tunnel is established
  'connectFailed' (err) when ws connection failed
  'connectHttpFailed' (err) when http tunnel connection failed
  */

  constructor() {
    super();
    this.tcpServer = net.createServer();
  }

  verbose() {
    this.on('tunnel', (ws, sock) => {
      if (ws instanceof WsStream) {
        log('Websocket tunnel established');
      } else { log('Http tunnel established'); }
      return sock.on('close', () => log('Tunnel closed'));
    });
    this.on('connectHttpFailed', error => log(`HTTP connect error: ${error.toString()}`));
    return this.on('connectFailed', error => log(`WS connect error: ${error.toString()}`));
  }

  setHttpOnly(httpOnly) {
    this.httpOnly = httpOnly;
  }

  setWsReconnTimeout(wsReconnTimeout) {
    this.wsReconnTimeout = wsReconnTimeout;
  }
  setWsSessionId(wsSessionId) {
    this.wsSessionId = wsSessionId;
  }
  setWsSecret(wsSecret) {
    this.wsSecret = wsSecret;
  }

  // example:  start(8081, "wss://ws.domain.com:454", "dst.domain.com:22")
  // meaning: tunnel *:localport to remoteAddr by using websocket connection to wsHost
  // or start("localhost:8081", "wss://ws.domain.com:454", "dst.domain.com:22")
  // @wsHostUrl:  ws:// denotes standard socket, wss:// denotes ssl socket
  //              may be changed at any time to change websocket server info
  start(localAddr, wsHostUrl, remoteAddr, optionalHeaders, cb) {
    let localHost, localPort;
    this.wsHostUrl = wsHostUrl;
    if (typeof optionalHeaders === 'function') {
      cb = optionalHeaders;
      optionalHeaders = {};
    }

    if (typeof localAddr === 'number') {
      localPort = localAddr;
    } else {
      [localHost, localPort] = Array.from(localAddr.split(':'));
      if (/^\d+$/.test(localHost)) {
        localPort = localHost;
        localHost = null;
      }
      localPort = parseInt(localPort);
    }
    if (localHost == null) { localHost = '127.0.0.1'; }

    this.tcpServer.listen(localPort, localHost, cb);
    return this.tcpServer.on("connection", tcpConn => {
      const bind = (s, tcp) => {
        require("./bindStream")(s, tcp);
        return this.emit('tunnel', s, tcp);
      };

      if (this.httpOnly) {
        return this._httpConnect(this.wsHostUrl, remoteAddr, optionalHeaders, (err, httpConn) => {
          if (!err) {
            return bind(httpConn, tcpConn);
          } else { return tcpConn.end(); }
        });
      } else {
        return this._wsConnect(this.wsHostUrl, remoteAddr, optionalHeaders, (error, wsStream) => {
          if (!error) {
            return bind(wsStream, tcpConn);
          } else {
            this.emit('connectFailed', error);
            return this._httpConnect(this.wsHostUrl, remoteAddr, optionalHeaders, (err, httpConn) => {
              if (!err) {
                return bind(httpConn, tcpConn);
              } else { return tcpConn.end(); }
            });
          }
        });
      }
    });
  }

  startStdio(wsHostUrl, remoteAddr, optionalHeaders, cb) {
    this.wsHostUrl = wsHostUrl;
    const bind = s => {
      process.stdin.pipe(s);
      s.pipe(process.stdout);
      // redirect all logs to stderr
      try {
        global.console = new console.Console(process.stderr, process.stderr);
      } catch (e) {
        console._stdout = console._stderr;
      }
      s.on('close', (message) => {
        if (message) {
          log(`closed connection: ${message}`);
        } else {
          log('closed connection.');
        }
        process.exit(0);
      });
      s.on('finish', () => {
        s.end();
        log('finish connection');
        process.exit(0);
      });
      s.on('error', err => {
        log("connection fatal error:", err);
      });
      s.on('informError', err => {
        log("connection error:", err);
      });
      s.on('handshakeError', err => {
        log("handshake error:", err);
        process.exit(2);
      });
      s.on('bound', ws => {
        log("connected.");
      });
      return s;
    };

    if (this.httpOnly) {
      return this._httpConnect(this.wsHostUrl, remoteAddr, optionalHeaders, (err, httpConn) => {
        if (!err) { bind(httpConn); }
        return cb(err);
      });
    } else {
      return this._wsConnect(this.wsHostUrl, remoteAddr, optionalHeaders, (error, wsStream) => {
        if (!error) {
          bind(wsStream);
          return cb();
        } else {
          this.emit('connectFailed', error);
          return this._httpConnect(this.wsHostUrl, remoteAddr, optionalHeaders, (err, httpConn) => {
            if (!err) { bind(httpConn); }
            return cb(err);
          });
        }
      });
    }
  }

  _httpConnect(url, remoteAddr, optionalHeaders, cb) {
    let tunurl = url.replace(/^ws/, 'http');
    if (remoteAddr) { tunurl += `?dst=${remoteAddr}`; }
    const httpConn = new ClientConn(tunurl);
    return httpConn.connect(optionalHeaders, err => {
      if (err) {
        this.emit('connectHttpFailed', err);
        return cb(err);
      } else {
        return cb(null, httpConn);
      }
    });
  }

  _wsConnect(wsHostUrl, remoteAddr, optionalHeaders, cb) {
    let wsurl = `${wsHostUrl}`;
    let options = {};
    if (remoteAddr) { options['dst'] = remoteAddr; }
    if (this.wsReconnTimeout) {
      options['sessioned'] = 'true'
      optionalHeaders['x-htunsess'] = this.wsSessionId ? this.wsSessionId : require('node-uuid').v1();
    }
    const optstr = Object.keys(options).map(k => `${k}=${options[k]}`).join("&");
    if (optstr.length>0) {
      wsurl += "/?" + optstr;
    }

    let connector = insideCb => {
      const wsClient = createWsClient();
      const urlo = url.parse(wsurl);
      if (urlo.auth) {
        optionalHeaders.Authorization = `Basic ${(new Buffer(urlo.auth)).toString('base64')}`;
      }
      wsClient.connect(wsurl, 'tunnel-protocol', undefined, optionalHeaders);
      wsClient.on('connectFailed', error => cb(error));
      wsClient.on('connect', wsConn => {
        let wsStream;
        if (this.wsReconnTimeout) {
          this.streamer.attach(wsConn);
          wsStream = this.streamer;
        } else {
          wsStream = new WsStream(wsConn);
        }
        return insideCb(null, wsStream);
      });
    }

    if (this.wsReconnTimeout) {
      this.streamer = new StreamServing(connector);
      if (this.wsSecret) {
        this.streamer.setSecret(this.wsSecret);
      }
    }

    connector(cb);
  }
});
