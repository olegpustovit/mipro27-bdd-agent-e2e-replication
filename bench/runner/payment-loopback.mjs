import { connect, createServer } from 'node:net';

// The coded observer uses Web Crypto in the payment page. Give it the
// same trusted localhost origin as the standalone fixture.
createServer(client => {
  const app = connect(3000, process.argv[2]);
  client.on('error', () => app.destroy());
  app.on('error', () => client.destroy());
  client.on('close', () => app.destroy());
  app.on('close', () => client.destroy());
  client.pipe(app).pipe(client);
}).listen(3000, '127.0.0.1');
