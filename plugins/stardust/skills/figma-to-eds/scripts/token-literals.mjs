#!/usr/bin/env node
// Token consumption check — the "consumption" probe class of gate 1
// (reference/gates.md § 1). Blocks consume tokens; only styles.css states
// raw values. A block that hardcodes a value that exists as a token renders
// identically today and silently drifts when the token changes, so the
// token probe cannot see it. This scan can: it lists every literal in
// blocks/**/*.css whose value equals a token in donor-tokens.json.
//
// Matched by default: colors (hex / rgb() / rgba(), normalized), ms
// durations, and whole cubic-bezier() / shadow values. px lengths are
// opt-in (--lengths): a kit's spacing scale usually covers every multiple
// of 4, so on a real run px matches are mostly coincidence, not drift.
// Media-query lines are skipped (breakpoints are not tokens). A line carrying the comment
// `token-literal-ok: <reason>` is accepted — the reason is the record.
//
// Usage: node token-literals.mjs --tokens <donor-tokens.json> --blocks <blocks dir>
//        [--lengths] [--ignore 0px,1px] [--out <report.json>]
// Exit 1 when any literal is found.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const tokensPath = arg('--tokens'); const blocksDir = arg('--blocks'); const outPath = arg('--out');
// hairlines and resets match border/spacing tokens everywhere; ignore by default
const ignore = new Set(arg('--ignore', '0px,1px').split(',').filter(Boolean));
const lengths = process.argv.includes('--lengths');
if (!tokensPath || !blocksDir) { console.error('usage: --tokens <json> --blocks <dir> [--lengths] [--ignore 0px,1px] [--out <json>]'); process.exit(2); }

const hex = (h) => {
  let s = h.slice(1).toLowerCase();
  if (s.length <= 4) s = [...s].map((c) => c + c).join('');
  return '#' + (s.length === 8 && s.endsWith('ff') ? s.slice(0, 6) : s);
};
const rgb = (fn) => {
  const n = fn.match(/[\d.]+%?/g).map((v, i) => (i === 3
    ? Math.round((v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v)) * 255)
    : Math.round(parseFloat(v))));
  return hex('#' + n.map((v) => v.toString(16).padStart(2, '0')).join(''));
};
const squash = (v) => v.toLowerCase().replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim();

const ATOM = lengths ? /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|-?\d*\.?\d+(?:px|ms)\b/gi
  : /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|-?\d*\.?\d+ms\b/gi;
const atom = (v) => (v.startsWith('#') ? hex(v) : /^rgb/i.test(v) ? rgb(v) : v.toLowerCase().replace(/^(-?)0+(\d)/, '$1$2'));

const sheet = JSON.parse(readFileSync(tokensPath, 'utf8')).tokens;
const byValue = new Map(); // atom value -> token names
const byWhole = new Map(); // whole composite value (shadow, easing) -> token names
const add = (map, key, name) => { if (!map.has(key)) map.set(key, []); map.get(key).push(name); };
for (const s of ['colors', 'radii', 'borderWidths', 'spacing', 'sizing', 'spaceSemantic', 'sizeSemantic', 'durations']) {
  for (const [name, t] of Object.entries(sheet[s] || {})) {
    const m = String(t.value).match(ATOM);
    if (m && m.length === 1 && squash(m[0]) === squash(String(t.value))) add(byValue, atom(m[0]), name);
  }
}
for (const s of ['shadows', 'easings']) {
  for (const [name, t] of Object.entries(sheet[s] || {})) add(byWhole, squash(String(t.value)), name);
}

const cssFiles = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? cssFiles(p) : (e.endsWith('.css') ? [p] : []);
});

const findings = [];
for (const file of cssFiles(blocksDir)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let inComment = false;
  lines.forEach((raw, i) => {
    if (/token-literal-ok/.test(raw)) return;
    // strip comments, tracking multi-line ones, so commented-out CSS never counts
    let line = ''; let rest = raw;
    while (rest) {
      if (inComment) {
        const end = rest.indexOf('*/');
        if (end < 0) { rest = ''; break; }
        inComment = false; rest = rest.slice(end + 2);
      } else {
        const start = rest.indexOf('/*');
        if (start < 0) { line += rest; rest = ''; break; }
        line += rest.slice(0, start); inComment = true; rest = rest.slice(start + 2);
      }
    }
    if (/^\s*@(media|container|supports)/.test(line)) return;
    const colon = line.indexOf(':');
    if (colon < 0 || /[{]\s*$/.test(line)) return; // selectors, not declarations
    const value = line.slice(colon + 1).replace(/;?\s*}?\s*$/, '');
    const hits = new Set();
    const whole = byWhole.get(squash(value.replace(/!important/i, '')));
    if (whole) hits.add(JSON.stringify([squash(value), whole]));
    for (const m of value.replace(/var\([^)]*\)/g, '').matchAll(ATOM)) {
      const key = atom(m[0]);
      if (ignore.has(key) || !byValue.has(key)) continue;
      hits.add(JSON.stringify([m[0], byValue.get(key)]));
    }
    for (const h of hits) {
      const [literal, tokens] = JSON.parse(h);
      findings.push({ file: relative(process.cwd(), file), line: i + 1, literal, tokens, text: raw.trim() });
    }
  });
}

const report = { tokens: tokensPath, blocks: blocksDir, ignore: [...ignore], findings: findings.length, pass: !findings.length, detail: findings };
if (outPath) { mkdirSync(dirname(resolve(outPath)), { recursive: true }); writeFileSync(outPath, JSON.stringify(report, null, 1)); }
console.log(`${report.pass ? 'PASS' : 'FAIL'} — ${findings.length} hardcoded token values in ${blocksDir}`);
for (const f of findings.slice(0, 25)) console.log(`  ${f.file}:${f.line} ${f.literal} -> var(${f.tokens.join(' | ')})`);
process.exit(findings.length ? 1 : 0);
