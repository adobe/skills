// skills/reskin/scripts/test/fixtures/deployed/servers.mjs — the fake EDS preview and the fake live source
// every deployed-leg test reads (Tasks 1–12), with the fixtures beside it. node:http on 127.0.0.1, port 0.
//
//   startPreviewServer({ token, decorateDelayMs, stallBlock, pages }) → { origin, close, requests }
//     Serves each `pages` entry (path → fixture file name, or absolute path; default { '/ns/home': 'home.html' })
//     at <path> and its authored form at <path>.plain.html (the sibling *.plain.html, or a body built from the
//     page's <main> when there is none), and any /…/media_<hex>.png as a PNG. Every page it serves gets an
//     inline decorate script that, decorateDelayMs after parse, adds body.appear and 100 ms later sets every
//     data-section-status / data-block-status to "loaded", except the block named stallBlock. `__ORIGIN__` in
//     a page is the server's own origin. With a token, any request without `Authorization: token <token>`
//     is a 401. `requests` records { method, path, headers } of every request, answered or not.
//   startSourceServer() → { origin, close, requests }
//     source.html at "/" and its image at /images/hero.png: the live source content-model.json captured.
//   loadSourceModel(origin) → content-model.json with _provenance.url set to `${origin}/`.
//   fixturePath(name), solidPng(w, h, [r, g, b]).
//
// What the fixtures contain, so the gates' tests can rely on it. home.html (the delivered preview page, served
// at /ns/home) and source.html carry the same copy in the same order: h1 "Welcome to the kit", the lead, the
// buttons "Get started" and "Learn more", one image (alt "A calm board of three planned tasks"), h2 "Everything
// in one place", two feature texts, a "New" label and a "Try it" link. Declared in deltas.json, and the only
// differences between the two pages' <main> text, links, images and head:
//   T1 text      the second feature: the source shows a literal "&amp;" (its markup double-escapes the
//                ampersand), the preview renders "&" after the round trip through authoring.
//   links        "Get started" and "Learn more" point at the source host (https://src.test/start, /about/) in
//                the source and are localized (/start, /about/) on the preview. "Try it" points at
//                https://example.test/try on both: a link localize-links keeps absolute.
//   images       the source image is /images/hero.png on the source server (the model records it at
//                https://src.test/images/hero.png); the preview rehosts it as ./media_<hash>.png, same alt, 320 wide.
//   metadata     canonical, og:url, og:image and twitter:image are on https://src.test in the source and on the
//                preview origin on the preview; the JSON-LD block (one) differs in its url only.
// So, without --deltas, slot-coverage of content-model.json against /ns/home fails on: s02 text present, the
// "Get started" and "Learn more" CTAs, the s01 image URL, canonical, og:url, og:image and twitter:image; every
// other check passes (s01 text, the "Try it" CTA, title, description, og:title, og:description, og:type,
// twitter:card, twitter:title, the JSON-LD count). dom-equality of the source server's "/" against /ns/home fails
// on the visible text (T1) and on the ordered image src. deltas.json declares every one of these differences.
// home.html's <main> has three top-level div.section: [0] empty (the phantom first section), [1] s01 as default
// content, [2] s02 as the cards block, whose single .cards > div is the 560×240 card; no element has class
// "card". Its block CSS (display: grid) applies only once data-block-status is "loaded", as in EDS.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGGER_MS = 100;
const MEDIA = /(^|\/)media_[0-9a-f]+\.png$/;
const HERO = [320, 180, [198, 214, 232]];

export const fixturePath = (name) => (isAbsolute(name) ? name : join(HERE, name));

export function loadSourceModel(origin) {
  const model = JSON.parse(readFileSync(fixturePath('content-model.json'), 'utf8'));
  model._provenance.url = `${origin}/`;
  return model;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => (buf.reduce((c, b) => CRC[(c ^ b) & 0xff] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
const chunk = (type, data) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
};

// A w×h single-colour PNG (8-bit RGB), enough for an <img> that loads and has a size.
export function solidPng(w, h, [r, g, b]) {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x += 1) row.set([r, g, b], 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function listen(handle) {
  const requests = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    requests.push({ method: req.method, path, headers: { ...req.headers } });
    handle(req, res, path);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  return { origin, requests, close };
}

const send = (res, status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const html = (res, body) => send(res, 200, 'text/html; charset=utf-8', body);
const notFound = (res) => send(res, 404, 'text/plain; charset=utf-8', 'not found');

const decorateScript = (delayMs, stallBlock) => `<script>
setTimeout(function () {
  document.body.classList.add('appear');
  setTimeout(function () {
    document.querySelectorAll('[data-section-status]').forEach(function (el) { el.setAttribute('data-section-status', 'loaded'); });
    document.querySelectorAll('[data-block-status]').forEach(function (el) {
      if (el.getAttribute('data-block-name') !== ${JSON.stringify(stallBlock)}) el.setAttribute('data-block-status', 'loaded');
    });
  }, ${STAGGER_MS});
}, ${delayMs});
</script>`;

const withDecorate = (page, script) => (/<\/body>/i.test(page) ? page.replace(/<\/body>/i, () => `${script}\n</body>`) : `${page}\n${script}`);

// The authored form of a page without a sibling *.plain.html: its <main> in the body EDS delivers.
const derivePlain = (page) => {
  const main = page.match(/<main[^>]*>([\s\S]*)<\/main>/i);
  return main ? `<body>\n<header></header>\n<main>${main[1]}</main>\n<footer></footer>\n</body>\n` : null;
};

export async function startPreviewServer({ token = null, decorateDelayMs = 200, stallBlock = null, pages = { '/ns/home': 'home.html' } } = {}) {
  const served = new Map();
  for (const [path, file] of Object.entries(pages)) {
    served.set(path, { file: fixturePath(file), plain: false });
    served.set(`${path}.plain.html`, { file: fixturePath(file), plain: true });
  }
  const server = await listen((req, res, path) => {
    if (token && req.headers.authorization !== `token ${token}`) return send(res, 401, 'text/plain; charset=utf-8', 'unauthorized');
    if (MEDIA.test(path)) return send(res, 200, 'image/png', solidPng(...HERO));
    const entry = served.get(path);
    if (!entry || !existsSync(entry.file)) return notFound(res);
    const page = readFileSync(entry.file, 'utf8');
    if (!entry.plain) return html(res, withDecorate(page, decorateScript(decorateDelayMs, stallBlock)).replaceAll('__ORIGIN__', server.origin));
    const sibling = entry.file.replace(/\.html$/, '.plain.html');
    const plain = existsSync(sibling) ? readFileSync(sibling, 'utf8') : derivePlain(page);
    return plain === null ? notFound(res) : html(res, plain);
  });
  return server;
}

export async function startSourceServer() {
  return listen((req, res, path) => {
    if (path === '/') return html(res, readFileSync(fixturePath('source.html'), 'utf8'));
    if (path === '/images/hero.png') return send(res, 200, 'image/png', solidPng(...HERO));
    return notFound(res);
  });
}
