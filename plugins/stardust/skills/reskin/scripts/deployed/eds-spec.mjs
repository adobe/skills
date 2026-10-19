// skills/reskin/scripts/deployed/eds-spec.mjs — A2 of the deployed leg, `tokens`: the donor tokens asserted on the
// EDS DOM of the preview, through donor-probe.mjs.
//   edsSpec({ tokens, runtimeContract })  the probe entries: palette, type and the primary button on the selectors
//                                         EDS markup has, then, when the sheet carries layout.sectionPaddingY, its
//                                         top and bottom padding on every non-empty `main > .section` (donor-probe
//                                         match "all", ±16px: the empty metadata section the pipeline leaves is
//                                         skipped; the token must be a px length, else a UsageError), then each :root
//                                         token verbatim. A token the sheet does not carry has no entry.
//                                         layout.containerMaxWidth is not asserted here (A3's cap-probe measures it:
//                                         EDS wrappers are full-width by design).
//   runTokens({ dir, slug, preview, auth, env, donorProbe })  writes tokens-spec.json, runs donor-probe on the preview,
//                                         writes tokens.json and returns { verdict, exit, report, json, total, failures,
//                                         skipped }. A probe that cannot give a verdict throws: a UsageError (exit 2),
//                                         an error with code 3 (bot challenge) or code 124 (no verdict).
// The labels are donor-probe's DEFAULT_SPEC labels for the same token paths, so a failure reads as it does in Phase 5.
// The site token reaches the probe by environment (never argv) and never appears in a message, report or record.
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { readJson, writeJson } from '../figma/io.mjs';
import { rootTokens } from '../render/root-tokens.mjs';
import { redact } from './eds.mjs';
import { authHint, childEnv, coded, outputOf, runChild, setupError, tokenFlags } from './child.mjs';
import { deployedDir, readInput } from './io.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// donor-probe.mjs sits beside deployed-gate.mjs in both layouts (plugin tree and project copy).
const DONOR_PROBE = resolve(HERE, '..', 'donor-probe.mjs');
const BUTTON = 'main a.button.primary';
const PRIMARY_CLASS = /\.button\.primary(?![\w-])/;

const SKIPPED = [
  'layout.containerMaxWidth: measured by parity cap-probe',
];

// layout.sectionPaddingY: every section with content, top and bottom (EDS leaves an empty metadata section that
// computes the same padding but is no section on the page). The top row keeps donor-probe's DEFAULT_SPEC label.
const SECTIONS = 'main > .section:not(:empty)';
const SECTION_PADDING = [['section rhythm (±16px)', 'paddingTop'], ['section rhythm bottom (±16px)', 'paddingBottom']];
const PX_LENGTH = /^(-?\d+(\.\d+)?px|0)$/;

const ROWS = [
  { label: 'page bg', selector: 'body', property: 'backgroundColor', token: 'palette.pageBg' },
  { label: 'body fg', selector: 'body', property: 'color', token: 'palette.bodyFg' },
  { label: 'font-family token string', selector: 'body', property: 'fontFamily', token: 'type.family', compare: 'firstFamily' },
  { label: 'body font size', selector: 'body', property: 'fontSize', token: 'type.body.fontSize' },
  { label: 'display weight', selector: 'main h1', property: 'fontWeight', token: 'type.display.fontWeight' },
  { label: 'heading color', selector: 'main h2', property: 'color', token: 'palette.headingFg' },
  { label: 'primary button bg', selector: BUTTON, property: 'backgroundColor', token: 'buttons.primary.background' },
  { label: 'primary button fg', selector: BUTTON, property: 'color', token: 'buttons.primary.color' },
  { label: 'primary button radius', selector: BUTTON, property: 'borderRadius', token: 'buttons.primary.borderRadius' },
  { label: 'primary button padding (±2px)', selector: BUTTON, property: 'padding', token: 'buttons.primary.padding', tolerancePx: 2 },
  { label: 'primary button font size', selector: BUTTON, property: 'fontSize', token: 'buttons.primary.fontSize' },
];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lookup = (tokens, path) => path.split('.').reduce((o, k) => (isObject(o) ? o[k] : undefined), tokens);
const present = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

export function edsSpec({ tokens, runtimeContract }) {
  const rows = [];
  for (const { token, ...row } of ROWS) {
    const value = lookup(tokens, token);
    if (!present(value)) continue;
    if (typeof value !== 'string') throw new UsageError(`donor-tokens.json: ${token} must be a string, got ${typeof value}`);
    rows.push({ label: row.label, selector: row.selector, property: row.property, value, ...(row.tolerancePx ? { tolerancePx: row.tolerancePx } : {}), ...(row.compare ? { compare: row.compare } : {}) });
  }
  if (rows.some((r) => r.selector === BUTTON) && !PRIMARY_CLASS.test(String(runtimeContract?.buttonClasses ?? ''))) {
    throw new UsageError(`runtime-contract.json: buttonClasses (${JSON.stringify(runtimeContract?.buttonClasses ?? null)}) does not mention .button.primary, so the deployed site has no primary button for \`${BUTTON}\` to assert`);
  }
  let root;
  try { root = rootTokens(tokens).entries; } catch (e) { throw new UsageError(`donor-tokens.json: ${e.message}`); }
  const padding = lookup(tokens, 'layout.sectionPaddingY');
  if (present(padding)) {
    if (typeof padding !== 'string' || !PX_LENGTH.test(padding.trim())) {
      throw new UsageError(`donor-tokens.json: layout.sectionPaddingY must be a px length such as "64px" to be asserted on every section of the preview, got ${JSON.stringify(padding)}: write it in px, or leave it out of the sheet`);
    }
    for (const [label, property] of SECTION_PADDING) rows.push({ label, selector: SECTIONS, property, value: padding.trim(), tolerancePx: 16, match: 'all' });
  }
  return [...rows, ...root.map((e) => ({ label: `:root ${e.name}`, selector: ':root', property: e.name, value: e.value }))];
}

const SELECTOR_NOTHING = /^selector ".*" matched nothing$/;

// preview is the record of `deployed-gate preview`; auth the Authorization header value, or null. The sheet is
// <dir>/reskin/donor-tokens.json, the runtime contract <parent of dir>/stardust/runtime-contract.json (as the
// eligibility check reads it). Blocking: verdict FAIL is exit 1.
export async function runTokens({ dir, slug, preview, auth = null, env = process.env, donorProbe = DONOR_PROBE }) {
  const out = deployedDir(dir, slug);
  const files = { record: join(out, 'tokens.json'), spec: join(out, 'tokens-spec.json'), report: join(out, 'tokens-probe.md'), json: join(out, 'tokens-probe.json') };
  for (const f of Object.values(files)) rmSync(f, { force: true });

  const sheetPath = join(dir, 'reskin', 'donor-tokens.json');
  if (typeof preview?.url !== 'string' || !preview.url) throw new UsageError(`${join(out, 'preview.json')} has no url: run deployed-gate preview --page ${slug} again`);
  const tokens = readInput(sheetPath, 'the donor token sheet the reskin writes');
  const runtimeContract = readInput(join(dirname(resolve(dir)), 'stardust', 'runtime-contract.json'), 'deploy\'s runtime probe writes it');
  const spec = edsSpec({ tokens, runtimeContract });
  if (!spec.length) throw new UsageError(`${sheetPath} holds no token to assert: nothing to assert is no pass`);
  const want = new Map(spec.map((e) => [e.label, e.value]));
  writeJson(files.spec, spec);

  const args = [donorProbe, '--tokens', sheetPath, '--spec', files.spec, '--rendered', preview.url, '--wait-eds', '--no-sanity', '--report', files.report, '--json', files.json, ...tokenFlags(auth)];
  let r;
  try { r = await runChild(process.execPath, args, { env: childEnv(env, auth) }); } catch (e) { throw coded(124, redact(`donor-probe did not start: ${e.message}`, auth)); }
  const stop = setupError(r, { name: 'donor-probe', auth, hint: authHint(preview, auth) });
  if (stop) throw stop;

  let probe = null;
  if (r.status === 0 || r.status === 1) { try { probe = readJson(files.json); } catch { /* no verdict, reported below */ } }
  const scored = Array.isArray(probe?.results) ? probe.results.filter((x) => x.status === 'PASS' || x.status === 'FAIL') : null;
  const bad = scored?.filter((x) => x.status === 'FAIL') ?? [];
  if (!scored || (r.status === 0) !== (bad.length === 0)) {
    throw coded(124, `donor-probe did not give a verdict (exit ${r.status ?? r.signal}): ${outputOf(r, auth)}`);
  }
  const failures = bad.map((x) => {
    const label = x.label ?? x.check;
    return SELECTOR_NOTHING.test(x.detail) ? `${label}: ${x.detail}` : `${label}: got ${x.detail}, want ${want.get(label)}`;
  });
  const result = { verdict: bad.length ? 'FAIL' : 'PASS', exit: bad.length ? 1 : 0, report: files.report, json: files.json, skipped: [...SKIPPED] };
  writeJson(files.record, result);
  return { ...result, total: scored.length, failures };
}
