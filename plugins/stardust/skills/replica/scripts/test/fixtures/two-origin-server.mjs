// skills/replica/scripts/test/fixtures/two-origin-server.mjs — the fixture of every site-auth test (replica and diff
// instruments, and the reskin deployed leg): two local origins in one process.
//
//   origin A  the protected site. Every request needs `Authorization: token t0k3n`; without it the answer is 401.
//             /page and /copy are one page whose stylesheet and image come from origin B.
//             /hop-b answers 302 to origin B's /page, /hop-a 302 to its own /page, /hop-ab 302 to its own /hop-b, /hop-pic
//             302 to origin B's /pic.png: a redirect off the origin (a page and an image), within it, and both in a row;
//             /loop 302 to itself.
//   origin B  the third party the page loads from (a font or image host, or the local reskin server). It never asks for
//             anything, serves /style.css, /pic.png and the same /page and /copy, and records every request together
//             with the Authorization it carried, if any — the proof that the token never left origin A.
//
//   import { startTwoOriginServer } from './fixtures/two-origin-server.mjs';
//   const fx = await startTwoOriginServer();           // or ({ hostA: 'protected.localhost' }) for a host the
//                                                      // instruments do not treat as local; Chromium resolves *.localhost
//   fx.originA, fx.originB                             // 'http://127.0.0.1:<port>' — the two origins
//   fx.token, fx.authorization                         // 't0k3n', 'token t0k3n'
//   fx.a.log, fx.b.log                                 // [{ path, authorization: string | null, status, accept: string | null }] in arrival order
//   fx.authorizations('B')                             // the Authorization values origin B saw (must stay [])
//   fx.reset()                                         // empty both logs
//   await fx.stop()
import { createServer } from 'node:http';

export const TOKEN = 't0k3n';
export const AUTHORIZATION = `token ${TOKEN}`;

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CSS = 'body{margin:0;font:16px/24px Arial,sans-serif;color:#222}header,footer{padding:16px 24px;background:#eef}main{max-width:900px;margin:0 auto;padding:24px}img{display:block;width:320px;height:160px;background:#ccd}';

const html = (originB) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Protected fixture</title><link rel="stylesheet" href="${originB}/style.css"></head><body><header><a href="/page">Home</a> <a href="/copy">Copy</a></header><main><h1>Protected fixture</h1><p>Served only to a request that carries the site token.</p><img src="${originB}/pic.png" alt="Fixture"><h2>Details</h2><p>A paragraph of body text under the second heading.</p></main><footer>Fixture footer</footer></body></html>`;

function listen(server) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
}

export async function startTwoOriginServer({ hostA = '127.0.0.1', hostB = '127.0.0.1' } = {}) {
  const a = { log: [] };
  const b = { log: [] };
  let originB = '';
  const serve = (side, protectedSide) => (req, res) => {
    const path = req.url.split('?')[0];
    const authorization = req.headers.authorization || null;
    const accept = req.headers.accept || null;
    const send = (status, type, body, headers = {}) => { side.log.push({ path, authorization, status, accept }); res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }); res.end(body); };
    if (protectedSide && authorization !== AUTHORIZATION) { send(401, 'text/html; charset=utf-8', '<!doctype html><title>401</title><h1>401 Unauthorized</h1>'); return; }
    if (protectedSide && path === '/hop-b') send(302, 'text/plain', '', { location: `${originB}/page` });
    else if (protectedSide && path === '/hop-a') send(302, 'text/plain', '', { location: '/page' });
    else if (protectedSide && path === '/hop-ab') send(302, 'text/plain', '', { location: '/hop-b' });
    else if (protectedSide && path === '/loop') send(302, 'text/plain', '', { location: '/loop' });
    else if (protectedSide && path === '/hop-pic') send(302, 'text/plain', '', { location: `${originB}/pic.png` });
    else if (path === '/page' || path === '/copy') send(200, 'text/html; charset=utf-8', html(originB));
    else if (!protectedSide && path === '/style.css') send(200, 'text/css', CSS);
    else if (!protectedSide && path === '/pic.png') send(200, 'image/png', PNG_1X1);
    else send(404, 'text/plain', 'not found');
  };
  const serverA = createServer(serve(a, true));
  const serverB = createServer(serve(b, false));
  const [portA, portB] = await Promise.all([listen(serverA), listen(serverB)]);
  const originA = `http://${hostA}:${portA}`;
  originB = `http://${hostB}:${portB}`;
  const sides = { A: a, B: b };
  return {
    token: TOKEN,
    authorization: AUTHORIZATION,
    originA,
    originB,
    a,
    b,
    authorizations: (which) => sides[which].log.map((r) => r.authorization).filter(Boolean),
    reset() { a.log.length = 0; b.log.length = 0; },
    async stop() {
      for (const s of [serverA, serverB]) { s.closeAllConnections(); s.close(); }
    },
  };
}
