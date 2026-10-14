// skills/reskin/scripts/figma/design.mjs — the descriptive design files direct reads when designSource
// is stamped: canon-source/DESIGN.json, DESIGN.md and _brand-extraction.json, in the shapes extract
// writes (the direct-from-phrase fixture is the reference). Mechanical parts come from the foundation
// and the curated donor tokens; prose comes only from curation-rules.json#design, and is left as a
// visible placeholder when absent, never invented. Figma has no breakpoints model (cap-probe measures
// the rendered page later), so extensions.breakpoints is null. Pure and deterministic.
import { mdProvenance, provenance } from './io.mjs';

const NOTE = 'DESCRIPTIVE capture of a Figma design system (REST), not browser-rendered';
const PLACEHOLDER = '_(not authored: add design.narrative to curation-rules.json)_';
const BUTTON_CSS = [['background', 'background'], ['color', 'color'], ['fontFamily', 'font-family'], ['fontSize', 'font-size'], ['fontWeight', 'font-weight'], ['lineHeight', 'line-height'], ['letterSpacing', 'letter-spacing'], ['borderRadius', 'border-radius'], ['padding', 'padding'], ['border', 'border'], ['boxShadow', 'box-shadow']];

const q = (s) => JSON.stringify(String(s));
const num = (s) => (/^-?\d+(\.\d+)?$/.test(String(s)) ? String(Number(s)) : q(s));
const uniq = (xs) => [...new Set(xs)];

function paletteRoles(donorTokens) {
  const byValue = new Map();
  for (const [role, value] of Object.entries(donorTokens.palette || {})) {
    if (typeof value !== 'string') continue;
    byValue.set(value, [...(byValue.get(value) || []), role]);
  }
  return byValue;
}

function radiusMotifs(foundation) {
  const ranked = Object.values(foundation.radii || {}).map((r, i) => ({ r, i })).sort((a, b) => b.r.count - a.r.count || a.i - b.i).map(({ r }) => r);
  const pill = ranked.find((r) => parseFloat(r.value) >= 999);
  const rest = ranked.filter((r) => r !== pill);
  return { primary: rest[0]?.value ?? null, secondary: rest[1]?.value ?? null, pill: pill?.value ?? null };
}

function gradients(moduleCandidates) {
  return moduleCandidates.frames.flatMap((f) => f.sections
    .filter((s) => s.backgroundKind?.startsWith('GRADIENT'))
    .map((s) => ({ value: s.backgroundKind, uses: `${s.name} (${f.slug}, node ${s.node})` })));
}

const componentKey = (rules, path) => {
  const role = rules.roles?.[path];
  if (!role) return null;
  if (role.component) return role.component;
  return typeof role.from === 'string' && role.from.startsWith('components/') ? role.from.slice('components/'.length) : null;
};

function narrativeOf(rules) {
  const n = rules.design?.narrative || {};
  const list = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);
  return {
    northStar: typeof n.northStar === 'string' ? n.northStar : '',
    overview: typeof n.overview === 'string' ? n.overview : '',
    keyCharacteristics: list(n.keyCharacteristics),
    rules: (Array.isArray(n.rules) ? n.rules : []).map((r, i) => (typeof r === 'string'
      ? { name: `Rule ${i + 1}`, body: r, section: 'Overview' }
      : { name: r?.name ?? `Rule ${i + 1}`, body: r?.body ?? '', section: r?.section ?? 'Overview' })),
    dos: list(n.dos),
    donts: list(n.donts),
  };
}

export function buildDesign({ foundation, moduleCandidates, rules, manifest, donorTokens, dir = 'stardust' }) {
  const design = rules.design || {};
  const displayName = design.displayName || 'Figma donor';
  const roles = paletteRoles(donorTokens);
  const colorNames = design.colorNames || {};
  const colorMeta = {};
  for (const [key, c] of Object.entries(foundation.colors || {})) {
    colorMeta[key] = { role: (roles.get(c.value) || ['unassigned']).join(', '), displayName: colorNames[key] || c.styles?.[0] || key, canonical: c.hex, tonalRamp: [] };
  }
  const typo = donorTokens.type || {};
  const purposes = design.typography || {};
  const buttons = donorTokens.buttons || {};
  const components = [];
  for (const [path, name] of [['buttons.primary', 'Primary Button'], ['buttons.secondary', 'Secondary Button']]) {
    const key = componentKey(rules, path);
    const css = buttons[path.split('.')[1]];
    if (!key || !css || !foundation.components?.[key]) continue;
    const rec = foundation.components[key];
    const variant = Object.entries(rec.variant || {}).map(([k, v]) => `${k}=${v}`).join(', ');
    components.push({
      name, kind: 'button', refersTo: `button-${path.split('.')[1]}`,
      description: `${rec.set || key}${variant ? ` (${variant})` : ''}: foundation components/${key}, node ${rec.node}`,
      html: null,
      css: BUTTON_CSS.filter(([k]) => typeof css[k] === 'string').map(([k, prop]) => `${prop}: ${css[k]};`).join(' '),
    });
  }
  const motifs = { borderRadius: radiusMotifs(foundation), shadows: Object.entries(donorTokens.shadows || {}).map(([name, value]) => ({ value, uses: name })), gradients: gradients(moduleCandidates), patterns: [] };
  const narrative = narrativeOf(rules);
  const readArtifacts = [`${dir}/reskin/curation-rules.json`, `${dir}/reskin/donor-tokens.json`, `${dir}/canon-source/foundation/`];

  const designJson = {
    _provenance: provenance({ at: manifest.capturedAt, readArtifacts, note: NOTE }),
    schemaVersion: 2,
    generatedAt: manifest.capturedAt,
    title: `Design System: ${displayName}`,
    extensions: {
      colorMeta,
      typographyMeta: {
        display: { displayName: typo.display?.fontFamily || typo.family || '', purpose: purposes.display || '' },
        body: { displayName: typo.body?.fontFamily || typo.family || '', purpose: purposes.body || '' },
      },
      shadows: Object.entries(donorTokens.shadows || {}).map(([name, value]) => ({ name, value, purpose: '' })),
      motion: [],
      breakpoints: null,
      componentStyle: { buttons: { primary: buttons.primary ?? null, secondary: buttons.secondary ?? null, ghost: null } },
      motifs,
      voice: null,
    },
    components,
    narrative,
  };

  // ---- DESIGN.md --------------------------------------------------------------------------------
  const colorKeyOf = new Map(Object.entries(foundation.colors || {}).map(([k, c]) => [c.value, k]));
  const ref = (value) => (colorKeyOf.has(value) ? q(`{colors.${colorKeyOf.get(value)}}`) : q(value));
  const fm = ['---', `name: ${q(displayName)}`, `description: ${q(design.description || `Design system captured from Figma (file version ${manifest.version})`)}`, 'colors:'];
  for (const [key, c] of Object.entries(foundation.colors || {})) fm.push(`  ${key}: ${q(c.hex)}`);
  fm.push('typography:');
  for (const [name, t] of [['display', typo.display], ['headline', typo.h2], ['title', typo.h3], ['body', typo.body]]) {
    if (!t) continue;
    fm.push(`  ${name}:`);
    if (t.fontFamily) fm.push(`    fontFamily: ${q(t.fontFamily)}`);
    if (t.fontSize) fm.push(`    fontSize: ${q(t.fontSize)}`);
    if (t.fontWeight) fm.push(`    fontWeight: ${num(t.fontWeight)}`);
    if (t.lineHeight) fm.push(`    lineHeight: ${num(t.lineHeight)}`);
  }
  fm.push('rounded:');
  for (const [k, v] of Object.entries(donorTokens.radii || {})) fm.push(`  ${k}: ${q(v)}`);
  fm.push('spacing:');
  if (donorTokens.layout?.sectionPaddingY) fm.push(`  section: ${q(donorTokens.layout.sectionPaddingY)}`);
  if (donorTokens.layout?.containerMaxWidth) fm.push(`  container: ${q(donorTokens.layout.containerMaxWidth)}`);
  fm.push('components:');
  for (const [k, b] of Object.entries(buttons)) {
    if (!b || typeof b !== 'object') continue;
    fm.push(`  button-${k}:`);
    if (b.background) fm.push(`    backgroundColor: ${ref(b.background)}`);
    if (b.color) fm.push(`    textColor: ${ref(b.color)}`);
    if (b.borderRadius) fm.push(`    rounded: ${q(b.borderRadius)}`);
    if (b.padding) fm.push(`    padding: ${q(b.padding)}`);
  }
  fm.push('---');

  const bullets = (xs, fmt = (x) => x) => (xs.length ? xs.map((x) => `- ${fmt(x)}`) : [PLACEHOLDER]);
  const hierarchy = [['Display', typo.display, purposes.display], ['Headline', typo.h2, ''], ['Title', typo.h3, ''], ['Body', typo.body, purposes.body]]
    .filter(([, t]) => t)
    .map(([n, t, p]) => `- **${n}** (${[t.fontWeight, t.fontSize, t.lineHeight].filter(Boolean).join(', ')})${p ? `: ${p}` : ''}.`);
  const buttonLine = (label, b) => (b ? `- **${label}:** ${BUTTON_CSS.filter(([k]) => typeof b[k] === 'string').map(([k, prop]) => `${prop} ${b[k]}`).join(', ')}.` : null);
  const md = [
    mdProvenance(provenance({ at: manifest.capturedAt, readArtifacts, note: NOTE })),
    ...fm,
    '',
    `# Design System: ${displayName}`,
    '',
    '## 1. Overview',
    '',
    narrative.northStar ? `**Creative North Star: "${narrative.northStar}"**` : PLACEHOLDER,
    '',
    narrative.overview || PLACEHOLDER,
    '',
    '**Key Characteristics:**',
    ...bullets(narrative.keyCharacteristics),
    ...narrative.rules.flatMap((r) => ['', `**${r.name}.** ${r.body}`]),
    '',
    '## 2. Colors',
    '',
    ...Object.entries(colorMeta).map(([, c]) => `- **${c.displayName}** (${c.canonical}): ${c.role}.`),
    '',
    '## 3. Typography',
    '',
    `**Display Font:** ${typo.display?.fontFamily || typo.family || '—'}`,
    `**Body Font:** ${typo.body?.fontFamily || typo.family || '—'}`,
    '',
    `${typo.familyNote ? `${typo.familyNote[0].toUpperCase()}${typo.familyNote.slice(1)}.` : ''}`,
    '',
    '### Hierarchy',
    ...(hierarchy.length ? hierarchy : ['- (no type roles mapped)']),
    '',
    '## 4. Elevation',
    '',
    ...(designJson.extensions.shadows.length ? designJson.extensions.shadows.map((s) => `- **${s.name}:** \`box-shadow: ${s.value}\``) : ['Flat: no shadows captured.']),
    '',
    '## 5. Components',
    '',
    '### Buttons',
    ...[buttonLine('Primary', buttons.primary), buttonLine('Secondary', buttons.secondary)].filter(Boolean),
    '',
    "## 6. Do's and Don'ts",
    '',
    '### Do:',
    ...bullets(narrative.dos, (d) => `**Do** ${d}`),
    '',
    "### Don't:",
    ...bullets(narrative.donts, (d) => `**Don't** ${d}`),
    '',
  ].join('\n');

  return { designJson, designMd: md };
}

export function buildBrandExtraction({ foundation, moduleCandidates, rules, resolvedModules = [], manifest, donorTokens, donorUrl, dir = 'stardust' }) {
  const roles = paletteRoles(donorTokens);
  const palette = Object.values(foundation.colors || {}).map((c) => ({
    role: (roles.get(c.value) || ['unassigned']).join(', '),
    value: c.hex,
    occurrences: c.count,
    sourceSelectors: [],
    sources: c.nodes,
    usedAs: [['fill', 'background'], ['text', 'text'], ['stroke', 'border']].filter(([k]) => c.usage?.[k] > 0).map(([, v]) => v),
  }));

  const typoRecords = Object.values(foundation.typography || {});
  const recordOf = (path) => {
    const from = rules.roles?.[path]?.from;
    return typeof from === 'string' && from.startsWith('typography/') ? foundation.typography?.[from.slice('typography/'.length)] : null;
  };
  const largest = [...typoRecords].sort((a, b) => b.figma.fontSize - a.figma.fontSize)[0];
  const commonest = [...typoRecords].sort((a, b) => b.count - a.count)[0];
  const family = (rec, stack) => {
    if (!rec) return null;
    const name = rec.figma.fontFamily;
    const same = typoRecords.filter((r) => r.figma.fontFamily === name).sort((a, b) => b.figma.fontSize - a.figma.fontSize);
    return {
      name,
      stack: stack || name,
      weights: uniq(same.map((r) => r.figma.fontWeight)).sort((a, b) => a - b),
      sizes: uniq(same.map((r) => r.value.fontSize)),
      lineHeights: uniq(same.filter((r) => typeof r.figma.lineHeightPx === 'number').map((r) => Math.round((r.figma.lineHeightPx / r.figma.fontSize) * 1000) / 1000)),
      letterSpacing: uniq(same.map((r) => r.value.letterSpacing)),
      sourceSelectors: [],
    };
  };
  const typo = donorTokens.type || {};
  const headRec = recordOf('type.display') || largest;
  const bodyRec = recordOf('type.body') || recordOf('type.family') || commonest;

  return {
    _provenance: provenance({ at: manifest.capturedAt, readArtifacts: [`${dir}/canon-source/foundation/`, `${dir}/reskin/donor-tokens.json`, `${dir}/reskin/curation-rules.json`], note: NOTE }),
    site: null,
    origins: [{ origin: donorUrl, role: 'design-source', pagesCaptured: moduleCandidates.frames.length, contributedSignals: ['palette', 'type', 'motifs'] }],
    logo: null,
    palette,
    type: {
      headingFamily: family(headRec, typo.display?.fontFamily),
      bodyFamily: family(bodyRec, typo.body?.fontFamily || typo.family),
      monoFamily: null,
      scaleRatio: null,
      scaleAudit: null,
      loadStrategy: null,
      files: [],
    },
    spacing: null,
    motifs: {
      borderRadius: radiusMotifs(foundation),
      shadows: Object.entries(donorTokens.shadows || {}).map(([name, value]) => ({ value, uses: name })),
      gradients: gradients(moduleCandidates),
      patterns: resolvedModules.filter((m) => m.status === 'include').map((m) => ({ name: m.name, evidence: `canon-source/assets/screenshots/${m.slug}.png · node ${m.frame}: ${m.anatomy}` })),
    },
    componentStyle: null,
    systemComponents: [],
    iconFont: null,
    voice: null,
    voiceTable: null,
    crossPromo: null,
    register: null,
  };
}
