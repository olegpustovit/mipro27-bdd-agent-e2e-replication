import { createServer, request } from 'node:http';
import { connect } from 'node:net';

export function isPrivatePath(url) {
  try {
    return /^\/(?:testData|__study|__oracle|@fs|@vite)(?:\/|$)/i.test(decodeURIComponent(url.pathname));
  } catch {
    return true;
  }
}

// Playwright routing alone cannot enforce an origin on redirect hops. The
// local Chromium proxy applies the same origin restriction at the connection
// boundary, even when a redirect bypasses the Playwright request handler.
export async function openBrowserEgress(origin) {
  const app = new URL(origin);
  const sockets = new Set();
  function track(socket) {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  }
  const server = createServer((req, res) => {
    let url;
    try { url = new URL(req.url); } catch { return res.writeHead(403).end(); }
    if (url.origin !== origin || url.protocol !== 'http:' ||
        url.username || url.password || isPrivatePath(url)) return res.writeHead(403).end();
    const headers = { ...req.headers, host: app.host };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    const upstream = request(url, { method: req.method, headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    });
    upstream.on('error', () => res.destroy());
    res.once('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('connection', track);
  server.on('connect', (req, client, head) => {
    const port = Number(app.port || 443);
    if (app.protocol !== 'https:' || req.url !== `${app.hostname}:${port}`) {
      return client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
    const upstream = connect({ host: app.hostname.replace(/^\[|\]$/g, ''), port });
    track(upstream);
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    client.once('close', () => upstream.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    config: { server: `http://127.0.0.1:${server.address().port}`, bypass: '<-loopback>' },
    async close() {
      const closed = new Promise(resolve => server.close(resolve));
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}
