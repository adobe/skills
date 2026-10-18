// skills/reskin/scripts/figma-gate/register.mjs — B4, the divergence register: what the Figma checks say
// about a page, in six classes. mandated (a joined module section whose geometry and type entries all
// pass, with a result for every entry of the checks file as it stands, whose coverage floor is complete and that has no
// waiver: the page follows Figma there; none after a join drift), waived (each waiver of a section: its node's name and
// id or its width, its why, and the text styles and nodes it drops at which width; that section is not mandated),
// unmandated (each failing entry, and a "stale" row for a section whose results are not of this checks file), out-of-kit
// (each new-module mapping row: nothing in Figma to follow), conflict (a Figma text color that
// misses WCAG contrast on its own ground, so following Figma would ship an unreadable page) and pre-existing (each
// ledger flag).
// Pure: the CLI reads the step files and writes register.json and register.md.
import { REFERENCE_CLASSES } from './pixel.mjs';
import { sectionStamp } from './stamp.mjs';
import { waiverImpacts } from './waivers.mjs';

const CLASSES = ['mandated', 'waived', 'unmandated', 'out-of-kit', 'conflict', 'pre-existing'];
const RGB = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i;

function luminance(css) {
  const m = RGB.exec(String(css ?? ''));
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG 2 contrast ratio of two rgb()/rgba() strings (alpha ignored); NaN when either is not one.
export function contrast(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)];
  if (a === null || b === null) return NaN;
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const needFor = ({ fontSize, fontWeight }) => ((fontSize ?? 0) >= 24 || ((fontSize ?? 0) >= 18.66 && (fontWeight ?? 0) >= 700) ? 3 : 4.5);

// Visible TEXT with a solid color against the nearest painting ancestor inside the root; a gradient,
// image or composite ground, or no painting ancestor, is skipped (no honest single background).
export function mandateConflicts(box) {
  const hits = [];
  const walk = (b, ground) => {
    if (b.type === 'TEXT' && b.text?.color && b.text.characters.trim() !== '' && ground?.fillKind === 'SOLID') {
      const ratio = contrast(b.text.color, ground.fill);
      const need = needFor(b.text);
      if (ratio < need) hits.push({ node: b.id, ratio: Math.round(ratio * 100) / 100, need, fg: b.text.color, bg: ground.fill });
    }
    const next = b.fillKind !== 'NONE' ? b : ground;
    for (const c of b.children) walk(c, next);
  };
  walk(box, null);
  return hits;
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
  for (const s of sections) {
    const root = s.node && boxes?.roots?.[s.node]?.box;
    if (!root) continue;
    for (const c of mandateConflicts(root)) {
      row('conflict', s.slot, s.module, c.node, 'contrast', `${c.ratio.toFixed(2)}:1 < ${c.need}:1 (${c.fg} on ${c.bg})`);
    }
  }
  for (const f of flags || []) row('pre-existing', null, null, null, 'ledger flag', f);

  rows.sort((a, b) => CLASSES.indexOf(a.class) - CLASSES.indexOf(b.class));
  const counts = Object.fromEntries(CLASSES.map((c) => [c, rows.filter((r) => r.class === c).length]));
  return { regime: join.regime ?? null, counts, rows, notRun, pixel: pixel ? pixel.results : null };
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
  const { page, regime, counts, rows, notRun, pixel } = register;
  const out = [`# Divergence register: ${page}`, ''];
  out.push(`${countsLine(counts)}${regime ? ` · regime ${regime}` : ''}`, '');
  if (notRun.length) out.push(`Not run: ${notRun.join(', ')}`, '');
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
