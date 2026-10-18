// skills/reskin/scripts/figma-gate/ramp.mjs — B3, the :root tokens and the per-module type ramp. Every
// Type entry of the checks file is asserted on the page as six computed styles (fontSize, fontWeight,
// lineHeight, letterSpacing, fontFamily, color) against the Figma TEXT node's style, passed through
// M1's normalizers and the rules' weightMap and familyEquivalence. The :root block rootTokens() derives
// from donor-tokens.json is asserted verbatim. The assertions run through donor-probe.mjs with a
// generated --spec, one run per width; on a preview target it settles the EDS decoration and carries the site token
// (see runRamp). tokenLiterals is advisory: it lists token values written as
// literals outside the :root block. textExpect, rampSpecs and tokenLiterals are pure.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { letterSpacingCss, lineHeightCss, px, weightCss } from '../figma/normalize.mjs';
import { parseNormalizations } from '../figma/rules.mjs';
import { rootTokens } from '../render/root-tokens.mjs';
import { findBox } from './boxes.mjs';
import { scopeSelector, selectorFor } from './checks.mjs';
import { stampsOf } from './stamp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// donor-probe.mjs sits beside figma-gate.mjs in both layouts (plugin tree and project copy).
const DONOR_PROBE = resolve(HERE, '..', 'donor-probe.mjs');
const PROPERTIES = ['fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'fontFamily', 'color'];

// The page-side values a Figma TEXT box asks for, as getComputedStyle prints them (null: nothing to assert).
export function textExpect(text, norm) {
  const weight = text.fontWeight == null ? null : weightCss(text.fontWeight);
  const mapped = (list, value) => list.reduce((v, n) => (n.params.map[v] !== undefined ? String(n.params.map[v]) : v), value);
  return {
    fontSize: text.fontSize == null ? null : px(text.fontSize),
    fontWeight: weight === null ? null : mapped(norm.weightMap, weight),
    lineHeight: lineHeightCss(text, false),
    letterSpacing: letterSpacingCss(text, 'px'),
    fontFamily: text.fontFamily == null ? null : mapped(norm.familyEquivalence, text.fontFamily),
    color: text.color ?? null,
  };
}

// Why a property has no Figma value to assert (a fact about the Figma node, not a page defect).
const MISSING = {
  fontSize: 'Figma has no font size',
  fontWeight: 'Figma has no font weight',
  lineHeight: 'Figma has no line height',
  letterSpacing: 'Figma has no letter spacing',
  fontFamily: 'Figma has no font family',
  color: 'Figma has no solid color',
};

const TOLERANCE = { lineHeight: 0.1, letterSpacing: 0.1 };

// → Map<width, ProbeEntry[]>. The :root entries go once, at the first section's width. A property the
// Figma node gives no value for is not asserted: it is pushed onto unasserted as an UNASSERTED result. On a
// preview (regime) an entry's selector is its previewSelector when it has one.
export function rampSpecs({ join, checks, boxes, rootEntries, norm, unasserted = [], regime = 'local' }) {
  const specs = new Map();
  const add = (width, entry) => {
    if (!specs.has(width)) specs.set(width, []);
    specs.get(width).push(entry);
  };
  const sections = join.sections.filter((s) => checks[s.slot]);
  if (sections.length) {
    for (const e of rootEntries) add(checks[sections[0].slot].width, { label: `:root ${e.name}`, selector: ':root', property: e.name, value: e.value });
  }
  for (const s of sections) {
    const section = checks[s.slot];
    for (const entry of section.type) {
      const rootBox = boxes.roots[section.roots[entry.width]]?.box;
      const box = rootBox && findBox(rootBox, entry.node);
      if (!box?.text) throw new Error(`${s.slot} ${entry.id}: ${entry.node} is not a TEXT node inside the root for width ${entry.width}`);
      const want = textExpect(box.text, norm);
      const selector = scopeSelector(s.selector, selectorFor(entry, regime));
      for (const property of PROPERTIES) {
        if (want[property] === null) {
          unasserted.push({ slot: s.slot, id: entry.id, node: entry.node, root: section.roots[entry.width], property, status: 'UNASSERTED', detail: MISSING[property] });
          continue;
        }
        add(entry.width, {
          label: `${s.slot} ${entry.id} ${property} (${entry.node})`,
          selector,
          property,
          value: want[property],
          ...(TOLERANCE[property] ? { tolerancePx: TOLERANCE[property] } : {}),
          ...(property === 'fontFamily' ? { compare: 'firstFamily' } : {}),
        });
      }
    }
  }
  return specs;
}

const blank = (s) => s.replace(/[^\n]/g, ' ');

// A color literal as `rgb(r, g, b)`: hex, or rgb()/rgba() with alpha 1. Anything else is null.
function normalizeColor(text) {
  const s = String(text).trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return `rgb(${[0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(s);
  if (!rgb) return null;
  const alpha = rgb[4];
  if (alpha !== undefined && alpha !== '100%' && Number(alpha) !== 1) return null;
  return `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`;
}

const LITERAL = /(#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![\w-]))|(rgba?\([^)]*\))|((?<![\w.#-])\d+(?:\.\d+)?px\b)/gi;
const LENGTH = /^\d+(?:\.\d+)?px$/;

// Token values written as literals in <style> text outside the :root block: colors always, px lengths
// with { lengths: true }. line is 1-based within html.
export function tokenLiterals(html, rootEntries, { lengths = false } = {}) {
  let css = blank(html);
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const at = m.index + m[0].indexOf(m[1]);
    css = css.slice(0, at) + m[1] + css.slice(at + m[1].length);
  }
  css = css.replace(/:root\s*\{[^}]*\}/g, blank);

  const colorToken = new Map();
  const lengthToken = new Map();
  for (const e of rootEntries) {
    const color = normalizeColor(e.value);
    if (color && !colorToken.has(color)) colorToken.set(color, e.name);
    else if (!color && LENGTH.test(e.value) && !lengthToken.has(e.value)) lengthToken.set(e.value, e.name);
  }

  const found = [];
  for (const d of css.matchAll(/[;{]\s*([\w-]+)\s*:([^;{}]*)/g)) {
    const start = d.index + d[0].length - d[2].length;
    for (const m of d[2].matchAll(LITERAL)) {
      const token = m[3] ? (lengths ? lengthToken.get(m[3]) : undefined) : colorToken.get(normalizeColor(m[0]));
      if (!token) continue;
      const index = start + m.index;
      found.push({ index, line: css.slice(0, index).split('\n').length, literal: m[0], token });
    }
  }
  return found.sort((a, b) => a.index - b.index).map(({ line, literal, token }) => ({ line, literal, token }));
}

// The page's HTML as served, for the advisory list of token literals. A protected preview gets the site token, on the
// preview's own origin (a redirect to another origin drops it).
async function pageSource(url, auth) {
  try {
    if (url.startsWith('file:')) return readFileSync(fileURLToPath(url), 'utf8');
    const res = await fetch(url, { headers: auth ? { authorization: auth } : {} });
    return res.ok ? await res.text() : '';
  } catch { return ''; }
}

const STALLED = /stalled decoration:/;

// checks is validateChecks(...).sections; join is runJoin's result; rules is curation-rules.json.
// Writes ramp-spec.<w>.json, ramp.<w>.md, ramp.<w>.json and ramp.json under out. A probe that cannot
// run (any exit other than 0 or 1, or exit 1 without a fresh JSON) throws with its stderr: no verdict,
// never a ramp failure. Properties Figma gives no value for are listed as UNASSERTED results; they do
// not fail the ramp. Every result carries root, the checks root its entry was measured against (null for a :root entry).
// On a preview target the probe settles the page's EDS decoration (--wait-eds) and gets the site token (auth, the
// Authorization header value) by environment and --token-env, never argv; a probe that stalls on the decoration is no
// verdict (code 124), a bot challenge or token halt code 3. The probe runs as an async child, so a server in this process
// can answer it.
export async function runRamp({ target, join: joined, checks, boxes, tokens, rules, out, auth = null, donorProbe = DONOR_PROBE }) {
  const preview = target.regime === 'preview';
  const { childEnv, coded, outputOf, runChild, tokenFlags } = await import('../deployed/child.mjs');
  const norm = parseNormalizations(rules?.normalizations, []);
  const rootEntries = rootTokens(tokens).entries;
  const unasserted = [];
  const specs = rampSpecs({ join: joined, checks, boxes, rootEntries, norm, unasserted, regime: target.regime });
  const nodeOf = new Map();
  const rootOf = new Map();
  for (const [slot, section] of Object.entries(checks)) {
    for (const t of section.type) {
      nodeOf.set(`${slot} ${t.id}`, t.node);
      rootOf.set(`${slot} ${t.id}`, section.roots[t.width]);
    }
  }
  const settle = preview ? ['--wait-eds', '--eds-timeout', String(target.edsTimeoutMs ?? 20000), ...tokenFlags(auth)] : [];
  const env = preview ? childEnv({}, auth) : process.env;

  mkdirSync(out, { recursive: true });
  const tokensFile = join(out, 'ramp-tokens.json');
  writeFileSync(tokensFile, `${JSON.stringify(tokens, null, 2)}\n`);

  const results = [];
  const perWidth = [];
  for (const [width, entries] of specs) {
    const specFile = join(out, `ramp-spec.${width}.json`);
    const report = join(out, `ramp.${width}.md`);
    const jsonFile = join(out, `ramp.${width}.json`);
    writeFileSync(specFile, `${JSON.stringify(entries, null, 2)}\n`);
    rmSync(jsonFile, { force: true });
    const r = await runChild(process.execPath, [donorProbe, '--tokens', tokensFile, '--spec', specFile, '--rendered', target.url, '--viewport', String(width), '--no-sanity', '--report', report, '--json', jsonFile, ...settle], { env });
    let probe = null;
    try { probe = JSON.parse(readFileSync(jsonFile, 'utf8')); } catch { /* reported below */ }
    if ((r.status !== 0 && r.status !== 1) || !probe) {
      const why = outputOf(r, auth);
      if (r.status === 2 && STALLED.test(why)) throw coded(124, `donor-probe at ${width}px: ${why}`);
      if (r.status === 2) throw new UsageError(`donor-probe at ${width}px: ${why}`);
      const message = `donor-probe at ${width}px did not give a verdict (exit ${r.status ?? r.signal}): ${why}`;
      throw r.status === 3 ? coded(3, message) : new Error(message);
    }
    perWidth.push({ width, exit: r.status, report });
    const byLabel = new Map(probe.results.map((p) => [p.label, p]));
    for (const e of entries) {
      const got = byLabel.get(e.label);
      const isRoot = e.selector === ':root';
      const [slot, id] = isRoot ? [null, e.property] : e.label.split(' ');
      let status = 'FAIL';
      let detail = 'donor-probe reported nothing for this entry';
      if (got) {
        status = got.status === 'PASS' ? 'PASS' : 'FAIL';
        detail = /^selector ".*" matched nothing$/.test(got.detail) ? got.detail : `${got.detail} vs ${e.value}`;
      }
      results.push({ slot, id, node: isRoot ? null : nodeOf.get(`${slot} ${id}`), root: isRoot ? null : rootOf.get(`${slot} ${id}`), property: e.property, status, detail });
    }
  }

  results.push(...unasserted);
  const literals = tokenLiterals(await pageSource(target.url, preview ? auth : null), rootEntries);
  const result = { pass: results.every((x) => x.status !== 'FAIL'), results, perWidth, literals };
  writeFileSync(join(out, 'ramp.json'), `${JSON.stringify({ url: target.url, regime: target.regime, checksStamp: stampsOf(checks), ...result }, null, 2)}\n`);
  return result;
}
