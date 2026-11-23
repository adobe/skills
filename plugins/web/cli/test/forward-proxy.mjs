import { Agent, createServer, request } from 'node:http';
import { connect } from 'node:net';

/**
 * A forward proxy on 127.0.0.1 for tests: CONNECT tunnels and absolute-form requests (Node
 * sends either for an http:// target, depending on the version). `seen` lists each request it
 * forwarded; with `auth` (`user:pass`) any other Proxy-Authorization gets 407.
 * @param {{ auth?: string }} [options]
 */
export async function startForwardProxy({ auth } = {}) {
  // Its own agent: the proxy runs in the test's process, whose global agent may be proxied.
  const direct = new Agent();
  const expected = auth && `Basic ${Buffer.from(auth).toString('base64')}`;
  const allowed = (req) => !expected || req.headers['proxy-authorization'] === expected;
  const seen = [];
  const sockets = new Set();
  const track = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  };
  const server = createServer((req, res) => {
    if (!allowed(req)) return res.writeHead(407).end();
    seen.push(req.url);
    const options = { method: req.method, headers: req.headers, agent: direct };
    const upstream = request(req.url, options, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  server.on('connection', track);
  server.on('connect', (req, socket, head) => {
    if (!allowed(req)) return socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
    seen.push(req.url);
    const { hostname, port } = new URL(`http://${req.url}`);
    const upstream = connect(Number(port), hostname, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  return {
    url: `http://${auth ? `${auth}@` : ''}127.0.0.1:${port}`,
    port,
    seen,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
      direct.destroy();
    },
  };
}
