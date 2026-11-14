#!/usr/bin/env node
// Guard: stardust scripts take their browser from one module, skills/stardust/scripts/browser.mjs.
//
// Why: scripts that import Playwright, start a browser, open contexts and navigate on their own
// each pick their own launch mode, wait strategy and failure message, and a fix to one never
// reaches the others. The front door (loadPlaywright, openBrowser, newContext, newPage, goto and
// the live-session names) is the one place that does these things. Front-door functions are
// called by bare name, so a leading-dot call (`.goto(`, `.newContext(`, `.launch(`) is a script
// doing the work itself. `context.newPage()` is fine; `browser.newPage()` is not.
//
// Files: every .mjs, .js and .sh under skills/, any depth. Skipped: test/ folders, browser.mjs and
// live-session.mjs in skills/stardust/scripts/ (they are the front door). Lines that start with
// `//`, `*` or `#` and lines that contain `browser-front-door: ignore` are skipped.
//
// Rules:
//   imports-playwright    from · import · import() · require() · resolve() of 'playwright' or 'playwright-core'
//                         (single, double or backtick quotes)
//   starts-a-browser      .launch( · launchPersistentContext( · connectOverCDP( ·
//                         launchLiveBrowser( · launchStealthHeaded( ·
//                         chromium|firefox|webkit|playwright .connect( or .launchServer(
//   opens-on-the-browser  .newContext( · browser.newPage( · b.newPage(
//   navigates-itself      .goto( · routeFromHAR(
//
// Usage: node plugins/stardust/evals/lint/browser-front-door.mjs [skill…]  (exit 1 on findings)
//   skill…   check only these skills (default: all)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const PLUGIN = join(import.meta.dirname, '..', '..');
const ROOT = join(PLUGIN, 'skills');
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(readFileSync(import.meta.filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const RULES = [
  { name: 'imports-playwright', re: /(?:from|import|import\(|require\(|resolve\()\s*['"`]playwright(?:-core)?['"`]/ },
  { name: 'starts-a-browser', re: /\.launch\(|launchPersistentContext\(|connectOverCDP\(|launchLiveBrowser\(|launchStealthHeaded\(|\b(?:chromium|firefox|webkit|playwright)\.(?:connect|launchServer)\(/ },
  { name: 'opens-on-the-browser', re: /\.newContext\(|\b(?:browser|b)\.newPage\(/ },
  { name: 'navigates-itself', re: /\.goto\(|routeFromHAR\(/ },
];
const FRONT_DOOR = new Set(['stardust/scripts/browser.mjs', 'stardust/scripts/live-session.mjs']);

const unknown = argv.filter((s) => !existsSync(join(ROOT, s)) || !statSync(join(ROOT, s)).isDirectory());
if (unknown.length) { console.error(`browser-front-door lint: no such skill: ${unknown.join(', ')} (looked in ${ROOT})`); process.exit(2); }

const files = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'test') walk(p); continue; }
    if (/\.(mjs|js|sh)$/.test(e) && !FRONT_DOOR.has(relative(ROOT, p).split(sep).join('/'))) files.push(p);
  }
}
for (const skill of argv.length ? argv : readdirSync(ROOT).filter((e) => statSync(join(ROOT, e)).isDirectory())) walk(join(ROOT, skill));

const findings = [];
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (/^(\/\/|\*|#)/.test(t) || t.includes('browser-front-door: ignore')) return;
    for (const { name, re } of RULES) if (re.test(t)) findings.push(`${relative(PLUGIN, f)}:${i + 1}: ${name} — ${t}`);
  });
}
if (findings.length) console.log(findings.join('\n'));
console.log(`browser-front-door lint: ${files.length} files, ${findings.length} findings`);
process.exit(findings.length ? 1 : 0);
