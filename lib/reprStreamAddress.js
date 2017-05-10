module.exports = function reprStreamAddress (stream) {
  if ('ws' in stream) {
    // StreamServing
    stream = stream.ws;
  }
  if ('socket' in stream) {
    // WebSocketConnection
    stream = stream.socket;
  }
  if (!('remoteAddress' in stream)) {
    return null;
  }
  return ['local', 'remote'].map((side) => {
      const address = stream[side + 'Address'];
      const port = stream[side + 'Port'];

      if (typeof address === 'undefined' && typeof port === 'undefined') {
        return null;
      }

      if (address && address.indexOf(':') !== -1) {
        return `[${address}]:${port}`;
      } else {
        return `${address}:${port}`;
      }
    }).filter((v) => v).join('->') + `(${stream.remoteFamily})`;
};