import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function readRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startFixture() {
  const hits = new Map();
  const contactHtml = await readFile(join(here, 'fixtures/site/contact.html'), 'utf8');
  const rebuiltHtml = await readFile(join(here, 'fixtures/site/rebuilt.html'), 'utf8');
  const popupHtml = `<!doctype html><title>Popup</title><script>
    fetch('/api/popup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'popup@example.com' })
    }).catch(() => {});
  </script>`;

  const noCorsServer = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture-no-cors.local');
    const key = `${req.method} ${url.pathname}`;
    hits.set(`no-cors ${key}`, (hits.get(`no-cors ${key}`) || 0) + 1);
    if (req.method === 'POST' && url.pathname === '/api/form/contact-form') {
      await readRequest(req);
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: 'firstName must be at least 2 characters' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture.local');
    const key = `${req.method} ${url.pathname}`;
    hits.set(key, (hits.get(key) || 0) + 1);

    if (req.method === 'GET' && url.pathname === '/popup.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(popupHtml);
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/rebuilt.html' || url.pathname === '/rebuilt-fname.html' || url.pathname === '/rebuilt-track-load.html' || url.pathname === '/rebuilt-load-write.html' || url.pathname === '/rebuilt-read.html' || url.pathname === '/rebuilt-recaptcha-error.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(rebuiltHtml);
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/contact')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(contactHtml);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/list') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify({ message: 'Loaded list', items: [{ id: 1, name: 'One', email: 'person@example.com', phone: '4155550199', token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN' }] }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/track-load') {
      await readRequest(req);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/form/contact-form') {
      const body = await readRequest(req);
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { parsed = {}; }
      const valid = String(parsed.formData?.firstName || '').length >= 2 && /@/.test(String(parsed.formData?.email || ''));
      res.writeHead(valid ? 200 : 400, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify(valid
        ? { success: true, message: 'Thanks from fixture' }
        : { success: false, message: 'firstName must be at least 2 characters' }));
      return;
    }

    if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/graphql') {
      if (req.method === 'POST') await readRequest(req);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ data: { viewer: { id: 'viewer-1', hutk: 'abc123' }, saveLead: { ok: true } } }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/beacon') {
      await readRequest(req);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/popup') {
      await readRequest(req);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/upload') {
      await readRequest(req);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/legacy') {
      await readRequest(req);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<p>legacy accepted</p>');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/group') {
      await readRequest(req);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => {
    noCorsServer.once('error', reject);
    noCorsServer.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  const { port: noCorsPort } = noCorsServer.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    noCorsOrigin: `http://127.0.0.1:${noCorsPort}`,
    hits,
    close: () => Promise.all([
      new Promise((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
      new Promise((resolve, reject) => {
        noCorsServer.closeAllConnections?.();
        noCorsServer.close((error) => (error ? reject(error) : resolve()));
      }),
    ]),
  };
}
