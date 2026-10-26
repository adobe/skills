/**
 * martech.mjs — the martech contract (reference/martech.md). Library, no CLI.
 * Inputs: the runtime script URLs dynamics-detect recorded per page, plus spec-martech evidence when present
 * (onetrust.json for consent categories, launch.json for the consent model and the rewrite sheet).
 * Vendor knowledge comes from vendors.json (`cmp`, `loaders`, `plugin`). The CMP, every route and the Web SDK
 * (`aemMartech`) are written disabled; a previous contract's owner choices (`enabled`, `category`, ids) and `tagNotes` survive a rebuild.
 * `tagNotes` is what the model read from a tag-manager library no script parses, keyed by tag manager, in Launch's shape:
 * { rules: [{ name, paths, selectors, events, consentGroups, from }], dataElements: [{ name, selectors, source, from }], notes }.
 * `from` cites where in the saved library the entry was read; entries without it are dropped.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, registrable, slug, vendors } from './lib.mjs';

const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

/** spec-martech evidence: its raw folder (launch.json, onetrust.json, consent-mode.json) or a spec's knowledge (martech.json#evidence). */
export function readEvidence(dir) {
  const read = (f) => (existsSync(join(dir, f)) ? readJSON(join(dir, f)) : null);
  const knowledge = read('martech.json')?.evidence;
  if (knowledge) return { launch: knowledge.launch || null, onetrust: knowledge.onetrust || [], consentMode: knowledge.consentMode || null };
  return { launch: read('launch.json'), onetrust: read('onetrust.json') || [], consentMode: read('consent-mode.json') };
}

/** Parsed evidence only: Launch rule consent groups, else a Google Consent Mode default on the pages. Never the model's reading. */
function consentOf(row, scripts, { launch, onetrust, consentMode = null }, ruleSet) {
  const model = (launch?.rules || []).some((r) => r.consentGroups?.length) ? 'per-tag'
    : consentMode?.pages ? 'google-consent-mode' : 'owner-decision';
  const categories = (ruleSet?.groups || []).map(({ id, name, status }) => ({ id, name, status }));
  const ruleSets = onetrust[0]?.ruleSets?.length || 0;
  const gcm = consentMode && (consentMode.pages || consentMode.libraries?.length) ? consentMode : null;
  if (!row) return { cmp: null, model, categories, ruleSets, consentMode: gcm };
  const { src, idAttr, idFrom, groups = null, event = null } = row.cmp;
  const id = (/OneTrust/.test(row.role) && onetrust[0]?.domainScript)
    || (idFrom && scripts.map((s) => s.match(new RegExp(idFrom))?.[1]).find(Boolean)) || null;
  return {
    cmp: {
      vendor: row.role.replace(/^consent: /, ''), src, attrs: { [idAttr]: id }, groups, event,
      viaTagManager: (launch?.rules || []).some((r) => r.otDomainScripts?.length), enabled: false,
    },
    model, categories, ruleSets, consentMode: gcm,
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
  if (!launch) return { library: null, rules: [], dataElements: [], dataLayer: [], dataLayerPaths: [] };
  return {
    rules: launch.rules
      .map((r) => ({ id: r.id, name: r.name, paths: (r.paths || []).filter((p) => /\.html?\b/.test(p)), selectors: r.selectors || [] }))
      .filter((r) => r.paths.length || r.selectors.length),
    dataElements: launch.dataElements.filter((d) => d.selectors?.length).map(({ name, selectors }) => ({ name, selectors })),
    library: 'Adobe Launch',
    dataLayer: launch.rules.filter((r) => (r.events || []).some((e) => /datalayer/i.test(e))).map(({ id, name, pushEvents }) => ({ id, name, events: pushEvents || [] })),
    dataLayerPaths: [...new Set(launch.dataElements.filter((d) => /datalayer/i.test(d.type || '') && d.source).map((d) => d.source))],
  };
}

/** The Web SDK seen on the source (Launch extension or page-level alloy) → aem-martech config, or null. */
function aemMartechOf(launch, scripts, routes) {
  const row = vendors().find((v) => v.plugin);
  const sdk = launch?.webSdk;
  const inst = sdk?.instances?.[0];
  if (!inst && !scripts.some((s) => row.re.test(s))) return null;
  const ids = inst?.datastream?.ids || [];
  const exts = launch?.extensions || [];
  return {
    plugin: row.plugin,
    config: {
      orgId: launch?.orgId || null,
      datastreamId: ids.length === 1 ? ids[0] : null,
      alloyInstanceName: inst?.name || 'alloy',
      edgeDomain: inst?.edgeDomain || null,
      defaultConsent: inst ? (inst.defaultConsent || row.plugin.sdkDefaultConsent) : null,
      launchUrls: routes.filter((r) => r.vendor === 'Adobe Launch').map((r) => r.src),
    },
    candidates: { datastreamId: ids, stagingDatastreamId: inst?.stagingDatastream?.ids || [] },
    extension: sdk ? { version: sdk.version, selfHostable: sdk.selfHostable, library: sdk.library } : null,
    missingExtensions: launch ? row.plugin.launchExtensions.filter((e) => !exts.includes(e)) : [],
    category: null,
    enabled: false,
  };
}

/** Adobe Target seen on the source (Launch at.js extension, page-level at.js, Web SDK decision rules) → contract entry, or null. */
function targetOf(launch, scripts) {
  const row = vendors().find((v) => v.target);
  const t = launch?.target;
  const page = scripts.find((s) => row.re.test(s));
  if (!t && !page) return null;
  return {
    atjs: t?.atjs ? { from: 'launch', extension: t.atjs } : page ? { from: 'page', src: page } : null,
    webSdk: t?.renderRules?.length ? { renderRules: t.renderRules, prehiding: t.prehiding } : null,
    enabled: false,
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
  const am = contract.aemMartech; const wasAm = previous.aemMartech;
  if (am && wasAm) {
    Object.assign(am, { enabled: !!wasAm.enabled, category: wasAm.category ?? null });
    Object.keys(am.config).forEach((k) => { if (wasAm.config?.[k] != null) am.config[k] = wasAm.config[k]; });
  }
  if (contract.target && previous.target) contract.target.enabled = !!previous.target.enabled;
  contract.tagNotes = { ...previous.tagNotes };
  return contract;
}

const list = (v) => (Array.isArray(v) ? v.map(String) : []);
/** tagNotes → the cited rules and data elements in Launch's shape, each tagged with its tag manager, plus the uncited count. */
export function modelRead(notes = {}) {
  const out = { rules: [], dataElements: [], dropped: 0 };
  for (const [vendor, n] of Object.entries(notes)) {
    if (!n || typeof n !== 'object') continue;
    for (const [key, rows] of [['rules', n.rules], ['dataElements', n.dataElements]]) {
      for (const r of Array.isArray(rows) ? rows : []) {
        if (!r?.from || !r?.name) { out.dropped += 1; continue; }
        out[key].push(key === 'rules'
          ? { vendor, name: String(r.name), paths: list(r.paths), selectors: list(r.selectors), events: list(r.events), consentGroups: list(r.consentGroups), from: String(r.from) }
          : { vendor, name: String(r.name), selectors: list(r.selectors), source: r.source ? String(r.source) : null, from: String(r.from) });
      }
    }
  }
  return out;
}

const DATA_LAYERS = ['adobeDataLayer', 'dataLayer', 'digitalData', 'utag_data'];

export function buildContract({ dynamics, martech = { launch: null, onetrust: [] }, provenance, previous = null }) {
  const pages = Object.values(dynamics.pages || {});
  const scripts = [...new Set(pages.flatMap((p) => p.scripts || []))];
  const seen = vendors().filter((v) => scripts.some((s) => v.re.test(s)));
  const cmpRow = seen.find((v) => v.cmp);
  const ruleSets = martech.onetrust[0]?.ruleSets || [];
  const ruleSet = ruleSets.find((r) => r.default) || ruleSets[0];
  const routes = seen.filter((v) => v.loaders).flatMap((v) => routesOf(v, scripts, ruleSet?.groups || []));
  const routed = new Set(routes.map((r) => r.vendor));
  const target = targetOf(martech.launch, scripts);
  const contract = {
    _provenance: provenance,
    productionHosts: [...new Set(pages.map((p) => p.host).filter(Boolean))],
    consent: consentOf(cmpRow, scripts, martech, ruleSet),
    routes,
    otherTags: seen.filter((v) => ['T', 'A'].includes(v.class) && v !== cmpRow && !routed.has(v.role.replace(/^tag manager: /, '')) && !(target && v.target)).map((v) => v.role),
    tagManagers: seen.filter((v) => /^tag manager: /.test(v.role)).map((v) => v.role.replace(/^tag manager: /, '')),
    dataLayers: [...new Set([...DATA_LAYERS.filter((k) => pages.some((p) => p.cms?.[k] !== undefined)),
      ...scripts.map((x) => /googletagmanager\.com\/(?:gtm\.js|gtag\/js)\?.*[?&]l=([\w$]+)/.exec(x)?.[1]).filter(Boolean)])],
    tagNotes: {},
    rewrite: rewriteOf(martech.launch),
    aemMartech: aemMartechOf(martech.launch, scripts, routes),
    target,
  };
  return previous ? keepOwnerChoices(contract, previous) : contract;
}

const MODEL = {
  'per-tag': 'the source loads the tag manager ungated and gates each tag inside it by consent group. Keep it: leave every route `category` null.',
  'google-consent-mode': 'the source sets Google Consent Mode defaults inline (`gtag(\'consent\', \'default\', …)`), loads Google Tag Manager ungated, and the CMP updates the consent state; Google tags adapt to it. Keep it: leave every route `category` null (gating GTM on a category would drop its cookieless pings), and copy the inline consent default into `head.html` ahead of the tag manager — without it Google tags run with no default.',
  'owner-decision': 'no evidence of consent gating inside the tag manager. Keep the source behaviour (route `category` null), or set a route `category` to a consent group id to load that tag manager only once the group is granted.',
};

const BY_MODEL = ' (read by the model, not parsed)';
const evName = (e) => (e === '*' ? 'any push' : e ? `\`${e}\`` : 'an event the rule settings do not name');

const where = (r) => `${r.paths.length ? ` — paths ${r.paths.map((p) => `\`${p}\``).join(', ')}` : ''}${r.selectors.length ? ` — selectors ${r.selectors.map((s) => `\`${s}\``).join(', ')}` : ''}`;
const cite = (r) => ` — read by the model at ${r.from}`;
const eventsLine = (who, rules) => {
  const count = new Map();
  rules.forEach((r) => (r.events?.length ? r.events : [null]).forEach((e) => count.set(e, (count.get(e) || 0) + 1)));
  return `${who} rules fire on data-layer pushes; the migrated pages must push the same events: ${[...count].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${evName(e)} (${n})`).join(' · ')}.`;
};

function dataLayerHandoff({ rewrite: { library = null, dataLayer = [], dataLayerPaths = [] } = {}, tagManagers = [], dataLayers = [], tagNotes = {} }) {
  const read = modelRead(tagNotes);
  const pushed = read.rules.filter((r) => r.events.length);
  const paths = [...new Set([...dataLayerPaths, ...read.dataElements.map((d) => d.source).filter(Boolean)])];
  if (!dataLayer.length && !pushed.length && !tagManagers.length && !dataLayers.length) return [];
  const unread = tagManagers.filter((t) => t !== library && !tagNotes[t] && !tagNotes[slug(t)]);
  const vendors = [...new Set(pushed.map((r) => r.vendor))];
  return [
    '', '## Data layer', '',
    ...(dataLayers.length ? [`The source pages expose ${dataLayers.map((d) => `\`${d}\``).join(', ')}; keep the same global names.`] : []),
    ...(dataLayer.length ? [eventsLine(library, dataLayer)] : []),
    ...vendors.map((v) => eventsLine(`${v}${BY_MODEL}`, pushed.filter((r) => r.vendor === v))),
    ...(paths.length ? [`Data elements read these data-layer paths: ${paths.map((p) => `\`${p}\``).join(', ')}.`] : []),
    ...(unread.length ? [`Rules in ${unread.join(', ')} were not parsed. Read each library listed in \`martech/tags.json\` and record its rules and data elements in the contract's \`tagNotes\`, keyed by tag manager, each citing where it was read (\`from\`); until then their triggers and events come from the tagging plan.`] : []),
    'Ask the owner for the tagging plan (solution design reference): each event, its payload and the interaction that pushes it. With it, add each push in the block that owns the interaction.',
    ...(dataLayer.length || pushed.length ? [''] : []),
    ...dataLayer.map((r) => `- rule \`${r.id}\` ${r.name} — listens for ${(r.events?.length ? r.events : [null]).map(evName).join(', ')}`),
    ...pushed.map((r) => `- ${r.vendor} rule ${r.name} — listens for ${r.events.map(evName).join(', ')}${cite(r)}`),
  ];
}

function tagNotesHandoff(notes = {}) {
  const { dropped } = modelRead(notes);
  const free = Object.entries(notes).map(([v, n]) => [v, typeof n === 'string' ? n : n?.notes]).filter(([, md]) => md);
  if (!free.length && !dropped) return [];
  return [
    '', '## Tag-manager notes (read by the model, not parsed)',
    ...free.flatMap(([vendor, md]) => (Array.isArray(md)
      ? ['', `**${vendor}:**`, ...md.map((m) => `- ${String(m).trim()}`)]
      : ['', `**${vendor}:** ${String(md).trim()}`])),
    ...(dropped ? ['', `${dropped} \`tagNotes\` ${dropped === 1 ? 'entry' : 'entries'} without a name or a \`from\` citation ${dropped === 1 ? 'was' : 'were'} left out; add where in the library each was read.`] : []),
    '', 'Confirm everything read by the model against the owner\'s tagging plan.',
  ];
}

function webSdkHandoff(a) {
  if (!a) return [];
  const { config: k, extension: x } = a;
  const val = (v) => (v ? `\`${v}\`` : '**not found — fill it in the contract**');
  return [
    '', '## Web SDK (aem-martech)', '',
    `The source runs the Adobe Experience Platform Web SDK${x ? ` from the Launch extension ${x.version} (${x.library} library${x.selfHostable ? ', self-hosted build supported' : ', no self-hosted option — upgrade the extension first'})` : ' outside Launch'}. The \`${a.plugin.name}\` plugin can load it on the migrated site instead. It is off; the routes above stay the default.`,
    '',
    `- **orgId:** ${val(k.orgId)} · **instance:** \`${k.alloyInstanceName}\` · **edge domain:** ${val(k.edgeDomain)}`,
    `- **datastreamId:** ${k.datastreamId ? `\`${k.datastreamId}\`` : a.candidates.datastreamId.length ? `the Launch data element picks one of ${a.candidates.datastreamId.map((d) => `\`${d}\``).join(', ')} at runtime — choose one` : val(null)}`,
    `- **defaultConsent:** source ${k.defaultConsent ? `\`${k.defaultConsent}\`` : 'unknown'}; the plugin defaults to \`pending\` and sends nothing until \`updateUserConsent\`. With \`aemMartech.category\` set, the scaffold starts the SDK \`pending\` whatever this value and grants \`collect\` once the CMP grants that group; without a category, this value applies as is. Launch rules that call \`setConsent\` on the source are not read — set the category to keep a consent gate.`,
    ...(a.missingExtensions.length ? [`- **Missing Launch extension:** ${a.missingExtensions.join(', ')} — the plugin requires it.`] : []),
    '',
    'To switch: (1) `git subtree add --squash --prefix ' + `${a.plugin.path} ${a.plugin.repo} main\`; (2) in Launch, set the Web SDK extension to the self-hosted build with the same instance name and publish — otherwise the SDK loads twice; (3) set \`aemMartech.enabled\` and leave the \`adobe-launch\` route disabled (the plugin loads \`launchUrls\`); (4) re-run the scaffold.`,
  ];
}

function targetHandoff(t) {
  if (!t) return [];
  const { atjs: a, webSdk: w } = t;
  return [
    '', '## Personalization (Target)', '',
    ...(w ? [`Target decisions come through the Web SDK (rules ${w.renderRules.map((r) => `\`${r.id}\``).join(', ')} render them${w.prehiding ? ', with a prehiding style' : ''}). To keep them: with \`aemMartech\` switched on, set \`target.enabled\` and re-run the scaffold. The plugin then fetches decisions in the eager phase and hides the page until they apply; check LCP and flicker on preview.`] : []),
    ...(a ? [`${w ? 'Also, at.js' : 'Target runs on at.js'} (${a.from === 'launch' ? `Launch extension \`${a.extension}\`` : `page-level \`${a.src}\`, not routed: it will not load on the migrated site`}). ${a.from === 'launch' ? 'Launch loads late on the migrated site, so above-the-fold activities apply late or flicker. ' : ''}\`aem-martech\` renders Target only through the Web SDK: moving the activities to the Web SDK is an owner project.`] : []),
    '`target` stays off until then.',
  ];
}

export function renderHandoff(c) {
  const { cmp, model, categories, ruleSets, consentMode: gcm = null } = c.consent;
  const read = modelRead(c.tagNotes);
  const gated = read.rules.filter((r) => r.consentGroups.length);
  const rewrites = read.rules.filter((r) => r.paths.length || r.selectors.length);
  const readEls = read.dataElements.filter((d) => d.selectors.length);
  const id = cmp && Object.entries(cmp.attrs)[0];
  return [
    '# Martech hand-off',
    '',
    `Everything below is scaffolded **off**. To ship it, set \`enabled: true\` on \`consent.cmp\` and on each route in \`stardust/martech-contract.json\`, then re-run \`deploy/scripts/martech-scaffold.mjs\` and \`dynamics/scripts/dynamics-check.mjs\` to confirm the enabled tags load. Enabled tags load on ${c.productionHosts.map((h) => `\`${h}\``).join(', ') || 'the production hosts'} only; preview with \`?martech=on\` (add \`&consent=accept\` to grant every category).`,
    '',
    '## Consent',
    '',
    `- **CMP:** ${cmp ? `${cmp.vendor} · \`${id[0]}\` = ${id[1] ? `\`${id[1]}\`` : '**not found — copy it from the CMP admin into the contract**'}` : 'none detected'}`,
    ...(cmp?.viaTagManager ? ['- **The tag manager injects the CMP on the source.** Leave `consent.cmp` disabled unless you remove that rule; enabling both loads it twice.'] : []),
    `- **Model \`${model}\`:** ${MODEL[model]}`,
    ...(gcm ? [`- **Google Consent Mode:** ${[gcm.pages ? `inline \`consent\` default on ${gcm.pages} of ${gcm.of} probed pages` : '', gcm.libraries?.length ? `consent-mode calls in ${gcm.libraries.map((f) => `\`${f}\``).join(', ')}` : ''].filter(Boolean).join('; ')}.${model === 'google-consent-mode' ? '' : ' Check it with the owner before gating a route on a category.'}`] : []),
    ...(gated.length ? [`- **Consent checks read by the model (evidence only; the model above comes from parsed evidence and does not change):** confirm each with the owner before choosing route categories.`, ...gated.map((r) => `  - ${r.vendor} rule ${r.name} checks ${r.consentGroups.map((g) => `\`${g}\``).join(', ')}${cite(r)}`)] : []),
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
    ...(c.rewrite.rules.length || c.rewrite.dataElements.length || rewrites.length || readEls.length
      ? [
        'These read the old URLs or DOM and will not match the migrated pages:',
        ...c.rewrite.rules.map((r) => `- rule \`${r.id}\` ${r.name}${where(r)}`),
        ...c.rewrite.dataElements.map((d) => `- data element \`${d.name}\` — selectors ${d.selectors.map((s) => `\`${s}\``).join(', ')}`),
        ...rewrites.map((r) => `- ${r.vendor} rule ${r.name}${where(r)}${cite(r)}`),
        ...readEls.map((d) => `- ${d.vendor} data element ${d.name} — selectors ${d.selectors.map((s) => `\`${s}\``).join(', ')}${cite(d)}`),
      ]
      : ['Nothing found (or no tag-manager library read).']),
    ...dataLayerHandoff(c),
    ...tagNotesHandoff(c.tagNotes),
    ...webSdkHandoff(c.aemMartech),
    ...targetHandoff(c.target),
  ].join('\n');
}
