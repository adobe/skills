#!/usr/bin/env node
/**
 * skills/replica/scripts/impeccable-ignores.mjs
 *
 * Install the impeccable design-hook ignore set for LIFTED values, once per
 * project (replica and reskin flows). In a same-design or donor-design run
 * the palette, type sizes and families are lifted from a live site — the
 * hook's design-system rules will flag every one of them, and that is not
 * drift. Field runs re-derived this per finding, one admin call at a time,
 * dozens of calls per project; this script makes it one bulk, idempotent
 * pass with one reason string, and records what it did.
 *
 * What it does (preserve-direction.md § 4 owns the rule):
 *   1. Resolves the installed impeccable skill dir — never a hard-coded path:
 *      --impeccable-dir, $IMPECCABLE_DIR, state.json#impeccable.skillDir, the
 *      Claude Code registry (installed_plugins.json → installPath), the
 *      marketplace/cache dirs, the Copilot install dirs. Admin entry point:
 *      <dir>/scripts/impeccable hooks <action> (4.3+), else
 *      node <dir>/scripts/hook-admin.mjs <action> (4.1.x).
 *   2. Collects colours, font sizes and families from the lifted sources:
 *      stardust/current/_brand-extraction.json (palette, type), any --tokens
 *      files (the Phase-3 CSS-lift record), stardust/reskin/donor-tokens.json.
 *   3. Runs `ignore-value design-system-color <c>` / `design-system-font-size
 *      <px>` / `overused-font <family>` for each value not already in
 *      .impeccable/config.json#detector.ignoreValues — self-serve calls.
 *   4. ignore-file for the captured trees (stardust/current/**,
 *      stardust/prototypes/**, stardust/canon/**; reskin adds
 *      stardust/canon-source/**, stardust/reskin/**) is a USER-CONSENT action
 *      in impeccable's contract: without --files (or state.json.handsOff) the
 *      planned globs are printed in one line and the self-serve fallback runs
 *      instead — `ignore-value <rule> "*" --file <glob>` for the copy-cadence
 *      rules (--file-rules) on those globs only. Never ignore-rule.
 *   5. Lifted values inside blocks/** and styles/** are ignored BY VALUE only
 *      (step 3 covers them) — agent-authored code keeps the full rule set, so
 *      no --file scope is ever placed on it.
 *   6. Appends one record line (date, impeccable version, globs, value count,
 *      sources, who resolved) to the record file.
 *
 * Usage:
 *   node stardust/scripts/replica/impeccable-ignores.mjs [options]
 *     --skill replica|reskin   flow (default: state.json.flow, else replica)
 *     --origin <url>           origin named in --reason (default: state.json site.originUrl)
 *     --tokens <file>          extra lifted-values JSON (repeatable): CSS-lift record
 *     --impeccable-dir <dir>   installed impeccable skill dir (default: resolved, see 1)
 *     --files                  run the ignore-file calls (the user said go, or hands-off)
 *     --file-rules <r,...>     rules scoped off on the captured globs when ignore-file
 *                              is not applied (default marketing-buzzword,em-dash-overuse)
 *     --record <file>          record line target (default stardust/direction.md;
 *                              reskin: stardust/reskin/mapping.md)
 *     --dry-run                print every planned call; run and write nothing
 *     --json                   machine-readable summary on stdout
 *
 * Exit codes: 0 done (also when nothing new was needed), 1 error,
 * 3 impeccable not installed (skip the step and say so — never fabricate).
 */

/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len, no-await-in-loop */
import { existsSync, readFileSync, readdirSync, appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';

const HELP = `impeccable-ignores — install the design-hook ignore set for lifted values (once per project)

Usage: node impeccable-ignores.mjs [options]
  --skill replica|reskin   flow (default: state.json.flow, else replica)
  --origin <url>           origin for the --reason string (default: state.json site.originUrl)
  --tokens <file>          extra lifted-values JSON, repeatable (the CSS-lift record)
  --impeccable-dir <dir>   installed impeccable skill dir (default: resolved from the registries)
  --files                  also run ignore-file on the captured trees (user consent or hands-off)
  --file-rules <r,...>     rules turned off on the captured globs by value+file when --files is absent
                           (default marketing-buzzword,em-dash-overuse); never ignore-rule
  --record <file>          where the one-line record goes (default stardust/direction.md)
  --dry-run                print the plan, run nothing, write nothing
  --json                   machine-readable summary
  --help                   this text

Exit: 0 done · 1 error · 3 impeccable not installed (skip the step, say so).`;

const HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const COPILOT_HOME = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
const GLOBS = {
  replica: ['stardust/current/**', 'stardust/prototypes/**', 'stardust/canon/**'],
  reskin: ['stardust/current/**', 'stardust/prototypes/**', 'stardust/canon/**', 'stardust/canon-source/**', 'stardust/reskin/**'],
};
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(0); }
  const o = { skill: null, origin: null, tokens: [], dir: process.env.IMPECCABLE_DIR || null, files: false, fileRules: ['marketing-buzzword', 'em-dash-overuse'], record: null, dryRun: false, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--skill') o.skill = rest[i += 1];
    else if (a === '--origin') o.origin = rest[i += 1];
    else if (a === '--tokens') o.tokens.push(rest[i += 1]);
    else if (a === '--impeccable-dir') o.dir = rest[i += 1];
    else if (a === '--files') o.files = true;
    else if (a === '--file-rules') o.fileRules = (rest[i += 1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--record') o.record = rest[i += 1];
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    else { console.error(`unknown argument ${a}\n\n${HELP}`); process.exit(1); }
  }
  if (o.skill && !GLOBS[o.skill]) { console.error(`--skill must be replica or reskin\n\n${HELP}`); process.exit(1); }
  return o;
}

// ── 1. resolve the installed impeccable skill dir + admin entry point ──────────
function candidateDirs(state) {
  const out = [];
  if (state?.impeccable?.skillDir) out.push(state.impeccable.skillDir);
  const reg = readJson(path.join(HOME, 'plugins', 'installed_plugins.json'));
  for (const [key, entry] of Object.entries(reg?.plugins || {})) {
    if (!key.startsWith('impeccable@')) continue;
    for (const e of Array.isArray(entry) ? entry : [entry]) if (e?.installPath) out.push(path.join(e.installPath, 'skills', 'impeccable'));
  }
  const cache = path.join(HOME, 'plugins', 'cache', 'impeccable', 'impeccable');
  try { for (const v of readdirSync(cache).sort().reverse()) out.push(path.join(cache, v, 'skills', 'impeccable')); } catch { /* none */ }
  out.push(path.join(HOME, 'plugins', 'marketplaces', 'impeccable', 'skills', 'impeccable'));
  const cp = path.join(COPILOT_HOME, 'installed-plugins');
  try {
    for (const mkt of readdirSync(cp)) {
      if (mkt === '_direct') { try { for (const d of readdirSync(path.join(cp, '_direct'))) if (d.includes('impeccable')) out.push(path.join(cp, '_direct', d, 'skills', 'impeccable')); } catch { /* none */ } }
      else out.push(path.join(cp, mkt, 'impeccable', 'skills', 'impeccable'));
    }
  } catch { /* none */ }
  return out;
}

function resolveAdmin(dirOpt, state) {
  const dirs = dirOpt ? [dirOpt] : candidateDirs(state);
  for (const d of dirs) {
    const launcher = path.join(d, 'scripts', 'impeccable');
    const legacy = path.join(d, 'scripts', 'hook-admin.mjs');
    if (existsSync(launcher)) return { dir: d, cmd: [launcher, 'hooks'], kind: 'launcher' };
    if (existsSync(legacy)) return { dir: d, cmd: [process.execPath, legacy], kind: 'hook-admin.mjs' };
  }
  return null;
}

function impeccableVersion(dir) {
  const pj = readJson(path.join(dir, '..', '..', '.claude-plugin', 'plugin.json')) || readJson(path.join(dir, '.claude-plugin', 'plugin.json')) || readJson(path.join(dir, 'package.json'));
  return pj?.version || 'unknown';
}

// ── 2. collect lifted values ──────────────────────────────────────────────────
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^(?:rgb|hsl)a?\(/i;
const PX = /^\d+(?:\.\d+)?(?:px|rem)$/;
const firstFamily = (s) => String(s).split(',')[0].trim().replace(/^["']|["']$/g, '');
const SYSTEM_FAMILIES = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'inherit', 'initial', '-apple-system', 'blinkmacsystemfont']);

function walk(node, keyPath, acc) {
  if (node == null) return;
  if (typeof node === 'string') {
    // classify by the LAST named key (array indexes skipped): `sizes[0]`,
    // `display.fontSize` are sizes; `name`, `stack`, `family` are families.
    const last = [...keyPath].reverse().find((k) => !/^\d+$/.test(k))?.toLowerCase() || '';
    const v = node.trim();
    if (HEX.test(v) || RGB.test(v)) acc.colors.add(v.toLowerCase());
    else if (PX.test(v) && /^(sizes?|fontsize)$/.test(last)) acc.sizes.add(v);
    else if (/^(name|stack|family|fontfamily)$/.test(last)) { const f = firstFamily(v); if (f && !SYSTEM_FAMILIES.has(f.toLowerCase()) && !/[()\d]/.test(f)) acc.families.add(f); }
    return;
  }
  if (Array.isArray(node)) { node.forEach((x, i) => walk(x, [...keyPath, String(i)], acc)); return; }
  if (typeof node === 'object') for (const [k, v] of Object.entries(node)) { if (k === '_provenance' || k === 'sourceSelectors') continue; walk(v, [...keyPath, k], acc); }
}

function collect(opts) {
  const acc = { colors: new Set(), sizes: new Set(), families: new Set() };
  const sources = [];
  const brand = readJson('stardust/current/_brand-extraction.json');
  if (brand) { walk({ palette: brand.palette, type: brand.type }, ['brand'], acc); sources.push('stardust/current/_brand-extraction.json'); }
  for (const f of opts.tokens) { const j = readJson(f); if (!j) { console.error(`impeccable-ignores: cannot read --tokens ${f}`); process.exit(1); } walk(j, ['tokens'], acc); sources.push(f); }
  if (opts.skill === 'reskin') { const donor = readJson('stardust/reskin/donor-tokens.json'); if (donor) { walk(donor, ['donor'], acc); sources.push('stardust/reskin/donor-tokens.json'); } }
  return { acc, sources };
}

// ── 3–5. plan + run ───────────────────────────────────────────────────────────
function main() {
  const opts = parseArgs(process.argv);
  const state = readJson('stardust/state.json');
  opts.skill = opts.skill || (GLOBS[state?.flow] ? state.flow : 'replica');
  opts.origin = opts.origin || state?.site?.originUrl || readJson('stardust/current/_brand-extraction.json')?.site?.originUrl || '<origin>';
  opts.record = opts.record || (opts.skill === 'reskin' ? 'stardust/reskin/mapping.md' : 'stardust/direction.md');
  const handsOff = state?.handsOff === true;

  const admin = resolveAdmin(opts.dir, state);
  if (!admin) {
    console.error('impeccable-ignores: impeccable not installed (no scripts/impeccable launcher or scripts/hook-admin.mjs in any known install dir) — skip this step and say so; pass --impeccable-dir <dir> for a skills-directory install.');
    process.exit(3);
  }
  const version = impeccableVersion(admin.dir);
  const { acc, sources } = collect(opts);
  if (!sources.length) { console.error('impeccable-ignores: no lifted-value source found (stardust/current/_brand-extraction.json, --tokens, donor-tokens.json) — run after the Phase 1 capture.'); process.exit(1); }

  const config = readJson('.impeccable/config.json') || {};
  const have = new Set((config?.detector?.ignoreValues || []).map((e) => `${e.rule}\u0000${String(e.value).toLowerCase()}\u0000${(e.files || []).join(',')}`));
  const haveFiles = new Set(config?.detector?.ignoreFiles || []);
  const seen = (rule, value, files = []) => have.has(`${rule}\u0000${String(value).toLowerCase()}\u0000${files.join(',')}`);

  const date = new Date().toISOString().slice(0, 10);
  const reason = `${opts.skill}: lifted from ${opts.origin} on ${date}`;
  const pairs = [
    ...[...acc.colors].map((v) => ['design-system-color', v]),
    ...[...acc.sizes].map((v) => ['design-system-font-size', v]),
    ...[...acc.families].map((v) => ['overused-font', v]),
  ];
  const valueCalls = pairs.filter(([r, v]) => !seen(r, v)).map(([r, v]) => [r, v, '--reason', reason]);
  const globs = GLOBS[opts.skill];
  const applyFiles = opts.files || handsOff;
  const fileCalls = applyFiles ? globs.filter((g) => !haveFiles.has(g)).map((g) => ['ignore-file', g]) : [];
  const fallbackCalls = applyFiles ? [] : opts.fileRules.flatMap((rule) => globs.filter((g) => !seen(rule, '*', [g])).map((g) => ['ignore-value', rule, '*', '--file', g, '--reason', reason]));

  const plan = [...valueCalls.map((c) => ['ignore-value', ...c]), ...fileCalls, ...fallbackCalls];
  const run = (args) => {
    if (opts.dryRun) return { status: 0, dry: true };
    const r = spawnSync(admin.cmd[0], [...admin.cmd.slice(1), ...args], { encoding: 'utf8' });
    if (r.status !== 0) console.error(`impeccable-ignores: ${args.slice(0, 3).join(' ')} failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
    return r;
  };
  let failed = 0;
  for (const args of plan) { const r = run(args); if (r.status !== 0) failed += 1; }

  const filesLine = applyFiles ? globs.join(' ') : `pending consent (${globs.join(' ')}) — fallback: ${opts.fileRules.join(',')} "*" --file on those globs`;
  const counts = `${pairs.length} (colors ${acc.colors.size}, sizes ${acc.sizes.size}, families ${acc.families.size}; ${valueCalls.length} new)`;
  const record = `Impeccable ignore set (${date}): impeccable ${version} · files: ${filesLine} · values: ${counts} · from: ${sources.join(', ')} · resolved by: ${handsOff ? 'hands-off' : applyFiles ? 'user' : 'agent (values only)'}`;
  if (!opts.dryRun && (valueCalls.length || fileCalls.length || fallbackCalls.length)) {
    mkdirSync(path.dirname(opts.record), { recursive: true });
    if (existsSync(opts.record)) appendFileSync(opts.record, `\n${record}\n`);
    else writeFileSync(opts.record, `# ${opts.skill} — record\n\n${record}\n`);
  }

  const summary = { skill: opts.skill, impeccable: { dir: admin.dir, version, entry: admin.kind }, origin: opts.origin, sources, values: { colors: [...acc.colors], sizes: [...acc.sizes], families: [...acc.families] }, newValueCalls: valueCalls.length, ignoreFile: applyFiles ? globs : null, plannedIgnoreFile: applyFiles ? null : globs, fallbackFileRules: applyFiles ? null : opts.fileRules, failed, dryRun: opts.dryRun, record: opts.record, recordLine: record };
  if (opts.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`impeccable ${version} via ${admin.kind} (${admin.dir})`);
    if (opts.dryRun) for (const args of plan) console.log(`  plan: ${admin.cmd.slice(1).join(' ')} ${args.map((a) => (/\s|\*/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    console.log(`values: ${counts} → ${opts.dryRun ? 'planned' : 'applied'} ${valueCalls.length} ignore-value call(s) — the design hook WILL flag lifted values; look the set up here before triaging`);
    if (applyFiles) console.log(`ignore-file: ${fileCalls.length ? fileCalls.map((c) => c[1]).join(' ') : 'already present'}${handsOff ? ' (hands-off: choosing this flow is the keep-design decision)' : ''}`);
    else console.log(`ignore-file NOT applied (needs your go — impeccable's self-serve stops at ignore-value): planned ${globs.join(' ')} — re-run with --files to apply; fallback applied: ${opts.fileRules.join(',')} "*" --file on those globs`);
    console.log(`blocks/** and styles/** keep the full rule set — lifted values there are covered by value only.`);
    console.log(`${opts.dryRun ? 'would record' : valueCalls.length || fileCalls.length || fallbackCalls.length ? 'recorded' : 'nothing new; not recorded'} → ${opts.record}: ${record}`);
    if (failed) console.log(`${failed} admin call(s) failed — see stderr`);
  }
  process.exitCode = failed ? 1 : 0;
}

try { main(); } catch (e) { console.error(`impeccable-ignores error: ${e.message}`); process.exit(1); }
