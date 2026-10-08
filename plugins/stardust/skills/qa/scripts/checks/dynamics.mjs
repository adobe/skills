/**
 * qa/checks/dynamics.mjs — category H: dynamic parity (browser).
 *
 * Replays `stardust/dynamics/parity.json` (written by stardust:dynamics Phase 5)
 * against the live base through the dynamics replay engine — flows, not
 * presence. Findings:
 *   - parity-missing      error  the inventory (stardust/dynamic-features.md) exists but no parity file:
 *                                dynamics ran, Phase 5 never did. info when there is no inventory either.
 *   - parity-failed       error  a replayed flow did not complete
 *   - parity-env-limit    warn   a failed flow whose feature records an environment limit
 *   - parity-unchecked    warn   a form (class F) with a non-final status and no checks; info for other classes
 * A recorded run planned an embedded form, shipped a dead native one, and passed qa: no parity file
 * was written and both findings were info. Exported pure: `missingFinding`, `uncheckedFindings`.
 * The site secret (--auth-header / --token-env) rides an origin-scoped route
 * filter only — never context-wide.
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finding, readJSON } from '../lib.mjs';

export function missingFinding(file, inventory) {
  return inventory
    ? finding('dynamics', 'parity-missing', 'error', '', `${inventory} lists dynamic features but ${file} does not exist — dynamics Phase 5 never ran, so no flow was verified`)
    : finding('dynamics', 'parity-missing', 'info', '', `no dynamic parity file at ${file} — run stardust:dynamics (Phases 1–5) if this site was migrated with dynamic features`);
}

export function uncheckedFindings(features = []) {
  return features
    .filter((f) => !(f.checks || []).length && !['decided-out', 'delivered-by-capture', 'skipped-source-broken'].includes(f.status))
    .map((f) => finding('dynamics', 'parity-unchecked', f.class === 'F' ? 'warn' : 'info', '', `${f.feature} (${f.class}): status "${f.status}" with no replayable check${f.class === 'F' ? ' — a form needs a form-flow check' : ''}${f.owner ? ` — owner: ${f.owner}` : ''}`));
}

export async function run(ctx) {
  const { base, opts } = ctx;
  const file = opts.parity || 'stardust/dynamics/parity.json';
  if (!existsSync(file)) {
    const inventory = join(dirname(dirname(file)), 'dynamic-features.md');
    return [missingFinding(file, existsSync(inventory) ? inventory : null)];
  }
  const parity = readJSON(file);
  const here = dirname(fileURLToPath(import.meta.url));
  const { replay } = await import(pathToFileURL(join(here, '../../../dynamics/scripts/dynamics-check.mjs')).href);
  const results = await replay({ origin: base, parity, authHeader: opts.authHeader || null });
  const out = [];
  for (const r of results) {
    if (r.pass) continue;
    const ev = { check: r.type, detail: r.detail, thirdParty: r.thirdParty };
    if (r.environmentLimit) out.push(finding('dynamics', 'parity-env-limit', 'warn', '', `${r.feature}: ${r.type} failed under a recorded environment limit — ${r.environmentLimit}`, ev));
    else out.push(finding('dynamics', 'parity-failed', 'error', '', `${r.feature} (${r.class}): ${r.type} — ${r.detail}`, ev));
  }
  return [...out, ...uncheckedFindings(parity.features)];
}
