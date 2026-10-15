// skills/reskin/scripts/figma/rules.mjs — reskin/curation-rules.json: the only authored input of
// curate. resolveRules checks the file against the capture and resolves every role to a value with
// its citation; validateRules throws one RulesError listing every problem. Pure.
//
// roles["<group>.<path>"] (groups: palette, type, layout, buttons, radii, shadows):
//   { from: "<foundationFile>/<key>", field?, evidence }  one foundation record; for an object record
//       (typography, components) the field is `field`, else the probe path's field, else the path's
//       last segment when the record has it, else the whole object (only its non-null CSS fields)
//   { component: "<componentsKey>", evidence }  same as from: "components/<key>"
//   { absent: "<why>" }  the value is not asserted (wins over an ancestor's object)
// Roles apply shallow first, so "buttons.primary.padding" overrides "buttons.primary"'s padding.
// Each of the 13 default-probe paths must end up a string or be marked absent with a why.
// normalizations[] apply to typography and component values as they are resolved:
//   lineHeightUnitless (lineHeightPx / fontSize), letterSpacingEm (px / fontSize): params.paths
//   optionally scopes them to role paths and their children; weightMap / familyEquivalence:
//   params.map { from: to }; fontSmoothing: params.value (written to type.fontSmoothing).
import { RulesError } from './errors.mjs';
import { FOUNDATION_FILES, PROBE_PATHS, PROBE_SOURCES } from './foundation.mjs';
import { letterSpacingCss, lineHeightCss } from './normalize.mjs';

export const TOKEN_GROUPS = ['palette', 'type', 'layout', 'buttons', 'radii', 'shadows'];
export const TOP_KEYS = ['version', 'reference', 'roles', 'normalizations', 'curations', 'suspect', 'modules', 'notesForReskin', 'motifs', 'design'];
export const NORMALIZATION_KINDS = ['lineHeightUnitless', 'letterSpacingEm', 'weightMap', 'familyEquivalence', 'fontSmoothing'];
const CSS_FIELDS = {
  typography: ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'],
  components: ['background', 'color', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'borderRadius', 'padding', 'border', 'boxShadow'],
};

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const depth = (path) => path.split('.').length;
const under = (path, prefixes) => !prefixes || prefixes.some((p) => path === p || path.startsWith(`${p}.`));

export function parseNormalizations(list, problems) {
  const norm = { lineHeightUnitless: [], letterSpacingEm: [], weightMap: [], familyEquivalence: [], fontSmoothing: [] };
  (Array.isArray(list) ? list : []).forEach((n, i) => {
    const at = `normalizations[${i}]${n?.id ? ` (${n.id})` : ''}`;
    if (!isObj(n) || !nonEmpty(n.id)) { problems.push(`${at}: needs an id`); return; }
    if (!NORMALIZATION_KINDS.includes(n.kind)) { problems.push(`${at}: unknown kind "${n.kind}" (one of ${NORMALIZATION_KINDS.join(', ')})`); return; }
    const params = isObj(n.params) ? n.params : {};
    if ((n.kind === 'weightMap' || n.kind === 'familyEquivalence') && !isObj(params.map)) { problems.push(`${at}: ${n.kind} needs params.map { from: to }`); return; }
    if (n.kind === 'fontSmoothing' && !nonEmpty(params.value)) { problems.push(`${at}: fontSmoothing needs params.value`); return; }
    if (params.paths !== undefined && !(Array.isArray(params.paths) && params.paths.every(nonEmpty))) { problems.push(`${at}: params.paths must be an array of role paths`); return; }
    norm[n.kind].push({ id: n.id, params });
  });
  return norm;
}

// A record's value as a role at `path` sees it, with the normalizations that apply there.
function normalized(file, record, path, norm) {
  if (file !== 'typography' && file !== 'components') return { value: record.value, by: {} };
  const value = { ...record.value };
  const by = {};
  const mark = (field, id) => { (by[field] ??= []).push(id); };
  const raw = (field) => (file === 'typography' ? record.figma : record.figma?.fields?.[field]?.raw);
  for (const n of norm.lineHeightUnitless) {
    const r = raw('lineHeight');
    if (!under(path, n.params.paths) || !value.lineHeight || typeof r?.lineHeightPx !== 'number' || !r.fontSize) continue;
    value.lineHeight = lineHeightCss(r, true);
    mark('lineHeight', n.id);
  }
  for (const n of norm.letterSpacingEm) {
    const r = raw('letterSpacing');
    if (!under(path, n.params.paths) || !value.letterSpacing || !r?.fontSize) continue;
    value.letterSpacing = letterSpacingCss(r, 'em');
    mark('letterSpacing', n.id);
  }
  for (const n of norm.weightMap) {
    const to = n.params.map[value.fontWeight];
    if (value.fontWeight && to !== undefined) { value.fontWeight = String(to); mark('fontWeight', n.id); }
  }
  for (const n of norm.familyEquivalence) {
    const to = n.params.map[value.fontFamily];
    if (value.fontFamily && to !== undefined) { value.fontFamily = String(to); mark('fontFamily', n.id); }
  }
  return { value, by };
}

// The raw Figma value and node behind one field of a record.
function citation(file, record, field) {
  if (file === 'components') {
    const f = field && record.figma?.fields?.[field];
    return f ? { node: f.node, figma: f.raw } : { node: record.node, figma: null };
  }
  if (file === 'typography' && field) {
    const r = record.figma;
    const figma = field === 'lineHeight' ? { lineHeightPx: r.lineHeightPx, lineHeightUnit: r.lineHeightUnit, fontSize: r.fontSize }
      : field === 'letterSpacing' ? { letterSpacing: r.letterSpacing, fontSize: r.fontSize }
        : r[field] ?? null;
    return { node: record.node, figma };
  }
  return { node: record.node, figma: record.figma };
}

const ref = (file, record, field, by) => {
  const c = citation(file, record, field);
  const ids = field ? by[field] : null;
  return { node: c.node, figma: c.figma, via: 'rest', ...(ids?.length ? { normalizedBy: ids } : {}) };
};

export function resolveRules(rules, { foundation, moduleCandidates, screenshotIndex = {} }) {
  const problems = [];
  if (!isObj(rules)) return { problems: ['the file must hold a JSON object'] };
  for (const k of Object.keys(rules)) if (!TOP_KEYS.includes(k)) problems.push(`unknown top-level key "${k}" (keys: ${TOP_KEYS.join(', ')})`);
  if (!Number.isInteger(rules.version) || rules.version < 1) problems.push('version must be an integer ≥ 1');
  const norm = parseNormalizations(rules.normalizations, problems);

  // Captured frames and their sections, for reference pins and modules.
  const where = new Map();
  for (const f of moduleCandidates?.frames || []) {
    where.set(f.node, { name: f.name, slug: f.slug });
    for (const s of f.sections) where.set(s.node, { name: s.name, slug: f.slug });
  }

  const reference = [];
  for (const [family, pin] of Object.entries(isObj(rules.reference) ? rules.reference : {})) {
    const w = where.get(pin?.frame);
    if (!w) { problems.push(`reference.${family}: frame "${pin?.frame}" is not a captured frame or section`); continue; }
    reference.push({ family, frame: pin.frame, name: w.name, mode: pin.mode ?? null, breakpoint: pin.breakpoint ?? null });
  }

  const roles = isObj(rules.roles) ? rules.roles : {};
  if (!isObj(rules.roles)) problems.push('roles must be an object of "<group>.<path>": { from | component | absent }');
  const assignments = [];
  const absent = [];
  const nullFields = new Map();
  Object.entries(roles)
    .map(([path, role], order) => ({ path, role, order }))
    .sort((a, b) => depth(a.path) - depth(b.path) || a.order - b.order)
    .forEach(({ path, role }) => {
      if (!TOKEN_GROUPS.includes(path.split('.')[0]) || depth(path) < 2) { problems.push(`roles["${path}"]: path must start with one of ${TOKEN_GROUPS.join(', ')} and name a token`); return; }
      if (!isObj(role)) { problems.push(`roles["${path}"]: must be an object`); return; }
      if ('absent' in role) {
        if (!nonEmpty(role.absent)) problems.push(`roles["${path}"]: absent needs a why`);
        else absent.push({ path, why: role.absent, probe: PROBE_PATHS.includes(path) });
        return;
      }
      const src = role.component !== undefined ? `components/${role.component}` : role.from;
      if (!nonEmpty(src)) { problems.push(`roles["${path}"]: needs from, component or absent`); return; }
      const [file, key, extra] = src.split('/');
      const record = FOUNDATION_FILES.includes(file) && extra === undefined ? foundation?.[file]?.[key] : undefined;
      if (!record) { problems.push(`roles["${path}"]: from "${src}" does not resolve to a foundation record`); return; }
      const { value, by } = normalized(file, record, path, norm);
      const last = path.split('.').at(-1);
      // An explicit field must fit an object record; implied fields apply only to object records.
      const field = role.field ?? (isObj(value) ? PROBE_SOURCES[path]?.field ?? (last in value ? last : null) : null);
      if (field) {
        if (!isObj(value)) { problems.push(`roles["${path}"]: ${src} is a single value; drop field "${field}"`); return; }
        if (value[field] == null) {
          const kind = field === 'background' && value.backgroundKind ? ` (backgroundKind ${value.backgroundKind})` : '';
          problems.push(`roles["${path}"]: ${src} has no ${field}${kind}; map another source or mark it absent`);
          return;
        }
        assignments.push({ path, value: value[field], refs: { [path]: ref(file, record, field, by) } });
        return;
      }
      if (!isObj(value)) { assignments.push({ path, value, refs: { [path]: ref(file, record, null, by) } }); return; }
      const obj = {};
      const refs = {};
      for (const k of CSS_FIELDS[file]) {
        if (value[k] == null) { nullFields.set(`${path}.${k}`, { src, kind: k === 'background' ? value.backgroundKind : null }); continue; }
        obj[k] = value[k];
        refs[`${path}.${k}`] = ref(file, record, k, by);
      }
      assignments.push({ path, value: obj, refs });
    });

  const curations = [];
  (Array.isArray(rules.curations) ? rules.curations : []).forEach((c, i) => {
    if (!isObj(c) || !nonEmpty(c.path) || !TOKEN_GROUPS.includes(c.path.split('.')[0])) { problems.push(`curations[${i}]: path must start with one of ${TOKEN_GROUPS.join(', ')}`); return; }
    if (typeof c.to !== 'string') { problems.push(`curations[${i}] (${c.path}): to must be a string`); return; }
    if (!nonEmpty(c.rule)) { problems.push(`curations[${i}] (${c.path}): needs the proving rule`); return; }
    const marked = absent.find((a) => c.path === a.path || c.path.startsWith(`${a.path}.`));
    if (marked) { problems.push(`curations[${i}] (${c.path}): the path is marked absent by roles["${marked.path}"]; keep one of them`); return; }
    curations.push({ path: c.path, to: c.to, rule: c.rule, evidence: c.evidence ?? null });
  });

  const suspect = [];
  (Array.isArray(rules.suspect) ? rules.suspect : []).forEach((s, i) => {
    if (!isObj(s) || !nonEmpty(s.path) || !nonEmpty(s.why)) problems.push(`suspect[${i}]: needs path and why`);
    else suspect.push({ path: s.path, why: s.why });
  });

  const modules = [];
  const ids = new Set();
  (Array.isArray(rules.modules) ? rules.modules : []).forEach((m, i) => {
    const label = m?.id || m?.name || `modules[${i}]`;
    if (!isObj(m)) { problems.push(`modules[${i}]: must be an object`); return; }
    const w = where.get(m.frame);
    if (!w) { problems.push(`${label}: frame "${m.frame}" is not a captured frame or section`); return; }
    const shot = screenshotIndex[w.slug];
    if (!shot?.renderable) problems.push(`${label}: no screenshot for ${w.slug} (frame ${m.frame}); every module cites a screenshot`);
    if (m.screenshot !== undefined && m.screenshot !== `${w.slug}.png`) problems.push(`${label}: screenshot "${m.screenshot}" is not ${w.slug}.png, the frame it sits in`);
    if (!nonEmpty(m.name)) problems.push(`${label}: needs a name`);
    if (m.status === 'excluded') {
      if (!nonEmpty(m.why)) problems.push(`${label}: excluded needs a why`);
    } else if (m.status === 'include') {
      if (!/^M\d+$/.test(m.id || '')) problems.push(`${label}: an included module needs an id like M1`);
      else if (ids.has(m.id)) problems.push(`duplicate module id ${m.id}`);
      ids.add(m.id);
      if (!nonEmpty(m.anatomy)) problems.push(`${label}: needs an anatomy (the slots it carries)`);
    } else problems.push(`${label}: status must be include or excluded`);
    modules.push({ ...m, slug: w.slug });
  });

  // Probe coverage over the resolved tree.
  const tree = {};
  for (const a of assignments) setPath(tree, a.path, structuredClone(a.value));
  for (const a of absent) deletePath(tree, a.path);
  for (const c of curations) setPath(tree, c.path, c.to);
  for (const p of PROBE_PATHS) {
    if (typeof getPath(tree, p) === 'string' || absent.some((a) => a.path === p)) continue;
    const hole = nullFields.get(p);
    problems.push(hole
      ? `probe path ${p} has no value: its ancestor maps ${hole.src}, which has no ${p.split('.').at(-1)}${hole.kind ? ` (backgroundKind ${hole.kind})` : ''}; map another source or mark it absent`
      : `probe path ${p} is neither mapped nor marked absent: add roles["${p}"] = { "from": … } or { "absent": "<why>" }`);
  }
  return { problems, assignments, absent, curations, suspect, modules, reference, norm };
}

export function validateRules(rules, ctx) {
  const r = resolveRules(rules, ctx);
  if (r.problems.length) throw new RulesError(r.problems);
  return r;
}

export function getPath(o, path) { return path.split('.').reduce((x, k) => (isObj(x) ? x[k] : undefined), o); }
export function setPath(o, path, value) {
  const keys = path.split('.');
  let cur = o;
  for (const k of keys.slice(0, -1)) { if (!isObj(cur[k])) cur[k] = {}; cur = cur[k]; }
  cur[keys.at(-1)] = value;
}
export function deletePath(o, path) {
  const keys = path.split('.');
  const parent = getPath(o, keys.slice(0, -1).join('.'));
  if (isObj(parent)) delete parent[keys.at(-1)];
}
