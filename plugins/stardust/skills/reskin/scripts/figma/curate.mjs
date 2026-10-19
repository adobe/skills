// skills/reskin/scripts/figma/curate.mjs — curate: foundation + module candidates + curation rules →
// reskin/donor-tokens.json and reskin/donor-modules.md (contracts: reference/donor-sources.md
// § donor-tokens.json, § donor-modules.md). curate() is pure and deterministic: timestamps come from
// the capture manifest, so the same inputs give the same bytes. Nothing here is a guess: a value comes
// from a rule or is reported absent in coverage. runCurate() is the file-reading wrapper the CLI uses.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cacheFor, readCurrent } from './cache.mjs';
import { buildBrandExtraction, buildDesign } from './design.mjs';
import { RulesError, UsageError } from './errors.mjs';
import { FOUNDATION_FILES, PROBE_PATHS } from './foundation.mjs';
import { mdProvenance, provenance, readJson, writeFileAtomic, writeJson } from './io.mjs';
import { deletePath, getPath, setPath, validateRules } from './rules.mjs';
import { canonicalFigmaUrl } from './url.mjs';

const FAMILY_NOTE = 'adopted as a token string with a local fallback; no font files from Figma';

export function curate({ foundation, moduleCandidates, rules, manifest, screenshotIndex, donorUrl, dir = 'stardust' }) {
  const stale = Object.entries(screenshotIndex || {})
    .filter(([k, e]) => !k.startsWith('_') && e.version !== manifest.version)
    .map(([k, e]) => `${k} (${e.version})`);
  if (stale.length) throw new RulesError([`screenshots ${stale.join(', ')} are not from capture version ${manifest.version}: re-run capture --refresh`]);
  const r = validateRules(rules, { foundation, moduleCandidates, screenshotIndex });

  const tokens = { palette: {}, type: {}, layout: {}, buttons: {}, radii: {}, shadows: {} };
  const nodeRefs = {};
  for (const a of r.assignments) {
    setPath(tokens, a.path, structuredClone(a.value));
    for (const key of Object.keys(nodeRefs)) if (key === a.path || key.startsWith(`${a.path}.`)) delete nodeRefs[key];
    Object.assign(nodeRefs, structuredClone(a.refs));
  }
  // Radii and shadows without authored roles: every foundation record under its own key. Defaults go
  // in before absence so a path the rules declare absent is removed from tokens and nodeRefs alike.
  const roleTargets = (group) => r.assignments.some((a) => a.path.startsWith(`${group}.`));
  for (const [group, file] of [['radii', 'radii'], ['shadows', 'effects']]) {
    if (roleTargets(group)) continue;
    for (const [key, rec] of Object.entries(foundation[file] || {})) {
      tokens[group][key] = rec.value;
      nodeRefs[`${group}.${key}`] = { node: rec.node, figma: rec.figma, via: 'rest' };
    }
  }
  for (const a of r.absent) {
    deletePath(tokens, a.path);
    for (const key of Object.keys(nodeRefs)) if (key === a.path || key.startsWith(`${a.path}.`)) delete nodeRefs[key];
  }
  for (const c of r.curations) {
    const prev = getPath(tokens, c.path);
    setPath(tokens, c.path, c.to);
    nodeRefs[c.path] = {
      ...(nodeRefs[c.path] ?? { node: c.evidence, figma: null, via: 'rest' }),
      curated: { from: typeof prev === 'string' ? prev : null, rule: c.rule, evidence: c.evidence },
    };
  }
  // Display alignment: not an authored role — the majority textAlignHorizontal (by characters) of the
  // typography record the display role resolved to. An explicit role, curation or absent wins.
  const displayRef = Object.entries(nodeRefs).find(([k]) => k.startsWith('type.display.'))?.[1];
  const displayRec = displayRef && Object.values(foundation.typography || {}).find((t) => t.node === displayRef.node && t.align);
  if (displayRec && getPath(tokens, 'type.display.textAlign') === undefined && !r.absent.some((a) => a.path === 'type.display.textAlign')) {
    const [align] = Object.entries(displayRec.align).sort(([, a], [, b]) => b - a)[0];
    setPath(tokens, 'type.display.textAlign', align);
    nodeRefs['type.display.textAlign'] = { node: displayRec.node, figma: { textAlignHorizontal: displayRec.align }, via: 'rest', derived: 'majority by characters' };
  }
  // Header menu placement: not an authored role either — the majority align of the desktop frames'
  // header rows (foundation.mjs headerRowOf). An explicit role, curation or absent wins.
  const headerRows = (moduleCandidates.frames || []).flatMap((f) => f.headerRows || []);
  if (headerRows.length && getPath(tokens, 'layout.navAlign') === undefined && !r.absent.some((a) => a.path === 'layout.navAlign')) {
    const tally = {};
    for (const h of headerRows) tally[h.align] = (tally[h.align] || 0) + 1;
    const [align] = Object.entries(tally).sort(([, a], [, b]) => b - a)[0];
    setPath(tokens, 'layout.navAlign', align);
    nodeRefs['layout.navAlign'] = { node: headerRows.find((h) => h.align === align).node, figma: { headerRows: tally }, via: 'rest', derived: 'majority of desktop header rows' };
  }
  const smoothing = r.norm.fontSmoothing.at(-1);
  if (smoothing) tokens.type.fontSmoothing = smoothing.params.value;

  const families = r.norm.familyEquivalence.flatMap((n) => Object.entries(n.params.map).map(([from, to]) => `"${from}" → "${to}"`));
  const { family, ...typeRest } = tokens.type;
  tokens.type = { ...(family !== undefined ? { family } : {}), familyNote: `${FAMILY_NOTE}${families.length ? `; family equivalence applied: ${families.join(', ')}` : ''}`, ...typeRest };

  const motifs = [];
  for (const f of moduleCandidates.frames) {
    for (const s of f.sections) {
      if (s.backgroundKind !== 'SOLID' && s.backgroundKind !== 'NONE') motifs.push(`${s.backgroundKind.startsWith('GRADIENT') ? 'gradient' : s.backgroundKind.toLowerCase()} background (${s.backgroundKind}) on ${s.name}, ${f.slug}, node ${s.node}`);
    }
  }
  motifs.push(...(Array.isArray(rules.motifs) ? rules.motifs.filter((m) => typeof m === 'string') : []));

  const asserted = PROBE_PATHS.filter((p) => typeof getPath(tokens, p) === 'string').length;
  const pins = r.reference.map((p) => `${p.family}: ${p.name} (node ${p.frame}${p.breakpoint ? `, ${p.breakpoint}px` : ''}${p.mode ? `, mode ${p.mode}` : ''})`);
  const readArtifacts = [`${dir}/reskin/curation-rules.json`, `${dir}/canon-source/foundation/`, `${dir}/canon-source/module-candidates.json`, `${dir}/canon-source/assets/screenshots/index.json`];

  const donorTokens = {
    _provenance: provenance({ at: manifest.capturedAt, readArtifacts }),
    donor: donorUrl,
    curatedFrom: `reskin/curation-rules.json@v${rules.version}; canon-source/foundation (figma version ${manifest.version})`,
    note: pins.length ? `Pinned reference per module family: ${pins.join('; ')}. Other frames corroborate.` : 'No reference pinned: every frame contributed.',
    ...tokens,
    motifs,
    nodeRefs,
    coverage: { asserted, absent: r.absent, suspect: r.suspect },
  };

  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  const rows = r.modules.map((m) => {
    const where = `canon-source/assets/screenshots/${m.slug}.png · node ${m.frame}`;
    if (m.status === 'excluded') return `| — | ${cell(m.name)} | ${where} | excluded — do not develop: ${cell(m.why)} |`;
    const parts = [`anatomy: ${m.anatomy}`];
    if (m.variants?.length) parts.push(`variants: ${m.variants.join(', ')}`);
    if (m.components?.length) parts.push(`components: ${m.components.join(', ')}`);
    return `| ${m.id} | ${cell(m.name)} | ${where} | ${cell(parts.join('; '))} |`;
  });
  const donorModulesMd = [
    mdProvenance(provenance({ at: manifest.capturedAt, readArtifacts: [`${dir}/reskin/curation-rules.json`, `${dir}/canon-source/module-candidates.json`] })),
    '',
    `# Donor modules — ${rules.design?.displayName || donorUrl}`,
    '',
    '| # | Module | Where seen | Description |',
    '|---|--------|-----------|-------------|',
    ...rows,
    '',
    `**Notes for reskin:** ${rules.notesForReskin || '(none recorded)'}`,
    '',
  ].join('\n');

  const { designJson, designMd } = buildDesign({ foundation, moduleCandidates, rules, manifest, donorTokens, dir });
  const brandExtraction = buildBrandExtraction({ foundation, moduleCandidates, rules, resolvedModules: r.modules, manifest, donorTokens, donorUrl, dir });
  return { donorTokens, donorModulesMd, designJson, designMd, brandExtraction };
}

const withoutMeta = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));

// Everything curate reads, from the files capture wrote. Missing inputs are setup errors (exit 2).
export function loadCurateInputs(dir) {
  const current = readCurrent(dir);
  if (!current) throw new UsageError(`no capture found under ${dir}/.work/reskin/figma/: run figma-donor.mjs capture <figma-url> first`);
  const manifest = cacheFor(dir, current.fileKey).version(current.version).read('manifest.json');
  if (!manifest) throw new UsageError(`the capture cache for ${current.version} has no manifest.json: re-run capture --refresh`);
  const cs = join(dir, 'canon-source');
  const need = (rel) => {
    const p = join(cs, rel);
    if (!existsSync(p)) throw new UsageError(`missing ${dir}/canon-source/${rel}: re-run capture`);
    return readJson(p);
  };
  const foundation = Object.fromEntries(FOUNDATION_FILES.map((f) => [f, withoutMeta(need(`foundation/${f}.json`))]));
  const moduleCandidates = withoutMeta(need('module-candidates.json'));
  const screenshotIndex = withoutMeta(need('assets/screenshots/index.json'));
  const rulesPath = join(dir, 'reskin', 'curation-rules.json');
  if (!existsSync(rulesPath)) {
    throw new UsageError(`missing ${dir}/reskin/curation-rules.json: author it from ${dir}/canon-source/role-candidates.json and module-candidates.json (schema: figma-donor.mjs --help)`);
  }
  let rules;
  try { rules = readJson(rulesPath); } catch (e) { throw new RulesError([`${dir}/reskin/curation-rules.json is not valid JSON: ${e.message}`]); }
  return { foundation, moduleCandidates, screenshotIndex, rules, manifest, donorUrl: canonicalFigmaUrl({ fileKey: manifest.fileKey, nodeId: manifest.nodeId }) };
}

export function runCurate({ dir = 'stardust' } = {}) {
  const inputs = loadCurateInputs(dir);
  const result = curate({ ...inputs, dir });
  const files = [
    ['reskin/donor-tokens.json', result.donorTokens],
    ['reskin/donor-modules.md', result.donorModulesMd],
    ['canon-source/DESIGN.json', result.designJson],
    ['canon-source/DESIGN.md', result.designMd],
    ['canon-source/_brand-extraction.json', result.brandExtraction],
  ];
  for (const [rel, body] of files) {
    if (typeof body === 'string') writeFileAtomic(join(dir, rel), body);
    else writeJson(join(dir, rel), body);
  }
  return { ...result, inputs, written: files.map(([rel]) => `${dir}/${rel}`) };
}
