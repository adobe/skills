// skills/reskin/scripts/deployed/serve.mjs — the local reskin page over http, for the deployed steps whose instruments
// refuse file:// (`parity`'s stitch-shot and cap-probe, `sanity`'s content-presence). A library, no CLI.
//   serveReskinPage(file)  a static server on 127.0.0.1:0 for the page's own directory, so relative assets resolve
//                          → { url, close }. Nothing outside the directory is served: `..%2f` is a 404.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
};

export async function serveReskinPage(file) {
  const root = dirname(resolve(file));
  const server = createServer((req, res) => {
    let target = null;
    try { target = resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://x').pathname)}`); } catch { /* an undecodable path is a 404 */ }
    if (!target || !(target === root || target.startsWith(root + sep)) || !existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(target).on('error', () => res.destroy()).pipe(res);
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return {
    url: `http://127.0.0.1:${server.address().port}/${encodeURIComponent(basename(file))}`,
    close: () => new Promise((done) => { server.close(done); server.closeAllConnections(); }),
  };
}
