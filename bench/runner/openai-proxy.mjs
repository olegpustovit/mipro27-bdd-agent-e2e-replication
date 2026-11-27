import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import { BlockList, connect } from 'node:net';

const [local, agent] = process.argv.slice(2);
const allowed = new Set(['chatgpt.com:443', 'auth.openai.com:443', 'api.openai.com:443']);
const privateIPs = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 3],
]) privateIPs.addSubnet(network, prefix);

const deny = (socket, status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
const server = createServer({ requestTimeout: 5000, headersTimeout: 5000 }, (_, reply) => {
  reply.writeHead(403, { Connection: 'close' }).end();
});

server.on('connect', async (request, client, head) => {
  client.on('error', () => client.destroy());
  if (client.remoteAddress !== agent || !allowed.has(request.url)) {
    return deny(client, '403 Forbidden');
  }
  let upstream;
  try {
    const addresses = await lookup(request.url.split(':')[0], { family: 4, all: true });
    const publicIPs = addresses.filter(({ address }) => !privateIPs.check(address));
    if (!publicIPs.length || client.destroyed) return deny(client, '502 Bad Gateway');
    const hosts = publicIPs.map(({ address }) => address);
    upstream = connect({
      host: request.url.split(':')[0], port: 443, family: 4,
      lookup: (_, __, callback) => callback(null, hosts[0], 4),
      timeout: 5000,
    });
    upstream.once('timeout', () => upstream.destroy());
    upstream.once('error', () => {
      if (!client.destroyed) deny(client, '502 Bad Gateway');
    });
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
    upstream.once('connect', () => {
      upstream.setTimeout(0);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
  } catch {
    upstream?.destroy();
    deny(client, '502 Bad Gateway');
  }
});
server.listen(3128, local);
