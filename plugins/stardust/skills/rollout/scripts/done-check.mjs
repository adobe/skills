#!/usr/bin/env node
/**
 * rollout/done-check.mjs — is the delivery complete? One verdict from the ledgers the run already
 * wrote, so "done" is computed once instead of re-derived by every reader.
 *
 * Usage: node stardust/scripts/rollout/done-check.mjs [--out stardust/rollout] [--ledger stardust/status.jsonl]
 *          [--live-host <host> | --offline] [--json]
 *   --out        rollout dir (default stardust/rollout): coverage/pages.json, optimize/findings.json, rollout.json
 *   --ledger     run-status ledger (default stardust/status.jsonl)
 *   --live-host  aem.live host or origin the delivered pages must answer 200 on (default rollout.json site.liveHost)
 *   --offline    skip the live probe; pages_not_live is not checked and the verdict says so
 *   --json       print { complete, gaps[], liveChecked } instead of one line per gap
 *
 * Gaps, one per line in this order; complete = none:
 *   pages_unfinished:N             coverage rows not yet verified (pending, content-pending, converting, deployed, stale)
 *   pages_failed:N: <paths>        rows failed, or whose published-origin gate (delivery.gate.pass) is false
 *   pages_not_live:N: <paths>      deployed or verified rows that do not answer 200 on the live host
 *   open_p1:N                      open or in-progress P1 findings in optimize/findings.json, source parity
 *                                  excluded — the optimize gate's own count
 *   rollout_incomplete             the last stardust:rollout I-dashboard ledger line is not an `end`
 *
 * Exit: 0 complete · 1 gaps · 2 usage (no coverage/pages.json; no live host and no --offline).
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, isSourceParity, publicUrl } from './lib.mjs';

const UNFINISHED = new Set(['pending', 'content-pending', 'converting', 'deployed', 'stale']);
const DELIVERED = new Set(['deployed', 'verified']);
const LIST_MAX = 20;

const statusOf = (p) => (p.delivery && p.delivery.status) || 'pending';
const pathOf = (p) => p.path || `/${p.slug}`;
const listed = (paths) => (paths.length > LIST_MAX ? `${paths.slice(0, LIST_MAX).join(', ')}, … (+${paths.length - LIST_MAX})` : paths.join(', '));

/** The rows that should answer on the live host. */
// probed at the URL EDS serves (a folder index at `/a/`): `/a` 404s on a plain site (some add a 301; neither is 200)
export const deliveredPaths = (pages) => pages.filter((p) => DELIVERED.has(statusOf(p))).map(publicUrl);

/** Is the rollout's final phase ended? The LAST I-dashboard line decides (a later `start` re-opens it). */
export function rolloutEnded(ledgerLines) {
  const dash = ledgerLines.filter((l) => l && l.skill === 'stardust:rollout' && l.phase === 'I-dashboard');
  return dash.length > 0 && dash[dash.length - 1].event === 'end';
}

/** Open P1 findings the optimize gate counts: open or in-progress, severity P1, not source parity. */
export const openP1 = (findings) => findings.filter((f) => (f.status === 'open' || f.status === 'in-progress')
  && f.severity === 'P1' && !isSourceParity(f));

/**
 * The verdict. `notLive` is the list of delivered paths the live probe found missing, or null when the
 * probe did not run (offline).
 */
export function doneGaps({ pages = [], findings = [], ledgerLines = [], notLive = null }) {
  const gaps = [];
  const unfinished = pages.filter((p) => UNFINISHED.has(statusOf(p)));
  if (unfinished.length) gaps.push(`pages_unfinished:${unfinished.length}`);
  const failed = pages.filter((p) => statusOf(p) === 'failed' || (p.delivery && p.delivery.gate && p.delivery.gate.pass === false));
  if (failed.length) gaps.push(`pages_failed:${failed.length}: ${listed(failed.map(pathOf))}`);
  if (notLive && notLive.length) gaps.push(`pages_not_live:${notLive.length}: ${listed(notLive)}`);
  const p1 = openP1(findings);
  if (p1.length) gaps.push(`open_p1:${p1.length}`);
  if (!rolloutEnded(ledgerLines)) gaps.push('rollout_incomplete');
  return { complete: gaps.length === 0, gaps, liveChecked: notLive !== null };
}

/** HEAD each path on the live host; returns the paths that do not answer 200. */
export async function probeLive(host, paths, { fetchImpl = fetch, concurrency = 8 } = {}) {
  const origin = /^https?:\/\//.test(host) ? host.replace(/\/$/, '') : `https://${host}`;
  const missing = [];
  let next = 0;
  async function worker() {
    while (next < paths.length) {
      const path = paths[next]; next += 1;
      let ok = false;
      try { ok = (await fetchImpl(`${origin}${path}`, { method: 'HEAD', redirect: 'manual' })).status === 200; } catch { ok = false; }
      if (!ok) missing.push(path);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return paths.filter((p) => missing.includes(p)); // input order, not completion order
}

export function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } });
}

async function main() {
  const argv = process.argv.slice(2);
  // --help prints this file's usage header, so an agent never reads the source to learn the flags.
  if (argv.includes('--help') || argv.includes('-h')) {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    const header = src.match(/\/\*\*[\s\S]*?\*\//);
    console.log(header ? header[0].replace(/^\/\*\*\s*|\s*\*\/$/g, '').replace(/^\s*\* ?/gm, '').trim() : 'no usage header');
    process.exit(0);
  }
  const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };
  const OUT = arg('out', 'stardust/rollout');
  const LEDGER = arg('ledger', 'stardust/status.jsonl');
  const OFFLINE = argv.includes('--offline');
  const JSON_OUT = argv.includes('--json');

  const pagesDoc = readJSON(join(OUT, 'coverage', 'pages.json'));
  if (!pagesDoc) { console.error(`rollout done-check: no ${join(OUT, 'coverage', 'pages.json')} — run inventory.mjs first.`); process.exit(2); }
  const config = readJSON(join(OUT, 'rollout.json'), {});
  const host = arg('live-host', config.site && config.site.liveHost);
  if (!OFFLINE && !host) { console.error('rollout done-check: need --live-host <host> (or rollout.json site.liveHost), or --offline.'); process.exit(2); }

  const pages = pagesDoc.pages || [];
  const findings = (readJSON(join(OUT, 'optimize', 'findings.json'), {}) || {}).findings || [];
  const notLive = OFFLINE ? null : await probeLive(host, deliveredPaths(pages));
  const verdict = doneGaps({ pages, findings, ledgerLines: readLedger(LEDGER), notLive });

  if (JSON_OUT) console.log(JSON.stringify(verdict));
  else {
    for (const g of verdict.gaps) console.log(g);
    console.log(`${verdict.complete ? '✓ complete' : `✗ ${verdict.gaps.length} gap(s)`}${verdict.liveChecked ? '' : ' (live probe skipped: --offline)'}`);
  }
  process.exit(verdict.complete ? 0 : 1);
}

const SELF = fileURLToPath(import.meta.url);
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) main();
