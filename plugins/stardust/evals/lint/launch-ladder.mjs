#!/usr/bin/env node
// Guard: the bot-management escalation ladder lives in exactly two files and
// they agree; no other script launches a browser window.
//
// Why: a headed Chrome window popping over the operator's desk is the
// interrupt class the ladder exists to remove (extract/reference/
// playwright-recipe.md § Bot-management fallback). The ladder is enforced by
// code — `skills/diff/scripts/live-session.mjs` for the single-launch
// instruments and `skills/extract/scripts/crawl.mjs`, which is copied alone
// into projects and so carries a byte-identical copy rather than an import.
//
// Rules:
//   * `headless: false` / `headless: !<flag>` and `launchStealthHeaded(` appear
//     in no skills/**/*.mjs other than the two ladder files (the alias is
//     transitional; instruments use launchTier / launchLadder) — a temporary
//     allowlist names the scripts still to be routed, and must shrink;
//   * TIERS, STEALTH_ARGS, OFFSCREEN_ARGS and the launchTier function body are
//     identical in the two files (modulo `export` and whitespace);
//   * the consent-label tables (ACCEPT_LABELS, DECLINE_LABELS, SETTINGS_LABELS,
//     CLOSE_LABELS) and the DOM helpers pageFindLabelled / pageClickInShadow
//     are identical too — live-session.mjs is the source of truth, crawl.mjs
//     dismissConsent carries the copy (D3: lift, capture and gate click the
//     SAME control; a label added on one side only would split them).
//
// Usage: node plugins/stardust/evals/lint/launch-ladder.mjs  (exit 1 on findings)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'skills');
const LADDER = ['diff/scripts/live-session.mjs', 'extract/scripts/crawl.mjs'];
const rel = (p) => relative(process.cwd(), p);

const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.mjs')) files.push(p); } })(ROOT);

// TEMPORARY — shrink per release. Key: path relative to skills/. Value: why a
// windowed launch is still tolerated there. A stale entry fails the lint.
const TEMPORARY_ALLOWLIST = {
  // empty — every windowed launch goes through live-session launchTier; entries added here must shrink per release
};

const findings = [];
const used = new Set();
for (const f of files) {
  if (LADDER.some((l) => f.endsWith(`/${l}`))) continue;
  const key = relative(ROOT, f);
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    // `headless: false` or `headless: !<flag>` — either can open a window
    if (/headless:\s*(false|!)/.test(line)) {
      if (TEMPORARY_ALLOWLIST[key]) { used.add(key); return; }
      findings.push(`${rel(f)}:${i + 1}: windowed launch (\`${line.trim().match(/headless:\s*[^,}]+/)[0]}\`) outside the ladder files — launch through live-session launchTier/launchLadder`);
    }
    if (/launchStealthHeaded\(/.test(line)) findings.push(`${rel(f)}:${i + 1}: launchStealthHeaded() is the transitional tier-3 alias — use launchTier(chromium, resolveStartTier(parseHeadedFlag(arg)))`);
  });
}

// parity of the shared literals + launchTier body
const PARTS = [
  ['TIERS', /const TIERS = \[[^\]]*\];/],
  ['STEALTH_ARGS', /const STEALTH_ARGS = \[[^\]]*\];/],
  ['OFFSCREEN_ARGS', /const OFFSCREEN_ARGS = \[[^\]]*\];/],
  ['launchTier', /async function launchTier\(chromium, tier\) \{[\s\S]*?\n\}/],
  ['ACCEPT_LABELS', /const ACCEPT_LABELS = \[[^\]]*\];/],
  ['DECLINE_LABELS', /const DECLINE_LABELS = \[[^\]]*\];/],
  ['SETTINGS_LABELS', /const SETTINGS_LABELS = \[[^\]]*\];/],
  ['CLOSE_LABELS', /const CLOSE_LABELS = \[[^\]]*\];/],
  ['pageFindLabelled', /function pageFindLabelled\(\{ labels, marker, requireOverlay \}\) \{[\s\S]*?\n\}/],
  ['pageClickInShadow', /function pageClickInShadow\(\{ hostSel, sel \}\) \{[\s\S]*?\n\}/],
];
const norm = (s) => s.replace(/^export /gm, '').replace(/\s+/g, ' ').trim();
const srcs = LADDER.map((l) => readFileSync(join(ROOT, l), 'utf8'));
for (const [name, re] of PARTS) {
  const got = srcs.map((s) => (s.match(re) || [])[0]);
  got.forEach((g, i) => { if (!g) findings.push(`${LADDER[i]}: ${name} not found — the ladder contract must be spelled the same way in both files`); });
  if (got.every(Boolean) && norm(got[0]) !== norm(got[1])) findings.push(`${name} differs between ${LADDER[0]} and ${LADDER[1]} — copy one to the other; crawl.mjs cannot import live-session (it ships alone)`);
}

for (const k of Object.keys(TEMPORARY_ALLOWLIST)) if (!used.has(k)) findings.push(`stale TEMPORARY_ALLOWLIST entry "${k}" — remove it`);
const uniq = [...new Set(findings)];
if (uniq.length) { console.error(`launch-ladder lint: ${uniq.length} finding(s)\n${uniq.join('\n')}`); process.exit(1); }
console.log(`launch-ladder lint: ${files.length} scripts, no window launch outside the ladder (${used.size} allowlisted); ${PARTS.length} shared parts (ladder + consent tables/helpers) identical`);
