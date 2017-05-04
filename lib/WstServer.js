let wst_server;
const WebSocketServer = require('websocket').server;
const http = require('http');
const url = require("url");
const net = require("net");
const uuid = require("node-uuid");
const WsStream = require("./WsStream");
const StreamServing = require("./wssession/StreamServing")
const log = require("lawg");
const HttpTunnelServer = require("./httptunnel/Server");
const HttpTunnelReq = require("./httptunnel/ConnRequest");
const ChainedWebApps = require("./ChainedWebApps");

module.exports = (wst_server = class wst_server {

  // if dstHost, dstPort are specified here, then all tunnel end points are at dstHost:dstPort, regardless what
  // client requests, for security option
  // webapp: customize webapp if any, you may use express app
  constructor(dstHost, dstPort, webapp) {
    this.dstHost = dstHost;
    this.dstPort = dstPort;
    this.httpServer = http.createServer();
    this.wsServer = new WebSocketServer({
      httpServer: this.httpServer,
      autoAcceptConnections: false
    });
    // each app is http request handler function (req, res, next),  calls next() to ask next app
    // to handle request
    const apps = new ChainedWebApps();
    this.tunnServer = new HttpTunnelServer(apps);
    if (webapp) {
      apps.setDefaultApp(webapp);
    }
    apps.bindToHttpServer(this.httpServer);
    this.wsSessions = {};
  }

  setWsReconnTimeout(wsReconnTimeout) {
    this.wsReconnTimeout = wsReconnTimeout;
  }

  // localAddr:  [addr:]port, the local address to listen at, i.e. localhost:8888, 8888, 0.0.0.0:8888
  start(localAddr, cb) {
    const [localHost, localPort] = Array.from(this._parseAddr(localAddr));
    return this.httpServer.listen(localPort, localHost, err => {
      if (cb) { cb(err); }

      const handleReq = (request, connWrapperCb) => {
        const { httpRequest } = request;
        return this.authenticate(httpRequest, (rejectReason, target, monitor) => {
          if (rejectReason) {
            return request.reject(500, JSON.stringify(rejectReason));
          }
          const {host, port} = target;
          var tcpConn = net.connect({host, port, allowHalfOpen: false}, () => {
            tcpConn.removeAllListeners('error');
            const ip = require("./httpReqRemoteIp")(httpRequest);
            log(`Client ${ip} establishing ${request instanceof HttpTunnelReq ? 'http' : 'ws'} tunnel to ${host}:${port}`);
            let wsConn = request.accept('tunnel-protocol', request.origin);
            if (connWrapperCb) { wsConn = connWrapperCb(wsConn); }
            require("./bindStream")(wsConn, tcpConn);
            if (monitor) { return monitor.bind(wsConn, tcpConn); }
          });

          return tcpConn.on("error", err => request.reject(500, JSON.stringify(`Tunnel connect error to ${host}:${port}: ` + err)));
        });
      };

      this.wsServer.on('request', req => {
        var closed, ip, sess, sessid, wsConn;
        var {wsSessions, wsReconnTimeout} = this;
        if (wsReconnTimeout && (sessid = req.httpRequest.headers['x-htunsess'])) {
          sess = null;
          if (wsSessions.hasOwnProperty(sessid)) {
            sess = wsSessions[sessid];
          }
          if (sess === null) {
            sess = wsSessions[sessid] = new StreamServing();
            sess.setSecret(uuid.v1());
            closed = false;
            sess.on('close', () => {
              if (closed) {
                return;
              }
              closed = true;
              log(`finished session ${sessid}`);
              return delete wsSessions[sessid];
            });
          } else {
            ip = require("./httpReqRemoteIp")(req.httpRequest);
            log(`Client ${ip} reconnected ws tunnel as session ${sessid}`)
            wsConn = req.accept('tunnel-protocol', req.origin);
            sess.attach(wsConn);
            return;
          }
        }
        return handleReq(req, wsConn => {
          if (sess !== null) {
            log(`accept as new session ${sessid}`);
            sess.attach(wsConn);
            return sess;
          } else {
            // @_patch(wsConn)
            return new WsStream(wsConn);
          }
        });
      });
      return this.tunnServer.on('request', req => {
        return handleReq(req);
      });
    });
  }

  // authCb(rejectReason, {host, port}, monitor)
  authenticate(httpRequest, authCb) {
    let host, port;
    if (this.dstHost && this.dstPort) {
      [host, port] = Array.from([this.dstHost, this.dstPort]);
    } else {
      const dst = this.parseUrlDst(httpRequest.url);
      if (!dst) {
        return authCb('Unable to determine tunnel target');
      } else { ({host, port} = dst); }
    }
    return authCb(null, {host, port});  // allow by default
  }

  // returns {host, port} or undefined
  parseUrlDst(requrl) {
    const uri = url.parse(requrl, true);
    if (!uri.query.dst) {
      return undefined;
    } else {
      const [host, port] = Array.from(uri.query.dst.split(":"));
      return {host, port};
    }
  }

  _parseAddr(localAddr) {
    let localHost, localPort;
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
    return [localHost, localPort];
  }

  _patch(ws) {
    return ws.drop = function(reasonCode, description, skipCloseFrame) {
      this.closeReasonCode = reasonCode;
      this.closeDescription = description;
      this.outgoingFrameQueue = [];
      this.frameQueue = [];
      this.fragmentationSize = 0;
      if (!skipCloseFrame) {
        this.sendCloseFrame(reasonCode, description, true);
      }
      this.connected = false;
      this.state = "closed";
      this.closeEventEmitted = true;
      this.emit('close', reasonCode, description);
      // ensure peer receives the close frame
      return this.socket.end();
    };
  }
});

