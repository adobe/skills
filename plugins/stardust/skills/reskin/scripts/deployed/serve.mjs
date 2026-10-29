// skills/reskin/scripts/deployed/serve.mjs — the local reskin page over http, for the deployed steps whose instruments
// refuse file:// (`parity`'s stitch-shot and cap-probe, `sanity`'s content-presence). A library, no CLI.
//   serveReskinPage(file, { root })  a static server on 127.0.0.1:0 → { url, close }. When the page sits under root
//                          (the project root, the parent of --dir) the server serves root and the url is the page's
//                          path under it, so root-relative (/fonts/x.woff2) and ../ assets resolve as they do on the
//                          site; otherwise (no root, or a page outside it) it serves the page's own directory. Nothing
//                          outside the served directory is read (`..%2f` is a 404), nor, outside the page's own directory,
//                          any dot-segment (.git, .env).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, relative, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8',
};

const inside = (dir, path) => path === dir || path.startsWith(dir + sep);

export async function serveReskinPage(file, { root: projectRoot = null } = {}) {
  const page = resolve(file);
  const root = projectRoot && inside(resolve(projectRoot), page) ? resolve(projectRoot) : dirname(page);
  const server = createServer((req, res) => {
    let target = null;
    try { target = resolve(root, `.${decodeURIComponent(new URL(req.url, 'http://x').pathname)}`); } catch { /* an undecodable path is a 404 */ }
    const dotted = target && !inside(dirname(page), target) && relative(root, target).split(sep).some((s) => s.startsWith('.'));
    if (!target || !inside(root, target) || dotted || !existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(target).on('error', () => res.destroy()).pipe(res);
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return {
    url: `http://127.0.0.1:${server.address().port}/${relative(root, page).split(sep).map(encodeURIComponent).join('/')}`,
    close: () => new Promise((done) => { server.close(done); server.closeAllConnections(); }),
  };
}
