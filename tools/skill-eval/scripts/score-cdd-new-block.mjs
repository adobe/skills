#!/usr/bin/env node
// Deterministic pre-score for the `content-driven-development-new-block-ew` scenario.
// Scores the checks of criteria.json that a script can decide (84 of 100 points); the
// behaviour and content-model checks (16 points) stay with the judge and the user's review.
// Usage: node scripts/score-cdd-new-block.mjs <workdir> [--json]
// The workdir needs a git tag `eval-base` (setup.sh makes it) so that changes are known.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
const read = (dir, path) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : '');

export function changedFiles(dir) {
  const tracked = git(dir, 'diff', '--name-only', 'eval-base').split('\n').filter(Boolean);
  const untracked = git(dir, 'ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
  return [...new Set([...tracked, ...untracked])].filter((file) => !file.startsWith('node_modules/') && existsSync(join(dir, file)));
}

export function pngWidth(path) {
  const buf = readFileSync(path);
  return buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG' ? buf.readUInt32BE(16) : null;
}

const TEXT = '(?:h[1-6]|p|ul|ol|li|blockquote|pre)';

export function score(dir) {
  const files = changedFiles(dir);
  const out = [];
  const add = (name, got, max, note = '') => out.push({ name, got: Math.max(0, Math.min(max, got)), max, note });
  const css = read(dir, 'blocks/plans/plans.css');
  const js = read(dir, 'blocks/plans/plans.js');
  const pr = read(dir, 'PR.md');
  const libPath = 'content/docs/library/blocks/plans.html';
  const lib = read(dir, libPath);
  const pkgChanged = files.includes('package.json');
  const pkg = pkgChanged ? read(dir, 'package.json') : '';

  // 1 library page
  let n = 0;
  if (lib) n += 6;
  if (/class="library-metadata"/.test(lib) && /description/i.test(lib)) n += 3;
  if (/class="plans[ "]/.test(lib)) n += 3;
  add('Library page next to the others', n, 12);

  // 2 blocks sheet
  let sheet = null;
  try { sheet = JSON.parse(read(dir, 'content/docs/library/blocks.json')); } catch { /* */ }
  const rows = sheet?.data ?? [];
  const hasRow = rows.some((r) => /\/docs\/library\/blocks\/plans$/.test(r.path ?? ''));
  const kept = ['cards', 'columns'].every((b) => rows.some((r) => (r.path ?? '').endsWith(`/blocks/${b}`)));
  add('Blocks sheet row', (hasRow ? 4 : 0) + (kept ? 2 : 0), 6);

  // 3 edge cases off the library
  const others = files.filter((f) => f.endsWith('.html') && f !== libPath && (f.startsWith('content/') || /(^|\/)(test|tests|drafts)\//.test(f)));
  const isTest = (f) => /\.(test|spec)\.[cm]?[jt]s$/.test(f);
  const testFile = files.find(isTest);
  const edgeElsewhere = others.length > 0 || Boolean(testFile);
  const libRows = (lib.match(/<div class="plans[^"]*">([\s\S]*?)<\/div>\s*<div class="library-metadata|<div class="plans[^"]*">([\s\S]*)$/) ?? [''])[0];
  const emptyCell = /<div>\s*(<p>\s*<\/p>)?\s*<\/div>/.test(libRows);
  const longName = /<h3>[^<]{60,}<\/h3>/.test(libRows);
  const happyOnly = lib && !emptyCell && !longName;
  add('Edge cases off the library', (edgeElsewhere ? 5 : 0) + (happyOnly ? 5 : 0), 10, `elsewhere=${edgeElsewhere} happyOnly=${Boolean(happyOnly)}`);

  // 4 mobile first
  const media = [...css.matchAll(/@media\s*([^{]+)\{/g)].map((m) => m[1]);
  const up = media.some((m) => /min-width|width\s*>=/.test(m));
  const down = media.some((m) => /max-width|width\s*<=/.test(m));
  add('Mobile first', (up || media.length === 0 ? 5 : 0) + (down ? 0 : 5), 10, `up=${up} down=${down} queries=${media.length}`);

  // 5 tested or justified
  const frameworks = /"(vitest|jest|mocha|ava|@playwright\/test|jasmine)"/.exec(pkg)?.[1];
  const named = frameworks && new RegExp(frameworks.replace('/', '\\/'), 'i').test(pr);
  const cases = testFile ? (read(dir, testFile).match(/\b(test|it)\(/g) ?? []).length : 0;
  const reason = /(no|without|not|n't)[^.\n]{0,80}(unit test|test framework|testing framework|tests)|(unit tests?)[^.\n]{0,80}(not|unnecessary|skipp|n't)/i.test(pr);
  let t = 0;
  if (frameworks && !named) t = 4;
  else if (testFile && cases >= 2) t = 10;
  else if (reason) t = 10;
  add('Saving calculation tested or justified', t, 10, `framework=${frameworks ?? 'none'} named=${Boolean(named)} cases=${cases} reason=${reason}`);

  // 6 layout view (static approximation of the aem.live rules)
  let lv = 8;
  const notes = [];
  if (new RegExp(`${TEXT}\\s*[>+~]|[>+~]\\s*${TEXT}\\b`).test(css) || new RegExp(`${TEXT}[^{]*:(first|last|nth)-child`).test(css)) { lv -= 2; notes.push('combinator on text'); }
  if (/\b(h[1-6]|p|li|ul|ol|heading|paragraph)(\.(innerHTML|textContent|className)\s*=[^=]|\.classList\.(add|toggle|remove))|\.replaceWith\(|cloneNode/.test(js)) { lv -= 2; notes.push('text decorated, copied or replaced'); }
  if (/(document|window)\.addEventListener/.test(js)) { lv -= 2; notes.push('global listener'); }
  if (/innerHTML\s*=\s*[`'"]<(span|i|svg)/.test(js)) { lv -= 2; notes.push('markup injected into text'); }
  add('Layout view safe', lv, 8, notes.join('; '));

  // 7 performance
  let pf = 6;
  const pn = [];
  if (/preload|preconnect|fetchpriority/i.test(js + css + files.map((f) => (f.endsWith('.html') ? read(dir, f) : '')).join(''))) { pf -= 2; pn.push('hints'); }
  if (/\bawait\b/.test(js)) { pf -= 2; pn.push('await in block'); }
  if (/url\(/.test(css) && /background(-image)?\s*:[^;]*url\(/.test(css)) { pf -= 2; pn.push('css background image'); }
  if (pkg && /"dependencies"/.test(pkg)) { pf -= 2; pn.push('runtime dependency'); }
  add('No performance regressions', pf, 6, pn.join('; '));

  // 8 gates
  const allowed = (f) => /^(blocks\/plans\/|content\/|pr-screenshots\/)/.test(f) || f === 'PR.md' || f === 'package.json' || isTest(f);
  const stray = files.filter((f) => !allowed(f));
  const aem = files.includes('scripts/aem.js');
  let g = aem ? 0 : 8;
  g -= Math.min(8, stray.length * 2);
  if (pkgChanged && frameworks) g -= 2;
  add('Gates (scope; lint not run)', g, 8, `stray=${stray.join(',')}`);

  // 9 PR description
  let p = 0;
  const hosts = [...pr.matchAll(/https:\/\/([a-z0-9-]+)--([a-z0-9-]+)--([a-z0-9-]+)\.aem\.(page|live)/g)];
  if (hosts.some((h) => h[1] === 'main')) p += 2;
  const branchHosts = hosts.filter((h) => h[1] !== 'main');
  if (branchHosts.length) p += 2;
  if (branchHosts.length && branchHosts.every((h) => `${h[1]}--${h[2]}--${h[3]}`.length <= 63)) p += 2;
  if (/assum/i.test(pr)) p += 1;
  if (/library/i.test(pr) && /(config|outside|push)/i.test(pr)) p += 1;
  add('PR description', p, 8);

  // 10 browser evidence
  const shots = files.filter((f) => /\.png$/i.test(f)).map((f) => pngWidth(join(dir, f))).filter(Boolean);
  const mobile = shots.some((w) => w <= 480), tablet = shots.some((w) => w >= 600 && w <= 1024), desktop = shots.some((w) => w >= 1100);
  let ev = 0;
  if (mobile && tablet && desktop) ev = 6;
  else if (/(375|mobile)[\s\S]{0,200}(768|tablet)[\s\S]{0,200}(1200|desktop)/i.test(pr)) ev = 3;
  else if (/viewport|mobile|tablet|desktop|browser/i.test(pr)) ev = 1;
  add('Evidence of a browser check', ev, 6, `shots=${shots.join(',')}`);

  const total = out.reduce((a, c) => a + c.got, 0);
  const max = out.reduce((a, c) => a + c.max, 0);
  return { total, max, checks: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir || !statSync(dir).isDirectory()) { console.error('usage: score-cdd-new-block.mjs <workdir> [--json]'); process.exit(2); }
  const result = score(dir);
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const c of result.checks) console.log(`${String(c.got).padStart(2)}/${String(c.max).padEnd(2)} ${c.name}${c.note ? `  (${c.note})` : ''}`);
    console.log(`${result.total}/${result.max} deterministic points (behaviour and content model are judged)`);
  }
}
