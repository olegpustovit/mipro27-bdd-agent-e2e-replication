import { request } from 'node:http';

export function dockerEngine(endpoint) {
  if (!endpoint.startsWith('unix://')) return null;
  const socketPath = endpoint.slice('unix://'.length);

  async function call(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request({
        socketPath, method, path, signal: AbortSignal.timeout(60_000),
        headers: payload === undefined ? undefined : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          if (res.statusCode >= 400) {
            reject(new Error(`Docker ${method} ${path} returned ${res.statusCode}: ${data.toString()}`));
          } else {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  const json = async (method, path, body) => JSON.parse(await call(method, path, body));
  return {
    image: async ref => (await json('GET', `/images/${encodeURIComponent(ref)}/json`)).Id,
    create: async image => (await json('POST', '/containers/create', {
      Image: image,
      Labels: { 'org.mipro27.pretask': 'P2a' },
      HostConfig: { Init: true, NetworkMode: 'none', ShmSize: 256 * 1024 * 1024 },
    })).Id,
    state: async id => (await json('GET', `/containers/${id}/json`)).State,
    start: id => call('POST', `/containers/${id}/start`),
    remove: id => call('DELETE', `/containers/${id}?force=1&v=1`),
  };
}
