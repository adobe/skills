#!/usr/bin/env node
// Serves ./fixtures on http://localhost:8765 so suites can use controlled pages next to real sites.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const types = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

createServer((req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}).listen(8765, '127.0.0.1', () => console.error('fixtures on http://localhost:8765'));
