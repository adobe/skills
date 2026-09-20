// Shared helper for the replica scripts' browser-dependent runners (evals/lint/*-smoke.mjs).
//
// The plugin repo carries no Playwright devDependency, so every test that
// needs Chromium self-skips (prints one SKIP line, exits 0) unless a
// Playwright install is reachable: `STARDUST_PW_ROOT=<dir with node_modules>`
// or the cwd itself (run the runner from an EDS project — same rule as
// qa/scripts/test/browser-unmeasured.test.mjs). The pure halves of every
// script are asserted regardless.
//
// ESM resolves `import 'playwright'` from the IMPORTING FILE's directory, so
// a script run from the plugin tree never sees a project's node_modules.
// stageProjectCopy() reproduces the documented project layout
// (replica SKILL.md § Setup step 4: stardust/scripts/replica + stardust/
// scripts/diff) in a temp dir whose `node_modules` is a symlink to the
// Playwright root's (Node resolves through it), and returns the staged paths;
// the caller removes the directory when done. Nothing is written into the
// Playwright root itself.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const SCRIPTS = resolve(import.meta.dirname, '..', '..', '..', 'skills', 'replica', 'scripts');
const DIFF_SCRIPTS = resolve(SCRIPTS, '..', '..', 'diff', 'scripts');

/** Directory whose node_modules resolves playwright, or null. */
export function pwRoot() {
  for (const dir of [process.env.STARDUST_PW_ROOT, process.cwd()].filter(Boolean)) {
    if (existsSync(join(dir, 'node_modules', 'playwright', 'package.json'))) return resolve(dir);
  }
  return null;
}

/** Print the SKIP line and exit 0 — the caller's pure cases must run BEFORE this. */
export function skipBrowser(name) {
  console.log(`SKIP ${name}: playwright is not resolvable (set STARDUST_PW_ROOT=<project dir> or run from the EDS project) — browser cases not exercised, pure cases passed`);
  process.exit(0);
}

/**
 * Copy replica scripts (+ live-session.mjs) into `<tmp>/stardust/scripts/{replica,diff}`
 * with `<tmp>/node_modules` → `<root>/node_modules`. Returns { dir, replica, diff, script(name), cleanup }.
 */
export function stageProjectCopy(root, files) {
  const dir = mkdtempSync(join(tmpdir(), 'stardust-replica-test-'));
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
  const replica = join(dir, 'stardust', 'scripts', 'replica');
  const diff = join(dir, 'stardust', 'scripts', 'diff');
  mkdirSync(replica, { recursive: true }); mkdirSync(diff, { recursive: true });
  for (const f of files) cpSync(join(SCRIPTS, f), join(replica, f));
  cpSync(join(DIFF_SCRIPTS, 'live-session.mjs'), join(diff, 'live-session.mjs'));
  return { dir, replica, diff, script: (name) => join(replica, name), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

/** Static server on port 0 over `dir`; resolves { url, close }. */
export function serveDir(dir) {
  return new Promise((res) => {
    const srv = createServer(async (req, rsp) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const file = join(dir, path.endsWith('/') ? `${path}index.html` : path);
      try {
        const body = await readFile(file);
        rsp.writeHead(200, { 'content-type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream', 'cache-control': 'no-store' });
        rsp.end(body);
      } catch { rsp.writeHead(404); rsp.end('not found'); }
    });
    srv.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) }));
  });
}
