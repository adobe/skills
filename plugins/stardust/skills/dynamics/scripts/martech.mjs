/**
 * martech.mjs — the martech contract (reference/martech.md). Library, no CLI.
 * Inputs: the runtime script URLs dynamics-detect recorded per page, plus spec-martech evidence when present
 * (onetrust.json for consent categories, launch.json for the consent model and the rewrite sheet).
 * Vendor knowledge comes from vendors.json (`cmp`, `loaders`). The CMP and every route are written disabled;
 * a previous contract's owner choices (`enabled`, `category`, CMP id) survive a rebuild.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, registrable, slug, vendors } from './lib.mjs';

const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

export function readEvidence(dir) {
  const read = (f) => (existsSync(join(dir, f)) ? readJSON(join(dir, f)) : null);
  return { launch: read('launch.json'), onetrust: read('onetrust.json') || [] };
}

function consentOf(row, scripts, { launch, onetrust }, ruleSet) {
  const model = (launch?.rules || []).some((r) => r.consentGroups?.length) ? 'per-tag' : 'owner-decision';
  const categories = (ruleSet?.groups || []).map(({ id, name, status }) => ({ id, name, status }));
  const ruleSets = onetrust[0]?.ruleSets?.length || 0;
  if (!row) return { cmp: null, model, categories, ruleSets };
  const { src, idAttr, idFrom, groups = null, event = null } = row.cmp;
  const id = (/OneTrust/.test(row.role) && onetrust[0]?.domainScript)
    || (idFrom && scripts.map((s) => s.match(new RegExp(idFrom))?.[1]).find(Boolean)) || null;
  return {
    cmp: {
      vendor: row.role.replace(/^consent: /, ''), src, attrs: { [idAttr]: id }, groups, event,
      viaTagManager: (launch?.rules || []).some((r) => r.otDomainScripts?.length), enabled: false,
    },
    model, categories, ruleSets,
  };
}

function routesOf(row, scripts, groups) {
  const loader = row.loaders.map((l) => ({ ...l, hits: scripts.filter((s) => new RegExp(l.match, 'i').test(s)) })).find((l) => l.hits.length);
  if (!loader) return [];
  const vendor = row.role.replace(/^tag manager: /, '');
  return loader.hits.map((src, i) => {
    const site = registrable(hostOf(src));
    return {
      id: slug(loader.hits.length > 1 ? `${vendor}-${i + 1}` : vendor),
      vendor,
      src,
      boot: loader.boot || null,
      category: null,
      cmpGroups: groups.filter((g) => (g.hosts || []).some((h) => registrable(h) === site)).map((g) => g.id),
      enabled: false,
    };
  });
}

function rewriteOf(launch) {
  if (!launch) return { rules: [], dataElements: [] };
  return {
    rules: launch.rules
      .map((r) => ({ id: r.id, name: r.name, paths: (r.paths || []).filter((p) => /\.html?\b/.test(p)), selectors: r.selectors || [] }))
      .filter((r) => r.paths.length || r.selectors.length),
    dataElements: launch.dataElements.filter((d) => d.selectors?.length).map(({ name, selectors }) => ({ name, selectors })),
  };
}

function keepOwnerChoices(contract, previous) {
  const { cmp } = contract.consent;
  const was = previous.consent?.cmp;
  if (cmp && was?.vendor === cmp.vendor) {
    cmp.enabled = !!was.enabled;
    Object.keys(cmp.attrs).forEach((k) => { cmp.attrs[k] = was.attrs?.[k] || cmp.attrs[k]; });
  }
  contract.routes.forEach((r) => {
    const p = (previous.routes || []).find((x) => x.id === r.id);
    if (p) Object.assign(r, { enabled: !!p.enabled, category: p.category ?? null });
  });
  return contract;
}

export function buildContract({ dynamics, martech = { launch: null, onetrust: [] }, provenance, previous = null }) {
  const pages = Object.values(dynamics.pages || {});
  const scripts = [...new Set(pages.flatMap((p) => p.scripts || []))];
  const seen = vendors().filter((v) => scripts.some((s) => v.re.test(s)));
  const cmpRow = seen.find((v) => v.cmp);
  const ruleSets = martech.onetrust[0]?.ruleSets || [];
  const ruleSet = ruleSets.find((r) => r.default) || ruleSets[0];
  const routes = seen.filter((v) => v.loaders).flatMap((v) => routesOf(v, scripts, ruleSet?.groups || []));
  const routed = new Set(routes.map((r) => r.vendor));
  const contract = {
    _provenance: provenance,
    productionHosts: [...new Set(pages.map((p) => p.host).filter(Boolean))],
    consent: consentOf(cmpRow, scripts, martech, ruleSet),
    routes,
    otherTags: seen.filter((v) => ['T', 'A'].includes(v.class) && v !== cmpRow && !routed.has(v.role.replace(/^tag manager: /, ''))).map((v) => v.role),
    rewrite: rewriteOf(martech.launch),
  };
  return previous ? keepOwnerChoices(contract, previous) : contract;
}

const MODEL = {
  'per-tag': 'the source loads the tag manager ungated and gates each tag inside it by consent group. Keep it: leave every route `category` null.',
  'owner-decision': 'no evidence of consent gating inside the tag manager. Keep the source behaviour (route `category` null), or set a route `category` to a consent group id to load that tag manager only once the group is granted.',
};

export function renderHandoff(c) {
  const { cmp, model, categories, ruleSets } = c.consent;
  const id = cmp && Object.entries(cmp.attrs)[0];
  return [
    '# Martech hand-off',
    '',
    `Everything below is scaffolded **off**. To ship it, set \`enabled: true\` on \`consent.cmp\` and on each route in \`stardust/martech-contract.json\`, then re-run \`deploy/scripts/martech-scaffold.mjs\`. Enabled tags load on ${c.productionHosts.map((h) => `\`${h}\``).join(', ') || 'the production hosts'} only; preview with \`?martech=on\` (add \`&consent=accept\` to grant every category).`,
    '',
    '## Consent',
    '',
    `- **CMP:** ${cmp ? `${cmp.vendor} · \`${id[0]}\` = ${id[1] ? `\`${id[1]}\`` : '**not found — copy it from the CMP admin into the contract**'}` : 'none detected'}`,
    ...(cmp?.viaTagManager ? ['- **The tag manager injects the CMP on the source.** Leave `consent.cmp` disabled unless you remove that rule; enabling both loads it twice.'] : []),
    `- **Model \`${model}\`:** ${MODEL[model]}`,
    categories.length ? `- **Categories** (default rule set${ruleSets > 1 ? ` of ${ruleSets} geo rule sets — the CMP applies them, nothing to port` : ''}): ${categories.map((g) => `\`${g.id}\` ${g.name} (${g.status})`).join(' · ')}` : '- **Categories:** no CMP configuration read — run `spec-martech.mjs` first, or decide categories with the owner.',
    '',
    '## Routes',
    '',
    ...(c.routes.length
      ? ['| id | vendor | src | CMP groups listing its host | enabled |', '|---|---|---|---|---|', ...c.routes.map((r) => `| ${r.id} | ${r.vendor} | \`${r.src}\` | ${r.cmpGroups.join(', ') || '—'} | ${r.enabled} |`)]
      : ['No tag-manager loader seen on the probed pages.']),
    ...(c.otherTags.length ? ['', `Also seen, not routed (loaded by the tag manager or inline on the source — confirm each still fires): ${c.otherTags.join(' · ')}.`] : []),
    '',
    '## Rewrite before go-live',
    '',
    ...(c.rewrite.rules.length || c.rewrite.dataElements.length
      ? [
        'These read the old URLs or DOM and will not match the migrated pages:',
        ...c.rewrite.rules.map((r) => `- rule \`${r.id}\` ${r.name}${r.paths.length ? ` — paths ${r.paths.map((p) => `\`${p}\``).join(', ')}` : ''}${r.selectors.length ? ` — selectors ${r.selectors.map((s) => `\`${s}\``).join(', ')}` : ''}`),
        ...c.rewrite.dataElements.map((d) => `- data element \`${d.name}\` — selectors ${d.selectors.map((s) => `\`${s}\``).join(', ')}`),
      ]
      : ['Nothing found (or no tag-manager library read).']),
    '',
    'Moving to the Adobe Experience Platform Web SDK instead? The `aem-martech` plugin replaces these routes; that is an owner project, not part of the migration.',
  ].join('\n');
}
