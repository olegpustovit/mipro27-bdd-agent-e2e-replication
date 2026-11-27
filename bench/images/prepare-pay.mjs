// Adapt the fixture to a single browser origin on the private worker network.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

for (const file of readdirSync('src/machines')) {
  if (!file.endsWith('.ts')) continue;
  const path = join('src/machines', file);
  const source = readFileSync(path, 'utf8');
  const rewritten = source.replaceAll('http://localhost:${backendPort}/', '/api/');
  if (rewritten !== source) writeFileSync(path, rewritten);
}

const configPath = 'vite.config.ts';
const config = readFileSync(configPath, 'utf8');
if (!config.includes('sourcemap: true')) throw new Error('Unexpected payment Vite configuration');
writeFileSync(configPath, config
  .replace('sourcemap: true', 'sourcemap: false')
  .replace(/^import istanbul from .*;\n/m, '')
  .replace(/      istanbul\(\{[\s\S]*?^      \}\),\n/m, ''));

const path = 'backend/app.ts';
const source = readFileSync(path, 'utf8');
const listener = '  app.listen(port);';
if (!source.includes(listener)) throw new Error('Unexpected payment backend listener');
writeFileSync(path, source.replace(listener, `  app.listen(Number(port), "127.0.0.1");
  const web = express();
  web.get("/health", (_req, res) => {
    res.send(require("fs").existsSync(join(__dirname, "../build/index.html")) ? "ready" : "missing frontend");
  });
  // Expose only application routes to the browser. The fixture API on
  // port 3001 is available through docker exec for trusted setup code.
  web.use("/api", (req, res, next) => {
    if (!/^\\/(?:login|logout|checkAuth|users|contacts|bankAccounts|transactions|likes|comments|notifications|bankTransfers|graphql)(?:\\/|$)/i.test(req.path)) {
      return res.sendStatus(404);
    }
    return next();
  }, app);
  web.use(express.static(join(__dirname, "../build")));
  web.get("*", (_req, res) => res.sendFile(join(__dirname, "../build/index.html")));
  web.listen(3000, "0.0.0.0");`));
