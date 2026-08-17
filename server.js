import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { match } from './src/api/index.js';
import { HttpError, readBody, sendJson, sendText, serveStatic } from './src/http.js';
import { readSettings, ROOT, DB_PATH } from './src/db.js';

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
// Overridable so the Pages demo build in dist/ can be served for testing.
// resolve() normalises separators, which the static-file guard compares against.
const PUBLIC_DIR = resolve(process.env.POS_PUBLIC_DIR || join(ROOT, 'public'));

// Anything that changes data needs the PIN header, when a PIN is set in Setup.
const PIN_EXEMPT = new Set(['/api/unlock']);

function pinGuard(req, url) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (PIN_EXEMPT.has(url.pathname)) return;
  const pin = readSettings().app_pin;
  if (!pin) return;
  if (req.headers['x-pos-pin'] !== pin) throw new HttpError(401, 'Locked — enter the salon PIN');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      pinGuard(req, url);
      const route = match(req.method, url.pathname);
      if (!route) throw new HttpError(404, `No API route for ${url.pathname}`);

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const result = await route.handler({
        req,
        res,
        params: route.params,
        query: url.searchParams,
        body,
      });
      if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
      return;
    }

    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (await serveStatic(res, PUBLIC_DIR, path)) return;

    // Unknown path: hand back the app shell so deep links still work.
    if (!url.pathname.includes('.')) {
      if (await serveStatic(res, PUBLIC_DIR, '/index.html')) return;
    }
    sendText(res, 404, 'Not found');
  } catch (err) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`[${req.method} ${url.pathname}]`, err);
    sendJson(res, status, { error: err.message || 'Something went wrong' });
  }
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  const shop = readSettings().shop_name;
  const lines = [
    '',
    `  ${shop} — Point of Sale`,
    `  ${'─'.repeat(Math.max(24, shop.length + 16))}`,
    `  On this computer   http://localhost:${PORT}`,
  ];
  for (const ip of lanAddresses()) {
    lines.push(`  On phones/tablets  http://${ip}:${PORT}`);
  }
  lines.push(`  Database           ${DB_PATH}`, '  Press Ctrl+C to stop.', '');
  console.log(lines.join('\n'));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Either close the other program, or start with a different port:\n`);
    console.error(`      set PORT=8880 && npm start\n`);
    process.exit(1);
  }
  throw err;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
