import { createServer } from 'node:http';

/** Serve `html` on 127.0.0.1 at a random port. */
export function startFixture(html) {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
  });
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
