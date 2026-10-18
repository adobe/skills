// skills/reskin/scripts/figma-gate/register.mjs — B4, the divergence register: what the Figma checks say
// about a page, in six classes. mandated (a joined module section whose geometry and type entries all
// pass, with a result for every entry of the checks file as it stands, whose coverage floor is complete and that has no
// waiver: the page follows Figma there; none after a join drift), waived (each waiver of a section: its node's name and
// id or its width, its why, and the text styles and nodes it drops at which width; that section is not mandated),
// unmandated (each failing entry, and a "stale" row for a section whose results are not of this checks file), out-of-kit
// (each new-module mapping row: nothing in Figma to follow), conflict (a Figma text color, its alpha composited over its
// ground, that misses WCAG contrast in a root the section checks, so following Figma would ship an unreadable page) and pre-existing (each
// ledger flag).
// Pure: the CLI reads the step files and writes register.json and register.md.
import { findBox } from './boxes.mjs';
import { REFERENCE_CLASSES } from './pixel.mjs';
import { sectionStamp } from './stamp.mjs';
import { waiverImpacts } from './waivers.mjs';

const CLASSES = ['mandated', 'waived', 'unmandated', 'out-of-kit', 'conflict', 'pre-existing'];
const RGB = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d*\.?\d+)\s*)?\)/i;

// An rgb()/rgba() string as { rgb: [r, g, b], a }, or null.
function parse(css) {
  const m = RGB.exec(String(css ?? '').trim());
  return m ? { rgb: [m[1], m[2], m[3]].map(Number), a: m[4] === undefined ? 1 : Math.min(1, Number(m[4])) } : null;
}

// `top` painted over `under`, in sRGB as a browser blends it, to whole channel values.
const over = (top, under) => ({
  rgb: top.rgb.map((c, i) => Math.round(c * top.a + under.rgb[i] * (1 - top.a))),
  a: top.a + under.a * (1 - top.a),
});

const luminance = ({ rgb }) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// WCAG 2 contrast ratio of two rgb()/rgba() strings. A translucent fg is composited over bg first; a translucent bg has
// no colour of its own to measure against (composite it over what is behind it first), so it is NaN, as is either
// that is not an rgb()/rgba() string.
export function contrast(fg, bg) {
  const [f, b] = [parse(fg), parse(bg)];
  if (!f || !b || b.a < 1) return NaN;
  const [a, c] = [luminance(over(f, b)), luminance(b)];
  const [hi, lo] = a >= c ? [a, c] : [c, a];
  return (hi + 0.05) / (lo + 0.05);
}

const needFor = ({ fontSize, fontWeight }) => ((fontSize ?? 0) >= 24 || ((fontSize ?? 0) >= 18.66 && (fontWeight ?? 0) >= 700) ? 3 : 4.5);

// The opaque colour under a text: the nearest painting ancestor's solid, composited over the ones behind it for as long
// as it is translucent. `grounds` are the painting ancestors, outermost first. { css: null } when a gradient, image or
// composite paint comes first, or translucent solids reach the outermost with nothing opaque behind them (`translucent`
// says whether any translucent solid was met on the way).
function groundOf(grounds) {
  const layers = [];
  for (let i = grounds.length - 1; i >= 0; i -= 1) {
    const c = grounds[i].fillKind === 'SOLID' ? parse(grounds[i].fill) : null;
    if (!c) return { css: null, translucent: layers.length > 0 };
    layers.push(c);
    if (c.a >= 1) {
      if (layers.length === 1) return { css: grounds[i].fill };
      const [r, g, b] = layers.reduceRight((under, top) => over(top, under)).rgb;
      return { css: `rgb(${r}, ${g}, ${b})` };
    }
  }
  return { css: null, translucent: layers.length > 0 };
}

// Visible TEXT with a color against the ground under it (groundOf), the text's own alpha composited over it. A ground
// that is a gradient, an image or a composite, or that is missing, is skipped (no honest single background); so is a
// translucent text or ground with no opaque ground behind it to composite over, which is also pushed to `unassessable`
// ({ node, fg, why }) when given. `grounds` are the painting ancestors of `box` outside it (outermost first), `seen` the
// ids of the nodes an earlier scan of the same section assessed (skipped here, and added to for the next scan).
export function mandateConflicts(box, { grounds = [], seen = null, unassessable = null } = {}) {
  const hits = [];
  const visited = new Set();
  const walk = (b, painting) => {
    visited.add(b.id);
    const fg = b.type === 'TEXT' && b.text?.color && b.text.characters.trim() !== '' && !seen?.has(b.id) ? parse(b.text.color) : null;
    if (fg) {
      const ground = groundOf(painting);
      if (ground.css) {
        const ratio = contrast(b.text.color, ground.css);
        const need = needFor(b.text);
        if (ratio < need) hits.push({ node: b.id, ratio: Math.round(ratio * 100) / 100, need, fg: b.text.color, bg: ground.css });
      } else if (unassessable && (fg.a < 1 || ground.translucent)) {
        unassessable.push({ node: b.id, fg: b.text.color, why: `no opaque ground resolves behind a translucent ${fg.a < 1 ? 'text color' : 'ground'}` });
      }
    }
    const next = b.fillKind !== 'NONE' ? [...painting, b] : painting;
    for (const c of b.children) walk(c, next);
  };
  walk(box, grounds);
  if (seen) for (const id of visited) seen.add(id);
  return hits;
}

// The roots a section renders and checks, base root first: the validated checks' `root` and `roots` (width → node id),
// else the joined frame.
function checkedRoots(section, frameId) {
  const ids = [...new Set([section?.root, ...Object.values(section?.roots ?? {})].filter((id) => typeof id === 'string' && id))];
  return ids.length ? ids : [frameId].filter(Boolean);
}

// The painting ancestors of node `id` inside `frame`, outermost first, or null when it is not inside it.
function paintingAbove(frame, id) {
  const path = [];
  const walk = (b) => {
    if (b.id === id) return true;
    path.push(b);
    if (b.children.some(walk)) return true;
    path.pop();
    return false;
  };
  return walk(frame) ? path.filter((b) => b.fillKind !== 'NONE') : null;
}

const failing = (r) => r.status !== 'PASS' && r.status !== 'UNASSERTED';
const asserted = (r) => r.status !== 'UNASSERTED';

// Why geometry.json and ramp.json cannot vouch for this section of the checks file as it stands, or null: an entry of
// the file has no result (an entry added, or an id renamed, since the run), or a step file was measured against another
// version of the section (its stamp is missing or differs: a tolerance, a node or a root changed).
function staleWhy(slot, section, geometry, ramp) {
  if (!section) return 'the checks file has no section for it';
  const ids = (file) => new Set((file.results || []).filter((r) => r.slot === slot).map((r) => r.id));
  const [haveG, haveT] = [ids(geometry), ids(ramp)];
  const missing = [...section.geometry.filter((e) => !haveG.has(e.id)), ...section.type.filter((e) => !haveT.has(e.id))].map((e) => e.id);
  if (missing.length) return `${missing.length} ${missing.length === 1 ? 'entry' : 'entries'} of the checks file ${missing.length === 1 ? 'has' : 'have'} no result (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''})`;
  const old = [['geometry.json', geometry], ['ramp.json', ramp]].filter(([, file]) => file.checksStamp?.[slot] !== sectionStamp(section)).map(([name]) => name);
  return old.length ? `${old.join(' and ')} measured another version of the section` : null;
}

// checks is the validated checks (prepare's checks: each section's root, roots, entries, waive and skip) and coverage its
// per-slot coverage floor ({ styles: { covered, total }, widths, waived }); boxes must hold the roots the checks name.
// Without coverage or checks nothing is mandated: it is not run. A section is also not mandated when its results are not of this
// checks file (staleWhy): an unmandated "stale" row says why. A waived row names its node or width, quotes the why and
// says what it drops.
export function buildRegister({ join, geometry, ramp, pixel, mapping, boxes, flags, link, checks, coverage }) {
  const rows = [];
  const row = (cls, slot, module, node, check, detail) => rows.push({ class: cls, slot, module, node, check, detail, link: node ? link(node) : null });
  const sections = join.sections || [];
  const moduleOf = (slot) => sections.find((s) => s.slot === slot)?.module ?? null;
  const drifted = join.pass === false;
  const notRun = [...(drifted ? ['join drift'] : []), ...[['geometry', geometry], ['ramp', ramp], ['pixel', pixel]].filter(([, v]) => !v).map(([k]) => k), ...(!drifted && !(coverage && checks) ? ['coverage'] : [])];

  const geo = geometry?.results || [];
  const typ = ramp?.results || [];

  // A row points at the checks root its results were measured against. Results that carry none (step files written
  // before roots were recorded) fall back to the join's module frame for a mandated row, to the entry's own node for a failing one.
  // A section is mandated only when it passes on results of this checks file, its text styles are all covered and
  // nothing in it was waived; its waivers are rows of their own, whatever its results.
  for (const s of drifted ? [] : sections.filter((x) => x.module)) {
    const g = geo.filter((r) => r.slot === s.slot && asserted(r));
    const t = typ.filter((r) => r.slot === s.slot && asserted(r));
    const cov = coverage?.[s.slot];
    const stale = geometry && ramp && checks ? staleWhy(s.slot, checks[s.slot], geometry, ramp) : null;
    const passes = Boolean(geometry && ramp && checks) && !stale && g.length + t.length > 0 && ![...g, ...t].some(failing);
    const tally = `${g.length} geometry and ${t.length} type entries pass`;
    if (stale) row('unmandated', s.slot, s.module, s.node, 'stale', `${stale}: re-run figma-gate all`);
    if (passes && cov?.waived === 0) {
      if (cov.styles.covered === cov.styles.total) row('mandated', s.slot, s.module, [...g, ...t].find((r) => r.root)?.root ?? s.node, 'geometry and type', tally);
      else row('unmandated', s.slot, s.module, s.node, 'coverage', `text styles ${cov.styles.covered}/${cov.styles.total} have a type entry`);
    }
    for (const w of waiverImpacts(checks?.[s.slot], s, boxes)) row('waived', s.slot, s.module, w.node ?? s.node, w.check, passes ? `${w.detail} · ${tally}` : w.detail);
  }
  for (const r of geo.filter(failing)) row('unmandated', r.slot, moduleOf(r.slot), r.root ?? r.node ?? null, `geometry ${r.id} ${r.measure}`, r.detail ?? '');
  for (const r of typ.filter(failing)) {
    if (r.slot === null) row('unmandated', null, null, null, `:root ${r.id}`, r.detail ?? '');
    else row('unmandated', r.slot, moduleOf(r.slot), r.root ?? r.node ?? null, `type ${r.id} ${r.property}`, r.detail ?? '');
  }
  for (const m of mapping.filter((x) => x.status === 'new-module')) {
    row('out-of-kit', m.slot, null, null, 'new-module', 'no Figma module to follow: the slot is composed beyond the kit');
  }
  // Conflicts are looked for in what a section renders and checks: its base root and every per-width root (the validated
  // checks' `roots`), not the whole module frame, which also holds documentation and variants it never measures. A root
  // inside the joined frame keeps the frame's painting above it as its ground; a node several roots hold is assessed once.
  const unassessable = [];
  for (const s of sections) {
    const frame = s.node && boxes?.roots?.[s.node]?.box;
    const seen = new Set();
    for (const id of checkedRoots(checks?.[s.slot], s.node)) {
      const above = frame ? paintingAbove(frame, id) : null;
      const target = above ? findBox(frame, id) : boxes?.roots?.[id]?.box;
      if (!target) continue;
      const lacking = [];
      for (const c of mandateConflicts(target, { grounds: above ?? [], seen, unassessable: lacking })) {
        row('conflict', s.slot, s.module, c.node, 'contrast', `${c.ratio.toFixed(2)}:1 < ${c.need}:1 (${c.fg} on ${c.bg})`);
      }
      unassessable.push(...lacking.map((u) => ({ slot: s.slot, module: s.module, ...u })));
    }
  }
  for (const f of flags || []) row('pre-existing', null, null, null, 'ledger flag', f);

  rows.sort((a, b) => CLASSES.indexOf(a.class) - CLASSES.indexOf(b.class));
  const counts = Object.fromEntries(CLASSES.map((c) => [c, rows.filter((r) => r.class === c).length]));
  return { regime: join.regime ?? null, counts, rows, notRun, unassessable, pixel: pixel ? pixel.results : null };
}

export const countsLine = (counts) => CLASSES.map((c) => `${c} ${counts[c]}`).join(' · ');

// The coverage of all the module sections as the ledger records it: text styles with a type entry over all of them, the
// widths checked, the waivers (a section skip counts as one).
export function coverageLine(coverage) {
  const all = Object.values(coverage ?? {});
  const sum = (f) => all.reduce((n, c) => n + f(c), 0);
  const widths = [...new Set(all.flatMap((c) => c.widths))].sort((a, b) => a - b);
  return `text styles ${sum((c) => c.styles.covered)}/${sum((c) => c.styles.total)} · widths ${widths.join(',') || 'none'} · waived ${sum((c) => c.waived)}`;
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

function pixelLine(r) {
  if (r.verdict === 'advisory') return `${r.slot} ${r.pct.toFixed(2)}% (text ${r.textPct === null || r.textPct === undefined ? 'n/a' : `${r.textPct.toFixed(2)}%`}, Δh ${r.heightDelta})`;
  return `${r.slot} ${r.verdict === 'n/a' ? 'n/a' : 'no verdict'}: ${r.reason}`;
}

export function registerMd(register) {
  const { page, regime, counts, rows, notRun, pixel, unassessable } = register;
  const out = [`# Divergence register: ${page}`, ''];
  out.push(`${countsLine(counts)}${regime ? ` · regime ${regime}` : ''}`, '');
  if (notRun.length) out.push(`Not run: ${notRun.join(', ')}`, '');
  if (unassessable?.length) out.push(`Contrast not assessed: ${unassessable.length} text${unassessable.length === 1 ? '' : 's'} whose color or ground is translucent with no opaque ground behind it (${unassessable.slice(0, 5).map((u) => u.node).join(', ')}${unassessable.length > 5 ? ', …' : ''})`, '');
  for (const cls of CLASSES) {
    const mine = rows.filter((r) => r.class === cls);
    if (!mine.length) continue;
    out.push(`## ${cls} (${mine.length})`, '', '| Slot | Module | Node | Check | Detail | Link |', '|---|---|---|---|---|---|');
    for (const r of mine) out.push(`| ${cell(r.slot ?? '—')} | ${cell(r.module ?? '—')} | ${cell(r.node ?? '—')} | ${cell(r.check)} | ${cell(r.detail)} | ${r.link ? `[Figma](${r.link})` : '—'} |`);
    out.push('');
  }
  if (pixel?.length) {
    const ref = REFERENCE_CLASSES;
    out.push('## Pixel (advisory)', '', `Reference classes are uncalibrated (light text ${ref.lightText}%, inverted ${ref.inverted}%, raster ground ${ref.rasterGround}%): orientation, not a bar. Nothing here fails the gate.`, '');
    for (const r of pixel) out.push(`- ${pixelLine(r)}`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
