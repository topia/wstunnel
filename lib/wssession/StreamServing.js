let WsBufferedStream;
const
  stream = require("stream"),
  assert = require("assert"),
  log = require("lawg"),
  util = require("util"),
  future = require("phuture"),
  BufferHistory = require("./BufferHistory");

module.exports = (WsBufferedStream = class WsBufferedStream extends stream.Duplex {

  constructor(reconnector) {
    super();
    this.reconnector = reconnector;
    this._sig = "wsBuffered";
    this.ws = null;
    this.wantClose = false;
    this.closed = false;
    this.nowSending = false;
    this.bufHistory = new BufferHistory(16 * 1024 * 1024);
    this.sendQueue = [];
    this.sendingCallbacks = [];
    this.seenpos = 0;
    this.boundedHandlers = {
      onMessage: (...args) => this.onMessage(...args),
      onClose: (...args) => this.onClose(...args),
      onError: (...args) => this.onError(...args),
    };
    this.client = reconnector ? true : false;
    this.secret = null;
    this.secretHandshaking = true;
    this.reconnecting = false;
  }

  setSecret(secret) {
    this.secret = secret;
  }

  attach(ws) {
    var bind_ws, handshaking, on_close, on_error, on_message;
    handshaking = true;
    on_message = message => {
        if (handshaking) {
          if (this.handshake(ws, message.utf8Data)) {
            handshaking = false;
            return bind_ws(ws);
          }
        } else {
          return this.onMessage(message);
        }
      };
    on_close = (code, description) => {
        return this.emit('handshakeError', {
          type: 'close',
          code: code,
          description: description
        });
      };
    on_error = err => {
        this.emit('handshakeWarn', {
          type: 'error',
          err: err
        });
        ws.close(1012, "error on handshake!");
        return this.queueReconnect();
      };
    bind_ws = ws => {
        if (this.ws) {
          this.ws.removeListener('message', this.boundedHandlers.onMessage);
          this.ws.removeListener('close', this.boundedHandlers.onClose);
          this.ws.removeListener('error', this.boundedHandlers.onError);
          this.ws.on('message', function(message) {
            return log("some message from abandoned connection", message);
          });
          this.ws.on('error', function(err) {
            return log("some error from abandoned connection", err);
          });
          this.ws.on('close', function() {});
          this.ws.close(1001, "this connection abandoned by another peer");
        }
        this.ws = ws;
        this.ws.removeListener('close', on_close);
        this.ws.on('close', this.boundedHandlers.onClose);
        this.ws.removeListener('message', on_message);
        this.ws.on('message', this.boundedHandlers.onMessage);
        this.ws.removeListener('error', on_error);
        this.ws.on('error', this.boundedHandlers.onError);
        return this.flushSendQueue();
      };
    ws.on('message', on_message);
    ws.on('close', on_close);
    ws.on("error", on_error);
    return this.sendHandshake(ws);
  };

  detach() {
    if (this.ws == null) return;
    const ws = this.ws;
    this.ws = null;
    ws.removeListener('close', this.boundedHandlers.onClose);
    ws.removeListener('message', this.boundedHandlers.onMessage);
    ws.removeListener('error', this.boundedHandlers.onError);
  }

  end() {
    super.end();
    this.wantClose = true;
    if (this.ws) {
      // log("closing ws", arguments);
      return this.ws.close(1000, "Closing Connection");
    } else {
      this.closed = true;
      return this.emit('close', null);
    }
  };

  onMessage(message) {
    var buf;
    buf = message.binaryData;
    this.seenpos += buf.length;
    return this.push(buf);
  };

  onClose(reasonCode, description) {
    this.ws = null;
    //log(`${this}.onclose${[reasonCode, description]} / wantClose:${this.wantClose} / closed:${this.closed}`);
    if (this.closed) {
      return;
    }
    if (this.wantClose || reasonCode === 1000) {
      this.closed = true;
      this.emit('close', null);
    } else if (reasonCode === 1001) {
      this.closed = true;
      this.emit('close', 'session-hijacked: ' + description);
    } else if (reasonCode === 1011) {
      this.closed = true;
      this.emit('close', 'protocol error: ' + description);
    } else if (reasonCode === 1006 && !this.client) {
      // drop connection; skip it
      log(`ws closed, but wait next connection`);
      return;
    } else {
      this.queueReconnect({
        reasonCode: reasonCode,
        description: description
      });
    }
  };

  onError(err) {
    this.emit('informError', err);
    this.queueReconnect(err);
  };

  queueReconnect(info) {
    if (typeof this.reconnector === 'function') {
      if (this.reconnecting) return;
      const ws = this.ws;
      if (ws !== null) {
        this.detach();
        try {
          ws.close();
        } catch (e) {
          console.error('ws close error:', e);
        }
      }
      this.reconnecting = true;
      setTimeout(() => {
          this.reconnector((err) => {
            this.reconnecting = false;
            if (err) {
              this.emit('informError', err);
              this.queueReconnect(err);
            }
          });
        }, 500);
    } else {
      this.emit('close', info);
    }
  };

  _read() {};

  _write(chunk, encoding, callback) {
    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer.from(chunk, encoding);
    }
    this.bufHistory.pushBuffer(chunk);

    if (this.sendQueue.length || this.ws === null) {
      this.sendQueue.push(chunk);
      return this.flushSendQueue(callback);
    } else {
      return this.ws.sendBytes(chunk, callback);
    }
  };

  flushSendQueue(cb) {
    this.sendingCallbacks.push(cb);
    if (this.nowSending) return false;
    this.nowSending = true;
    const sender = (err) => {
        var buf, e, sendingCallbacks;
        if (err) {
          this.queueReconnect(err);
          this.nowSending = false;
          return;
        }
        if (this.ws === null) {
          // cannot send; deferred callbacks
          this.nowSending = false;
          return;
        }
        if (this.sendQueue.length === 0) {
          sendingCallbacks = this.sendingCallbacks;
          this.sendingCallbacks = [];
          while (sendingCallbacks.length > 0) {
            cb = sendingCallbacks.shift();
            if (typeof cb === 'function') {
              try {
                cb(err);
              } catch (error) {
                e = error;
                console.error(e);
              }
            }
          }
          this.nowSending = false;
          return true;
        }
        buf = this.sendQueue.shift();
        return this.ws.sendBytes(buf, sender);
      };
    return sender();
  };

  sendHandshake(ws) {
    return ws.sendUTF(JSON.stringify({
      version: 'v1',
      secret: (this.client || this.secretHandshaking) ? this.secret : null,
      seen: this.seenpos
    }));
  };

  handshake(ws, utf8Data) {
    var bufs, data, seen;
    data = JSON.parse(utf8Data);
    if (data.version === 'v1') {
      if (data.hasOwnProperty('seen')) {
        seen = data.seen;
        if (seen < this.bufHistory.head) {
          console.error("handshake error: couldn't resent data from that position", seen);
          ws.close(1012, "we can't remember that position");
          return false;
        }
        if (seen < this.bufHistory.tail) {
          bufs = this.bufHistory.sliceBuffers(seen, this.bufHistory.tail);
          this.sendQueue = bufs;
        }
      }
      if (!this.client && data.secret !== (this.secretHandshaking ? null : this.secret)) {
        console.error("handshake error: secret doesn't match"/*, data, this.secret*/);
        ws.close(1011, "credential not match");
        return false;
      }
      if (data.secret !== null && this.secret === null) {
        this.secret = data.secret;
        //console.error(`secret for this session: ${this.secret}`);
      }
      this.secretHandshaking = false;
      return true;
    } else {
      log("handshake error: bad protocol version: " + data.version + " on " + utf8Data);
      ws.close(1011, "unknown sub-handshake version");
      return false;
    }
  };

});