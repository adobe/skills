#!/usr/bin/env node
/**
 * skills/replica/scripts/gate-flags.mjs — the decision layer inside a gate round (#127): pre-sort a
 * round's content-diff and visual-diff flags with the `flag-justify` battery so the agent works the
 * decisive defects first, does not spend a turn on a decisive artefact, and sees which flags are
 * genuinely unsure. Called by gate.sh --full after the probes when $STARDUST_DECIDER is not off;
 * runnable by hand on any recorded round.
 *
 *   node gate-flags.mjs <gate-dir> <label> [--regime prototype|published] [--register <md>] [--round]
 *                       [--mode off|shadow|assist|gate] [--concurrency 6] [--json] [--dry-run]
 *
 * --round (fix-loop assist): also read the round's own evidence — pixel-<label>.txt (verdict + band
 * table), verdict-<label>.txt (the probe verdict lines), anchor-live.txt + anchor-proto-<label>.txt,
 * chrome-parity-<label>.txt — and print two more advisory lines: `decide: round …` (valid-round: is
 * this a measurement that should count against the cap?) and `decide: pattern …` (fix-pattern: the
 * catalogue pattern for the first hot section, with its probability). Missing evidence files skip the
 * line they feed; nothing here is a verdict.
 *
 * Reads <gate-dir>/content-diff-<label>.txt and visual-diff-<label>.txt; one state per flag line
 * ({ flag: { probe, line, severity }, gate: { page, width, regime, summary }, policy }). The policy is
 * the capture-state policy in this file plus the project's inconsistency register when --register
 * (default stardust/replica/inconsistency-register.md) exists. Writes <gate-dir>/flags-<label>.json and
 * prints, on stdout, verdict-shaped lines the loop can read:
 *   decide: flags <n> — defect ≥0.85: <k> · not a defect ≤0.15: <m> · unsure: <u>   [<mode>]
 *   decide:   defect 0.95  🔴 MISSING CTA …            (decisive defects first, highest P first)
 *   decide:   unsure 0.54  …
 *   decide:   artefact 0.06  🟡 MISSING BODY … JSON-LD  (decisive not-a-defect last)
 * Never affects the round's exit code: off / no key → one skip line, exit 0; a failed call is counted.
 * Exit codes: 0 · 2 usage (missing dir or no probe files for the label).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const IS_MAIN = !!(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (IS_MAIN && (argv.length === 0 || argv.includes('--help') || argv.includes('-h'))) {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8'); const m = src.match(/\/\*\*[\s\S]*?\*\//);
  console.log(m ? m[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'usage: gate-flags.mjs'); process.exit(0);
}
async function sibling(name) {
  for (const c of [join(HERE, '..', '..', 'stardust', 'scripts', name), join(HERE, '..', 'stardust', name)]) if (existsSync(c)) return import(c);
  throw new Error(`${name} not found beside this script (copy skills/stardust/scripts/ to stardust/scripts/stardust/)`);
}

export const POLICY = 'Capture-state policy: content that varies between loads of the origin (carousel slides, rotating offers, personalised rails, tickers, dates, hydration placeholders) is replicated at its captured state and recorded, not chased. Heuristic notes: object-fit images inside fixed boxes read as stretched; lazy images below the fold may not have loaded when sampled; JSON-LD and script bodies are machine-only text. Fonts: a licensed face may be substituted by a metric-matched one. The inconsistency register is empty unless stated: no design change is permitted.';
const FLAG_LINE = /^\s*(🔴|🟠|🟡|⚠|STRETCHED|IMAGE DID NOT LOAD|BLANK|MISSING|EXTRA|HIDDEN)/u;
export const DECISIVE_YES = 0.85; export const DECISIVE_NO = 0.15;

export function flagLines(text) { return text.split('\n').filter((l) => FLAG_LINE.test(l.trim())).map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l.length > 8); }
export function probeSummary(text) { return text.split('\n').filter((l) => /^\s*(source|build|editable texts|Findings|Content diff|Visual diff)/.test(l)).map((l) => l.trim()).slice(0, 6).join('\n'); }
export const severityOf = (line) => (line.startsWith('🔴') ? 'red' : line.startsWith('🟠') ? 'orange' : line.startsWith('🟡') ? 'yellow' : 'advisory');
const clip = (s, n) => { const cp = Array.from(String(s)); return cp.length > n ? `${cp.slice(0, n).join('')}…` : String(s); };

// gate dir name → { page, width }
export function gateName(dir) { const m = basename(dir).match(/^(.+)-(\d{3,4})$/); return m ? { page: m[1], width: Number(m[2]) } : { page: basename(dir), width: null }; }

export function buildStates(dir, label, { regime = 'prototype', register = null } = {}) {
  const { page, width } = gateName(dir); const out = []; const seen = new Set();
  for (const probe of ['content', 'visual']) {
    const f = join(dir, `${probe}-diff-${label}.txt`); if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf8'); const summary = probeSummary(text);
    for (const line of flagLines(text)) {
      if (seen.has(line)) continue; seen.add(line);
      out.push({ ref: `${page}@${width}/${label}/${probe}/${Array.from(line).slice(0, 40).join('')}`, state: { flag: { probe, line: clip(line, 400), severity: severityOf(line) }, gate: { page, width, regime, summary }, policy: register ? `${POLICY}\nInconsistency register:\n${clip(register, 1500)}` : POLICY } });
    }
  }
  return out;
}

// ---- --round: the valid-round and fix-pattern states from the round's evidence files ----------------
const readIf = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
const parseAnchors = (t) => Object.fromEntries([...t.matchAll(/^\s*y\s+(\d+)\s+h\s+(\d+)\s+(\S+)/gm)].map((m) => [m[3], { y: Number(m[1]), h: Number(m[2]) }]));
export function roundStates(dir, label, regime = 'prototype') {
  const { page, width } = gateName(dir);
  const pixel = readIf(join(dir, `pixel-${label}.txt`)); const verdicts = readIf(join(dir, `verdict-${label}.txt`)); const chrome = readIf(join(dir, `chrome-parity-${label}.txt`)).split('\n').filter((l) => /^(✗|✓)/.test(l)).slice(0, 4).join('\n');
  const pctM = pixel.match(/= ([\d.]+)%/); const dhM = pixel.match(/height delta (-?\d+)px/);
  const bands = pixel.split('\n').filter((l) => /^\s*y\s+\d+/.test(l)).map((l) => l.trim());
  const hot = bands.map((l) => ({ l, pct: Number((l.match(/([\d.]+)%/) || [0, 0])[1]) })).find((b) => b.pct > 15);
  const live = parseAnchors(readIf(join(dir, 'anchor-live.txt'))); const proto = parseAnchors(readIf(join(dir, `anchor-proto-${label}.txt`)) || readIf(join(dir, 'anchor-proto-final.txt')));
  const anchors = Object.keys(proto).map((k) => (live[k] ? `${k}: build top ${proto[k].y - live[k].y >= 0 ? '+' : ''}${proto[k].y - live[k].y} px, height ${proto[k].h - live[k].h >= 0 ? '+' : ''}${proto[k].h - live[k].h} px vs live` : `${k}: on the build only`)).slice(0, 14);
  const captureNotes = [...pixel.split('\n'), ...verdicts.split('\n')].filter((l) => /font|challenge|blocked|deadline|capture failed|stitched|wrap|seam|no verdict|BLANK/i.test(l)).slice(0, 8);
  const exitCodes = Object.fromEntries([...verdicts.matchAll(/^([a-z-]+): .*?(?:exit (\d+))?/gm)].map((m) => [m[1], m[2] ? Number(m[2]) : (/(DEADLINE|BLOCKED|ERROR)/.test(m[0]) ? 1 : 0)]));
  const valid = pixel || verdicts ? { round: { page, width, label, regime, verdict: [pixel.split('\n').find((l) => /differing pixels/.test(l)) || pixel.split('\n')[0], ...verdicts.split('\n').filter(Boolean)].filter(Boolean).slice(0, 12), captureNotes, exitCodes } } : null;
  const fix = anchors.length || bands.length ? { round: { page, width, label, regime, pixelPct: pctM ? Number(pctM[1]) : null, heightDelta: dhM ? Number(dhM[1]) : null, hotBand: hot ? hot.l : (bands[0] || null), anchors, sectionNames: Object.keys(proto), chrome: chrome || undefined, flags: flagLines(readIf(join(dir, `content-diff-${label}.txt`))).slice(0, 4).concat(flagLines(readIf(join(dir, `visual-diff-${label}.txt`))).slice(0, 2)), notes: captureNotes.slice(0, 3).join(' · ') || undefined } } : null;
  if (fix && !fix.round.sectionNames.length) fix.round.sectionNames = ['(no anchors)'];
  return { valid, fix };
}

export function sortFlags(results) {
  const P = (r) => r.answers.defect.noul;
  const decisiveDefect = results.filter((r) => P(r) >= DECISIVE_YES).sort((a, b) => P(b) - P(a));
  const notDefect = results.filter((r) => P(r) <= DECISIVE_NO).sort((a, b) => P(a) - P(b));
  const unsure = results.filter((r) => P(r) > DECISIVE_NO && P(r) < DECISIVE_YES).sort((a, b) => Math.abs(0.5 - P(a)) - Math.abs(0.5 - P(b)));
  return { decisiveDefect, unsure, notDefect };
}

async function main() {
  const [dirArg, label] = argv.filter((a) => !a.startsWith('--') && !['prototype', 'published', 'off', 'shadow', 'assist', 'gate'].includes(a) && !/^\d+$/.test(a)).slice(0, 2);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const o = { regime: val('--regime') || 'prototype', register: val('--register') || 'stardust/replica/inconsistency-register.md', mode: val('--mode'), concurrency: Number(val('--concurrency') || 6), json: argv.includes('--json'), dryRun: argv.includes('--dry-run') };
  if (!dirArg || !label) { console.error('gate-flags: needs <gate-dir> <label>'); return 2; }
  const dir = resolve(dirArg);
  if (!existsSync(dir)) { console.error(`gate-flags: ${dir} not found`); return 2; }
  const D = await sibling('decide.mjs');
  let mode = 'off'; try { mode = D.normaliseMode(o.mode) || D.wiredMode(); } catch (e) { console.error(`gate-flags: ${e.message}`); return 2; }
  if (mode === 'off') { console.log('decide: flags — decider off (set STARDUST_DECIDER=shadow to pre-sort the flags)'); return 0; }
  const register = existsSync(o.register) ? readFileSync(o.register, 'utf8') : null;
  const items = buildStates(dir, label, { regime: o.regime, register });
  if (!items.length) { const any = ['content', 'visual'].some((p) => existsSync(join(dir, `${p}-diff-${label}.txt`))); if (!any) { console.error(`gate-flags: no content-diff-${label}.txt or visual-diff-${label}.txt in ${dir}`); return 2; } console.log(`decide: flags 0 — nothing to sort [${mode}]`); return 0; }
  if (o.dryRun) { console.log(JSON.stringify({ mode, flags: items.length, sample: items[0] }, null, 2)); return 0; }
  const key = process.env[D.DEFAULTS.keyEnv];
  if (!key) { console.log(`decide: flags ${items.length} — no $${D.DEFAULTS.keyEnv}, not sorted`); return 0; }
  const battery = D.loadBattery('flag-justify'); const client = D.createClient({ key, concurrency: o.concurrency });
  const ledger = join(dirname(dirname(dirname(dir))), 'decisions.jsonl'); // <stardust>/replica/gates/<slug-w> → <stardust>/decisions.jsonl
  const cacheDir = join(dirname(ledger), '.work', 'decide');
  const runId = D.resolveRunId(null, dirname(dirname(ledger)));
  const results = []; let errors = 0;
  await Promise.all(items.map(async (it) => { try { const r = await D.decide({ battery, state: it.state, client, cacheDir, ledger, ref: it.ref, mode, runId }); results.push({ ...r, line: it.state.flag.line, probe: it.state.flag.probe }); } catch (e) { errors += 1; } }));
  const { decisiveDefect, unsure, notDefect } = sortFlags(results);
  writeFileSync(join(dir, `flags-${label}.json`), JSON.stringify({ _provenance: { writtenBy: 'stardust:replica/gate-flags', writtenAt: new Date().toISOString(), mode, runId, regime: o.regime }, thresholds: { defect: DECISIVE_YES, notDefect: DECISIVE_NO }, flags: results.map((r) => ({ probe: r.probe, line: r.line, defect: r.answers.defect.noul, artefact: r.answers.artefact ? r.answers.artefact.noul : null, intended: r.answers.intended ? r.answers.intended.noul : null, route: r.route.overall })), errors }, null, 2));
  if (o.json) { console.log(JSON.stringify({ mode, flags: results.length, decisiveDefect: decisiveDefect.length, unsure: unsure.length, notDefect: notDefect.length, errors })); return 0; }
  console.log(`decide: flags ${items.length} — defect ≥${DECISIVE_YES}: ${decisiveDefect.length} · not a defect ≤${DECISIVE_NO}: ${notDefect.length} · unsure: ${unsure.length}${errors ? ` · errors ${errors}` : ''}   [${mode}] → ${join(dirArg, `flags-${label}.json`)}`);
  const show = (tag, r) => console.log(`decide:   ${tag.padEnd(9)}${r.answers.defect.noul.toFixed(2)}  ${clip(r.line, 150)}`);
  for (const r of decisiveDefect) show('defect', r);
  for (const r of unsure) show('unsure', r);
  for (const r of notDefect) show('artefact', r);
  if (argv.includes('--round')) await roundLines(dir, label, o, D, client, { cacheDir, ledger, mode, runId });
  return 0;
}

async function roundLines(dir, label, o, D, client, ctx) {
  const { valid, fix } = roundStates(dir, label, o.regime);
  if (valid) {
    try {
      const r = await D.decide({ battery: D.loadBattery('valid-round'), state: valid, client, cacheDir: ctx.cacheDir, ledger: ctx.ledger, ref: `${gateName(dir).page}@${gateName(dir).width}/${label}/round`, mode: ctx.mode, runId: ctx.runId });
      const P = (q) => (r.answers[q] ? r.answers[q].noul.toFixed(2) : '?');
      const counts = r.answers.counts_as_iteration ? r.answers.counts_as_iteration.noul : 1;
      console.log(`decide: round — counts as an iteration ${P('counts_as_iteration')} · instrument invalidated ${P('instrument_invalidated')} · origin unsettled ${P('origin_unsettled')} · fonts fallback ${P('fonts_fallback_loaded')}${counts < 0.3 ? ' → likely NOT a valid round: name the cause in the ledger, do not spend the cap' : ''}`);
    } catch (e) { console.log(`decide: round — not judged (${e.message})`); }
  }
  if (fix) {
    try {
      const r = await D.decide({ battery: D.loadBattery('fix-pattern'), state: fix, client, cacheDir: ctx.cacheDir, ledger: ctx.ledger, ref: `${gateName(dir).page}@${gateName(dir).width}/${label}/pattern`, mode: ctx.mode, runId: ctx.runId });
      const p = r.answers.pattern; const sct = r.answers.first_hot_section;
      const alt = Object.entries(p.probabilities || {}).sort((a, b) => b[1] - a[1]).slice(1, 3).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
      console.log(`decide: pattern — ${p.choice} (${p.confidence.toFixed(2)}${alt ? `; then ${alt}` : ''}) at ${sct ? `${sct.choice} (${sct.confidence.toFixed(2)})` : 'n/a'} — a hint for the next fix, never the fix itself`);
    } catch (e) { console.log(`decide: pattern — not judged (${e.message})`); }
  }
}

if (IS_MAIN) main().then((c) => process.exit(c)).catch((e) => { console.error(`gate-flags: ${e.message}`); process.exit(0); });
