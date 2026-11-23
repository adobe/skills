import { createServer } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';

/** Serve `html` on 127.0.0.1 at a random port. */
export function startFixture(html) {
  return listen(
    createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(html);
    }),
  );
}

/** Serve every `.html` file of the folder `dir` (a URL) at `/<name>`, 404 for anything else. */
export function startFixtureDir(dir) {
  const pages = Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.html'))
      .map((f) => [`/${f}`, readFileSync(new URL(f, dir), 'utf8')]),
  );
  return listen(
    createServer((req, res) => {
      const html = pages[new URL(req.url, 'http://x').pathname];
      res.statusCode = html === undefined ? 404 : 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(html ?? 'not found');
    }),
  );
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
