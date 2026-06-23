#!/usr/bin/env node
/**
 * rollout/findings.mjs — record/resolve findings from external audit sources.
 *
 * optimize.mjs runs the deterministic BASELINE source. The other sources are
 * existing audit skills run by the agent (impeccable:critique, impeccable:audit,
 * the marketing SEO skills, stardust:tensions). Their findings enter the SAME
 * ledger through this writer, so dedup, scorecard, gate, and autofix all apply
 * uniformly. See reference/audit-sources.md.
 *
 * Record:  node findings.mjs record --source <s> --layer <l> --check <c>
 *            --severity P1|P2|P3 --fixability platform-migration|design-pass|out-of-scope
 *            [--scope-level page|site|template|block] --scope-ids <a,b>
 *            --evidence "…" [--recommend "…"]
 * Resolve: node findings.mjs resolve <id> --status fixed|accepted|wontfix|open [--note "…"]
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJSON, writeJSON, computeScorecard, autofixFor, ALL_LAYERS } from './lib.mjs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
const cmd = process.argv[2];
const OUT = arg('out', 'stardust/rollout');
const findingsPath = join(OUT, 'optimize', 'findings.json');
const scorecardPath = join(OUT, 'optimize', 'scorecard.json');
const now = new Date().toISOString();
const version = (readJSON(join(OUT, 'rollout.json'), {})._provenance || {}).stardustVersion || '0.0.0';

function loadDoc() {
  return readJSON(findingsPath, { _provenance: { writtenBy: 'stardust:rollout', writtenAt: now, stardustVersion: version }, runs: [], findings: [] });
}
function persist(doc) {
  doc._provenance = { writtenBy: 'stardust:rollout/findings', writtenAt: now, stardustVersion: version };
  writeJSON(findingsPath, doc);
  const sc = readJSON(scorecardPath, { history: [] });
  const snap = computeScorecard(doc.findings, (doc.runs.at(-1) || {}).id || 'record', now);
  writeJSON(scorecardPath, { _provenance: { writtenBy: 'stardust:rollout/findings', writtenAt: now, stardustVersion: version }, current: snap, history: sc.history || [] });
  return snap;
}

if (cmd === 'record') {
  const source = arg('source', null);
  const layer = arg('layer', null);
  const check = arg('check', null);
  const severity = arg('severity', null);
  const fixability = arg('fixability', null);
  const level = arg('scope-level', 'page');
  const ids = (arg('scope-ids', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const evidence = arg('evidence', '');
  const recommendedMove = arg('recommend', '');
  const errs = [];
  if (!source) errs.push('--source required');
  if (!ALL_LAYERS.includes(layer)) errs.push(`--layer must be one of ${ALL_LAYERS.join('|')}`);
  if (!check) errs.push('--check required');
  if (!['P1', 'P2', 'P3'].includes(severity)) errs.push('--severity P1|P2|P3');
  if (!['platform-migration', 'design-pass', 'out-of-scope'].includes(fixability)) errs.push('--fixability platform-migration|design-pass|out-of-scope');
  if (!ids.length && level !== 'site') errs.push('--scope-ids required (or --scope-level site)');
  if (errs.length) { console.error(`record: ${errs.join('; ')}`); process.exit(2); }

  const scopeIds = ids.length ? ids : ['*'];
  const id = `f-${createHash('sha1').update(`${source}|${layer}|${check}|${level}|${[...scopeIds].sort().join(',')}`).digest('hex').slice(0, 10)}`;
  const doc = loadDoc();
  const existing = doc.findings.find((f) => f.id === id);
  if (existing && (existing.status === 'accepted' || existing.status === 'wontfix')) {
    console.log(`record: ${id} is ${existing.status} — left unchanged.`); process.exit(0);
  }
  const finding = {
    id, source, layer, check, severity, scope: { level, ids: scopeIds }, evidence, fixability, recommendedMove,
    status: 'open', autofix: (existing && existing.autofix) || autofixFor(check),
    resolvedBy: null, firstSeenRun: (existing && existing.firstSeenRun) || 'recorded',
  };
  doc.findings = [...doc.findings.filter((f) => f.id !== id), finding].sort((a, b) => a.id.localeCompare(b.id));
  const snap = persist(doc);
  console.log(`recorded ${id}  ${source} ${layer}/${check} ${severity}  → open   (health ${snap.overall}/100)`);
  process.exit(0);
}

if (cmd === 'resolve') {
  const id = process.argv[3];
  const status = arg('status', null);
  const note = arg('note', null);
  if (!id || !['fixed', 'accepted', 'wontfix', 'open', 'in-progress'].includes(status)) {
    console.error('resolve <id> --status fixed|accepted|wontfix|open|in-progress [--note "…"]'); process.exit(2);
  }
  const doc = loadDoc();
  const f = doc.findings.find((x) => x.id === id);
  if (!f) { console.error(`resolve: no finding ${id}`); process.exit(1); }
  f.status = status;
  f.resolvedBy = (status === 'fixed') ? { phase: 'rollout', at: now, note: note || 'manually resolved' } : f.resolvedBy;
  const snap = persist(doc);
  console.log(`${id} → ${status}   (health ${snap.overall}/100, open P1 ${snap.severity.P1})`);
  process.exit(0);
}

console.error('usage: findings.mjs record …   |   findings.mjs resolve <id> --status …');
process.exit(2);
