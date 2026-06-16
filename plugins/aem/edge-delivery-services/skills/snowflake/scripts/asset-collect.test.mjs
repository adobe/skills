import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'asset-collect.mjs');

// ---------------------------------------------------------------------------
// Local HTTP server — serves files from a configurable root
// ---------------------------------------------------------------------------

let serverRoot = '';
let serverPort = 0;
let server;

before(async () => {
  server = createServer((req, res) => {
    const fp = join(serverRoot, decodeURIComponent(req.url.split('?')[0]));
    try {
      const data = readFileSync(fp);
      res.writeHead(200);
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverPort = server.address().port;
});

after(() => server?.close());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-test-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), typeof content === 'string' ? content : content);
  }
  return dir;
}

// Use async execFile so the HTTP server's event loop stays unblocked
// while the subprocess does fetch() calls back to it.
async function run(inputDir, baseUrl, extra = []) {
  try {
    const { stdout } = await execFileAsync(
      'node', [SCRIPT, '--input', inputDir, '--base-url', baseUrl, ...extra],
      { encoding: 'utf8' },
    );
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'asset-manifest.json'), 'utf8'));
}

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const TINY_WOFF2 = Buffer.from('d09GMgABAAAAAAA', 'base64');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('missing --input exits with code 1', () => {
  try {
    execFileSync('node', [SCRIPT, '--base-url', 'http://example.com'], { encoding: 'utf8' });
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.status, 1);
    assert.match(e.stderr, /--input is required/);
  }
});

test('missing --base-url exits with code 1', () => {
  try {
    execFileSync('node', [SCRIPT, '--input', '/tmp'], { encoding: 'utf8' });
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.status, 1);
    assert.match(e.stderr, /--base-url is required/);
  }
});

test('missing index.html exits with code 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-test-'));
  try {
    const r = await run(dir, 'http://localhost/');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /index\.html not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('img src — discovers and downloads local image', async () => {
  const dir = makeInput({
    'index.html': `<html><body><img src="hero.png" alt=""></body></html>`,
    'hero.png': TINY_PNG,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    const m = readManifest(dir);
    assert.equal(m.stats.total, 1);
    assert.equal(m.assets[0].type, 'image');
    assert.equal(m.assets[0].strategy, 'da-media');
    assert.equal(m.assets[0].normalizedPath, 'images/hero.png');
    assert.ok(existsSync(join(dir, 'images/hero.png')));
    assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /images\/hero\.png/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('img srcset — discovers both descriptors', async () => {
  const dir = makeInput({
    'index.html': `<html><body>
      <img srcset="thumb-400.webp 400w, thumb-800.webp 800w" src="thumb.webp">
    </body></html>`,
    'thumb.webp': TINY_PNG,
    'thumb-400.webp': TINY_PNG,
    'thumb-800.webp': TINY_PNG,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    const m = readManifest(dir);
    const paths = m.assets.map((a) => a.normalizedPath);
    assert.ok(paths.some((p) => p?.includes('thumb-400')));
    assert.ok(paths.some((p) => p?.includes('thumb-800')));
    assert.ok(paths.some((p) => p?.includes('thumb.webp') || p?.endsWith('thumb.webp')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('video source src and poster — both discovered', async () => {
  const dir = makeInput({
    'index.html': `<html><body>
      <video poster="preview.jpg">
        <source src="clip.mp4">
      </video>
    </body></html>`,
    'preview.jpg': TINY_PNG,
    'clip.mp4': Buffer.from('ftyp'),
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    const m = readManifest(dir);
    const types = m.assets.map((a) => a.type);
    assert.ok(types.includes('image'), 'poster not found');
    assert.ok(types.includes('video'), 'video source not found');
    assert.ok(existsSync(join(dir, 'images/preview.jpg')));
    assert.ok(existsSync(join(dir, 'videos/clip.mp4')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inline style background-image url() — discovered', async () => {
  const dir = makeInput({
    'index.html': `<html><body>
      <div style="background-image: url('bg.jpg')"></div>
    </body></html>`,
    'bg.jpg': TINY_PNG,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    const m = readManifest(dir);
    assert.ok(m.assets.some((a) => a.type === 'image'));
    assert.ok(existsSync(join(dir, 'images/bg.jpg')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('@font-face url() in style block — discovered and vendored', async () => {
  const dir = makeInput({
    'index.html': `<html><head>
      <style>
        @font-face {
          font-family: "My Font";
          src: url("font.woff2") format("woff2");
          font-weight: 400;
          font-style: normal;
        }
      </style>
    </head><body></body></html>`,
    'font.woff2': TINY_WOFF2,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    const m = readManifest(dir);
    assert.equal(m.stats.total, 1);
    assert.equal(m.assets[0].type, 'font');
    assert.equal(m.assets[0].strategy, 'vendor');
    assert.ok(existsSync(join(dir, 'fonts/font.woff2')));
    assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /fonts\/font\.woff2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hash-named font gets semantic name from @font-face context — italic variant', async () => {
  const dir = makeInput({
    'index.html': `<html><head>
      <style>
        @font-face {
          font-family: "Adobe Clean";
          src: url("abcdef1234567890.woff2") format("woff2");
          font-style: italic;
        }
      </style>
    </head><body></body></html>`,
    'abcdef1234567890.woff2': TINY_WOFF2,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    const m = readManifest(dir);
    assert.ok(existsSync(join(dir, 'fonts/adobe-clean-italic.woff2')), 'expected adobe-clean-italic.woff2');
    assert.equal(m.assets[0].normalizedPath, 'fonts/adobe-clean-italic.woff2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stable CDN assets are left as absolute — no download', async () => {
  const dir = makeInput({
    'index.html': `<html><head>
      <style>
        @font-face {
          font-family: "Google Font";
          src: url("https://fonts.gstatic.com/s/roboto/v30/abc123.woff2") format("woff2");
        }
      </style>
    </head><body>
      <img src="https://cdn.jsdelivr.net/npm/some-pkg/img.png">
    </body></html>`,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    const m = readManifest(dir);
    // img.png is SVG via cdn.jsdelivr... but it's a .png so it's in scope
    // Both should be absolute (stable-cdn)
    for (const a of m.assets) {
      assert.equal(a.strategy, 'absolute', `Expected absolute for ${a.originalUrl}`);
      assert.equal(a.normalizedPath, null);
    }
    assert.ok(!existsSync(join(dir, 'fonts')), 'no fonts dir should be created');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cross-origin font warning generated for reachable non-CDN font', async () => {
  const dir = makeInput({
    'index.html': `<html><head>
      <style>
        @font-face {
          font-family: "Remote Font";
          src: url("https://other-domain.com/fonts/myfont.woff2") format("woff2");
        }
      </style>
    </head><body></body></html>`,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    const m = readManifest(dir);
    assert.ok(
      m.warnings.some((w) => w.includes('cross-origin')),
      `Expected cross-origin warning, got: ${JSON.stringify(m.warnings)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filename collision — second asset gets -2 suffix', async () => {
  const dir = makeInput({
    'index.html': `<html><body>
      <img src="dir-a/hero.jpg">
      <img src="dir-b/hero.jpg">
    </body></html>`,
    'dir-a/hero.jpg': TINY_PNG,
    'dir-b/hero.jpg': TINY_PNG,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(dir, 'images/hero.jpg')));
    assert.ok(existsSync(join(dir, 'images/hero-2.jpg')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('idempotent re-run — second call is a no-op', async () => {
  const dir = makeInput({
    'index.html': `<html><body><img src="photo.gif"></body></html>`,
    'photo.gif': TINY_PNG,
  });
  serverRoot = dir;
  try {
    const r1 = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r1.code, 0, r1.stderr);
    const htmlAfter1 = readFileSync(join(dir, 'index.html'), 'utf8');
    const manifestAfter1 = readFileSync(join(dir, 'asset-manifest.json'), 'utf8');

    const r2 = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r2.code, 0, r2.stderr);
    assert.match(r2.stdout, /already collected/);
    assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), htmlAfter1, 'index.html changed on second run');
    assert.equal(readFileSync(join(dir, 'asset-manifest.json'), 'utf8'), manifestAfter1, 'manifest changed on second run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--dry-run — no files written, manifest on stdout', async () => {
  const dir = makeInput({
    'index.html': `<html><body><img src="photo.png"></body></html>`,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`, ['--dry-run']);
    assert.equal(r.code, 0, r.stderr);
    // stdout contains log line + JSON — find the JSON block
    const jsonStart = r.stdout.indexOf('{');
    const manifest = JSON.parse(r.stdout.slice(jsonStart));
    assert.ok(manifest.assets, 'no assets in dry-run output');
    assert.ok(!existsSync(join(dir, 'asset-manifest.json')), 'manifest written in dry-run');
    assert.ok(!existsSync(join(dir, 'images')), 'images dir created in dry-run');
    assert.doesNotMatch(
      readFileSync(join(dir, 'index.html'), 'utf8'),
      /images\//,
      'index.html rewritten in dry-run',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SVGs are ignored (out of scope)', async () => {
  const dir = makeInput({
    'index.html': `<html><body>
      <img src="icon.svg" alt="">
      <img src="photo.png" alt="">
    </body></html>`,
    'icon.svg': '<svg></svg>',
    'photo.png': TINY_PNG,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    const m = readManifest(dir);
    assert.equal(m.stats.total, 1, 'SVG should not be counted');
    assert.equal(m.assets[0].normalizedPath, 'images/photo.png');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('all three CSS url() quote forms handled', async () => {
  const dir = makeInput({
    'index.html': `<html><head>
      <style>
        .a { background-image: url(unquoted.gif); }
        .b { background-image: url('single.gif'); }
        .c { background-image: url("double.gif"); }
      </style>
    </head><body></body></html>`,
    'unquoted.gif': TINY_PNG,
    'single.gif': TINY_PNG,
    'double.gif': TINY_PNG,
  });
  serverRoot = dir;
  try {
    const r = await run(dir, `http://127.0.0.1:${serverPort}/index.html`);
    assert.equal(r.code, 0, r.stderr);
    const m = readManifest(dir);
    assert.equal(m.stats.total, 3, `Expected 3 assets, got ${m.stats.total}`);
    assert.ok(existsSync(join(dir, 'images/unquoted.gif')));
    assert.ok(existsSync(join(dir, 'images/single.gif')));
    assert.ok(existsSync(join(dir, 'images/double.gif')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
