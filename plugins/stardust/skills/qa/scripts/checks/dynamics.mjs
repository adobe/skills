/**
 * qa/checks/dynamics.mjs — category H: dynamic parity (browser).
 *
 * Replays `stardust/dynamics/parity.json` (written by stardust:dynamics Phase 5)
 * against the live base through the dynamics replay engine — flows, not
 * presence. Findings:
 *   - parity-missing      info   no parity file → the migration never ran dynamics; nothing to replay
 *   - parity-failed       error  a replayed flow did not complete
 *   - parity-env-limit    warn   a failed flow whose feature records an environment limit
 *   - parity-unchecked    info   a feature with a non-final status and no checks (owner item)
 * The site secret (--auth-header / --token-env) rides an origin-scoped route
 * filter only — never context-wide.
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finding, readJSON } from '../lib.mjs';

export async function run(ctx) {
  const { base, opts } = ctx;
  const file = opts.parity || 'stardust/dynamics/parity.json';
  if (!existsSync(file)) return [finding('dynamics', 'parity-missing', 'info', '', `no dynamic parity file at ${file} — run stardust:dynamics (Phases 1–5) if this site was migrated with dynamic features`)];
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
  for (const f of parity.features || []) {
    if ((f.checks || []).length) continue;
    if (['decided-out', 'delivered-by-capture', 'skipped-source-broken'].includes(f.status)) continue;
    out.push(finding('dynamics', 'parity-unchecked', 'info', '', `${f.feature} (${f.class}): status "${f.status}" with no replayable check${f.owner ? ` — owner: ${f.owner}` : ''}`));
  }
  return out;
}
