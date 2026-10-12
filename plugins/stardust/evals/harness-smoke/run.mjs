#!/usr/bin/env node
// evals/harness-smoke/run.mjs — per-harness conformance smoke for stardust (plan:
// notes/harness-support-plan.md § Definition of supported). Answers, per harness and release: does
// an authenticated session load stardust and impeccable, run Setup, run the scripts with Playwright
// against a local site, read a screenshot, and stop at a gate when nobody is there to answer?
//
//   node evals/harness-smoke/run.mjs --harness <id> [--checks a,b] [--golden a] [--plugin-dir <dir>]
//        [--impeccable-repo <dir>] [--timeout <minutes>] [--keep]
//
// <id>: claude | copilot | grok | opencode | cursor | codex | antigravity | pi (harnesses.mjs).
// --plugin-dir       stardust plugin root under test (default: this checkout)
// --impeccable-repo  a pbakaus/impeccable checkout, for loose-layout harnesses (default: ../impeccable
//                    beside this repository)
// --golden a         also run golden path A (extract → direct → prototype → diff, hands-off; slow)
// --timeout          minutes per prompt (default 20; golden A gets 3×)
// --keep             keep the workspaces (default: removed when every check passed)
// Env: SMOKE_MODEL (passed as the harness's model flag), SMOKE_CODEX_SANDBOX.
// Needs the harness CLI on PATH and signed in, Node 22+, npm (Playwright is installed per workspace).
// Writes results/<stamp>-<id>/log.md (gitignored); paste the summary line into RECORDED.md when
// the run is release evidence. Exit codes: 0 all passed · 1 a check failed · 2 usage / not installed.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKS, GOLDEN_A } from './checks.mjs';
import { HARNESSES, installLoose } from './harnesses.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(HERE, '..', '..');
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const id = opt('harness');
const H = HARNESSES[id];
if (!H) { console.error(`--harness must be one of ${Object.keys(HARNESSES).join(', ')}`); process.exit(2); }
if (spawnSync('which', [H.bin]).status !== 0) { console.error(`${H.bin} is not on PATH — install ${H.name} and sign in first`); process.exit(2); }
const pluginDir = resolve(opt('plugin-dir', PLUGIN));
const skillsDir = join(pluginDir, 'skills');
const impeccableRepo = resolve(opt('impeccable-repo', join(PLUGIN, '..', '..', '..', 'impeccable')));
const timeoutMs = Number(opt('timeout', '20')) * 60_000;
const only = opt('checks')?.split(',');
const version = readFileSync(join(skillsDir, 'stardust', 'VERSION'), 'utf8').trim();
const cliVersion = (spawnSync(H.bin, ['--version'], { encoding: 'utf8' }).stdout || '').trim().split('\n')[0];

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const OUT = join(HERE, 'results', `${stamp}-${id}`);
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, 'log.md');
const log = (s) => appendFileSync(LOG, `${s}\n`);
writeFileSync(LOG, `# ${H.name} smoke ${stamp}\n\n- CLI: ${cliVersion}\n- stardust: ${version} (${pluginDir})\n- layout: ${H.layout}${H.verified ? '' : ' (adapter not yet verified against the CLI)'}\n- model: ${process.env.SMOKE_MODEL || 'harness default'}\n\n`);

// The fixture site, served from this process for the whole run.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' };
const server = createServer((req, res) => {
  const p = join(HERE, 'fixture', 'site', decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!p.startsWith(join(HERE, 'fixture', 'site')) || !existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const siteUrl = `http://127.0.0.1:${server.address().port}/`;

function workspace(name, { playwright = false, seed = null } = {}) {
  const ws = join(OUT, name);
  mkdirSync(ws, { recursive: true });
  if (seed) cpSync(seed, ws, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: ws });
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: `smoke-${name}`, private: true, type: 'module' }, null, 2));
  if (playwright) {
    const r = spawnSync('npm', ['i', '-D', 'playwright', '--no-audit', '--no-fund', '--silent'], { cwd: ws, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`npm i playwright failed in ${ws}: ${r.stderr}`);
  }
  if (H.layout === 'loose') installLoose(ws, { skillsDir, impeccableRepo, skillsDot: H.skillsDot, impeccableDot: H.impeccableDot });
  return ws;
}

function prompt(ws, text, ms) {
  const lastMessage = join(ws, '..', `${Date.now()}-last.txt`);
  const [cmd, argv] = H.command({ prompt: text, pluginDir, ws, lastMessage });
  return new Promise((done) => {
    const child = spawn(cmd, argv, { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const t = setTimeout(() => { child.kill('SIGTERM'); stderr += `\n[smoke] killed after ${ms / 60000} min`; }, ms);
    child.on('close', (code) => {
      clearTimeout(t);
      const out = existsSync(lastMessage) ? readFileSync(lastMessage, 'utf8') : stdout;
      done({ code, out, stdout, stderr });
    });
  });
}

const results = [];
async function runCheck(check, ws, ms) {
  const ctx = { harness: id, version, skillsDir, siteUrl, out: '' };
  log(`## ${check.id}\n`);
  if (check.prompt) {
    const text = check.prompt(ctx);
    const t0 = Date.now();
    const r = await prompt(ws, text, ms);
    ctx.out = r.out;
    log(`Prompt: ${text}\n\nExit ${r.code}, ${Math.round((Date.now() - t0) / 1000)} s. Final output (last 4000 chars):\n\n\`\`\`\n${r.out.slice(-4000)}\n\`\`\`\n`);
    if (r.stderr.trim()) log(`stderr (last 1500 chars):\n\n\`\`\`\n${r.stderr.slice(-1500)}\n\`\`\`\n`);
  }
  const v = check.verify(ws, ctx);
  results.push({ id: check.id, ...v });
  const line = `${v.pass ? 'PASS' : 'FAIL'}  ${check.id}: ${v.detail}`;
  console.log(line); log(`${line}\n`);
}

let main; let gate;
try {
  main = workspace('ws', { playwright: true });
  cpSync(join(HERE, 'fixture', 'vision.png'), join(main, 'smoke-vision.png'));
  for (const c of CHECKS) {
    if (only && !only.includes(c.id)) continue;
    if (c.workspace === 'gate') { gate ||= workspace('ws-gate', { seed: join(PLUGIN, 'evals', 'direct-from-phrase', 'fixture') }); await runCheck(c, gate, timeoutMs); } else await runCheck(c, main, timeoutMs);
  }
  if (opt('golden') === 'a') await runCheck(GOLDEN_A, workspace('ws-golden-a', { playwright: true }), timeoutMs * 3);
} finally { server.close(); }

const passed = results.filter((r) => r.pass).length;
const summary = `${cliVersion.includes(H.name.split(' ')[0]) ? cliVersion : `${H.name} ${cliVersion}`} · stardust ${version} · ${H.layout}: passed ${passed}, failed ${results.length - passed}${results.some((r) => !r.pass) ? ` (${results.filter((r) => !r.pass).map((r) => r.id).join(', ')})` : ''}`;
console.log(`\n${summary}\nlog: ${LOG}`);
log(`---\n\n${summary}\n`);
if (passed === results.length && !args.includes('--keep')) for (const d of ['ws', 'ws-gate', 'ws-golden-a']) rmSync(join(OUT, d), { recursive: true, force: true });
process.exit(passed === results.length ? 0 : 1);
