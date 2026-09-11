#!/usr/bin/env node
/**
 * dynamics-plan.mjs — stardust:dynamics Phase 3 (triage draft).
 *
 * Turns `_dynamics.json` into a draft inventory: one row per finding with the
 * four axes pre-filled from the catalogue (class · disposition · reproducibility
 * · status) plus pattern, phase and the owner decision it needs. Two probes
 * sharpen the draft when a target exists:
 *   --target-origin <eds host>   GET every recorded first-party API path on the
 *                                target; 4xx / network error → `hostBound`
 *   --migrated <dir>             scan migrated HTML for the feature's evidence
 *                                tokens → `alreadyDelivered` (never rebuild what
 *                                the capture pipeline already shipped)
 * Output: `dynamic-features.generated-plan.md` + `.json`. The run curates it
 * into `stardust/dynamic-features.md` (reference/triage.md).
 *
 *   node dynamics-plan.mjs [--in stardust/current/_dynamics.json] [--out stardust/dynamics]
 *        [--target-origin https://…] [--auth-header "token …" | --token-env SITE_TOKEN] [--migrated stardust/migrated]
 */
/* eslint-disable no-await-in-loop, no-restricted-syntax, max-len */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { arg, readJSON, writeJSON, writeText, provenance, resolveAuthHeader, probe } from './lib.mjs';

const IN = arg('in', 'stardust/current/_dynamics.json');
const OUT = arg('out', 'stardust/dynamics');
const TARGET = arg('target-origin');
const MIGRATED = arg('migrated');
const d = readJSON(IN);
const probed = Object.keys(d.pages).length;

// catalogue: first matching rule wins. disposition ∈ rebuild-native | index-backed | data-fed | embed-passthrough | client-only | static-snapshot | decided-out
// reproducibility ∈ self | needs-credential | needs-human-capture | needs-backend | needs-business-decision (reference/triage.md)
const RULES = [
  { when: (f) => f.class === 'S' && /site search form/.test(f.feature), pattern: 'search-index-backed', disposition: 'index-backed', repro: 'self', phase: 'search', decision: 'results page scope (second corpora stay out)' },
  { when: (f) => f.class === 'S' && /first-party API/.test(f.feature), pattern: 'off-origin-data', disposition: 'data-fed', repro: 'needs-business-decision', phase: 'off-origin data', decision: 'datasource ownership / same-origin routing on production' },
  { when: (f) => f.class === 'S', pattern: 'search-index-backed', disposition: 'index-backed', repro: 'self', phase: 'search', decision: 'replace the hosted search service?' },
  { when: (f) => f.class === 'A' && /first-party API/.test(f.feature) && /auth|session|login|shortlist|cart|basket|account/i.test(f.feature), pattern: 'decided-out', disposition: 'decided-out', repro: 'needs-backend', phase: 'register', decision: 'none (session-bound off-origin)' },
  { when: (f) => f.class === 'A' && /first-party API/.test(f.feature), pattern: 'off-origin-data', disposition: 'data-fed', repro: 'needs-business-decision', phase: 'off-origin data', decision: 'which tier for the target host; consumer on the migrated pages?' },
  { when: (f) => f.class === 'D', pattern: 'sheet-sync', disposition: 'data-fed', repro: 'self', phase: 'data', decision: 'none (sync from the source origin)' },
  { when: (f) => f.class === 'A' && /settings object/.test(f.feature), pattern: 'read-settings', disposition: 'static-snapshot', repro: 'self', phase: 'detect', decision: '— (keys name endpoints, ids, vendors)' },
  { when: (f) => f.class === 'A' && /experimentation/.test(f.feature), pattern: 'consent-gated-tags', disposition: 'embed-passthrough', repro: 'needs-business-decision', phase: 'tags', decision: 'which experiments move to the new host' },
  { when: (f) => f.class === 'A', pattern: 'inspect', disposition: 'static-snapshot', repro: 'needs-human-capture', phase: 'detect', decision: 'inspect the XHR, add a vendor row' },
  { when: (f) => f.class === 'T' && /consent/.test(f.feature), pattern: 'consent-gated-tags', disposition: 'embed-passthrough', repro: 'needs-business-decision', phase: 'tags', decision: 'CMP domain script reuse on the new host' },
  { when: (f) => f.class === 'T' && /mount/.test(f.feature), pattern: 'embed-passthrough', disposition: 'embed-passthrough', repro: 'needs-credential', phase: 'embeds', decision: 'vendor account ids stay the owner\'s' },
  { when: (f) => f.class === 'T', pattern: 'consent-gated-tags', disposition: 'embed-passthrough', repro: 'needs-business-decision', phase: 'tags', decision: 'which tags run on the new host; property ids' },
  { when: (f) => f.class === 'F' && /client-compute/.test(f.hint || ''), pattern: 'client-compute', disposition: 'client-only', repro: 'self', phase: 'client tools', decision: 'none' },
  { when: (f) => f.class === 'F' && /form backend|form protection/.test(f.feature), pattern: 'forms', disposition: 'rebuild-native', repro: 'needs-backend', phase: 'forms', decision: 'production backend (vendor form id + field mapping)' },
  { when: (f) => f.class === 'F', pattern: 'forms', disposition: 'rebuild-native', repro: 'needs-backend', phase: 'forms', decision: 'production endpoint; interim capture ships now' },
  { when: (f) => f.class === 'M' && /chrome only/.test(f.feature), pattern: 'chrome-interaction', disposition: 'rebuild-native', repro: 'self', phase: 'interactive', decision: 'none (motion-observe evidence)' },
  { when: (f) => f.class === 'M', pattern: 'modal-loader', disposition: 'rebuild-native', repro: 'self', phase: 'interactive', decision: 'none' },
  { when: (f) => f.class === 'V' && /iframe without src/.test(f.feature), pattern: 'embed-passthrough', disposition: 'embed-passthrough', repro: 'needs-human-capture', phase: 'embeds', decision: 'resolve the runtime src from a rendered capture' },
  { when: (f) => f.class === 'V', pattern: 'media-as-url', disposition: 'embed-passthrough', repro: 'self', phase: 'media', decision: 'none (player ids are public)' },
  { when: (f) => f.class === 'L', pattern: 'listing-index-backed', disposition: 'index-backed', repro: 'needs-business-decision', phase: 'listings', decision: 'index-driven or editorially curated?' },
  { when: (f) => f.class === 'X', pattern: 'decided-out', disposition: 'decided-out', repro: 'needs-backend', phase: 'register', decision: 'auth / commerce on the new host?' },
  { when: (f) => f.class === 'I18N', pattern: 'locale-tree', disposition: 'rebuild-native', repro: 'needs-business-decision', phase: 'locale wave', decision: 'scope of the locale trees' },
  { when: (f) => f.class === 'CR' && /main empty at load/.test(f.feature), pattern: 'client-rendered-page', disposition: 'static-snapshot', repro: 'needs-human-capture', phase: 'capture', decision: 'human-browser capture; never migrate blank' },
  { when: (f) => f.class === 'CR', pattern: 'settled-dom-snapshot', disposition: 'static-snapshot', repro: 'self', phase: 'capture', decision: 'inspect the consumer' },
];
const PII = /ssn|social.?security|dob|date.?of.?birth|passport|account.?number|iban|card.?number|cvv|minor|guardian|upload/i;

/* ---------------------------------------------------- target-host probe -- */
const hostBound = {};
if (TARGET && TARGET !== true) {
  const auth = resolveAuthHeader();
  const apis = d.findings.filter((f) => f.api);
  for (const f of apis) {
    const r = await probe(`${TARGET.replace(/\/$/, '')}${f.api.path.replace(/\{[a-z]+\}/g, '1')}`, { headers: auth ? { authorization: auth } : {} });
    hostBound[f.id] = r.ok ? `served (${r.status})` : `dead on target (${r.status || r.error})`;
  }
}

/* ------------------------------------------- reconcile against output -- */
const delivered = {};
if (MIGRATED && MIGRATED !== true && existsSync(MIGRATED)) {
  const files = []; const walk = (dir) => { for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) walk(p); else if (/\.html?$/.test(e)) files.push(p); } }; walk(MIGRATED);
  const corpus = files.map((f) => readFileSync(f, 'utf8'));
  for (const f of d.findings) {
    const tokens = (f.evidence || []).map((e) => String(e).replace(/^(GET|POST) /, '').split(' → ')[0]).filter((t) => t.length > 6 && !/^[\d,.]+$/.test(t));
    const hit = tokens.find((t) => corpus.some((c) => c.includes(t)));
    if (hit) delivered[f.id] = `output already carries "${hit.slice(0, 40)}"`;
  }
}

/* ---------------------------------------------------------------- rows -- */
const rows = d.findings.map((f) => {
  const rule = RULES.find((r) => r.when(f)) || { pattern: 'inspect', disposition: 'static-snapshot', repro: 'needs-human-capture', phase: 'detect', decision: 'inspect' };
  const pii = f.class === 'F' && PII.test((f.signature || []).join(' ') + (f.evidence || []).join(' '));
  const row = {
    id: f.id, class: f.class, feature: f.feature, pages: f.pages.length, probed, reach: f.reach || null, evidence: (f.evidence || []).slice(0, 4),
    pattern: rule.pattern, disposition: rule.disposition, reproducibility: pii ? 'needs-business-decision' : rule.repro, status: 'pending', phase: rule.phase, decision: rule.decision,
  };
  if (pii) row.flags = ['regulated-pii: never auto-wire; submission blocked until a human configures the secured endpoint'];
  if (hostBound[f.id]) { row.hostBound = hostBound[f.id]; if (/dead/.test(row.hostBound)) row.disposition = 'data-fed'; }
  if (delivered[f.id]) { row.alreadyDelivered = delivered[f.id]; row.status = 'delivered-by-capture'; }
  return row;
});
const draft = { _provenance: provenance('plan', { input: IN, target: TARGET || null, migrated: MIGRATED || null }), rows };
writeJSON(join(OUT, 'dynamic-features.generated-plan.json'), draft);

const byPhase = {}; for (const r of rows) byPhase[r.phase] = (byPhase[r.phase] || 0) + 1;
const self = rows.filter((r) => r.reproducibility === 'self' && r.status === 'pending');
const batch = rows.filter((r) => r.reproducibility !== 'self' && r.status === 'pending' && r.disposition !== 'decided-out');
const md = [
  `<!-- stardust provenance: skill=stardust:dynamics · phase=plan draft · ${draft._provenance.writtenAt} · input ${IN} (${probed} pages, ${rows.length} findings)${TARGET ? ` · target probe ${TARGET}` : ''}${MIGRATED ? ` · reconciled against ${MIGRATED}` : ''} -->`,
  '# Dynamic features — draft inventory (curate into `stardust/dynamic-features.md`)', '',
  'One row per detected finding. Merge duplicates, drop noise, keep every axis honest. Columns: disposition = what we do · reproducibility = what it needs · status = where it stands (reference/triage.md).', '',
  '| # | id | class | feature | pages | disposition | reproducibility | status | pattern | decision needed | notes |', '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r, i) => `| ${i + 1} | ${r.id} | ${r.class} | ${r.feature.replace(/\|/g, '/')} | ${r.pages}/${r.probed}${r.reach ? ` (reach ${r.reach.pages}/${r.reach.of})` : ''} | ${r.disposition} | ${r.reproducibility} | ${r.status} | ${r.pattern} | ${r.decision} | ${[r.hostBound && `**${r.hostBound}**`, r.alreadyDelivered, ...(r.flags || [])].filter(Boolean).join('; ')} |`),
  '', '## Triage', '',
  `- **Ships autonomously (reproducibility \`self\`):** ${self.length} row(s) — ${[...new Set(self.map((r) => r.pattern))].join(', ') || 'none'}.`,
  `- **One owner decision batch:** ${batch.length} row(s) — ${[...new Set(batch.map((r) => r.decision))].slice(0, 6).join(' · ') || 'none'}.`,
  `- **Already delivered by the capture pipeline:** ${rows.filter((r) => r.alreadyDelivered).length} row(s) — no work.`,
  `- **Host-bound on the target:** ${rows.filter((r) => /dead/.test(r.hostBound || '')).length} of ${Object.keys(hostBound).length} probed API paths — the off-origin data work.`,
  '', '## Phases', '', ...Object.entries(byPhase).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- **${k}** — ${n}`),
];
writeText(join(OUT, 'dynamic-features.generated-plan.md'), md.join('\n'));
console.error(`[dynamics] ${rows.length} rows → ${OUT}/dynamic-features.generated-plan.md · self ${self.length} · owner batch ${batch.length} · delivered ${Object.keys(delivered).length} · host-bound ${Object.values(hostBound).filter((v) => /dead/.test(v)).length}/${Object.keys(hostBound).length}`);
