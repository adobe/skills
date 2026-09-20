#!/usr/bin/env node
/**
 * write-design-json.mjs — Phase 4 (mechanical half) of stardust:extract: seed
 * stardust/current/DESIGN.json from _brand-extraction.json. The frontmatter-style
 * tokens (colors, typography, rounded, spacing, components) and the `extensions`
 * block (componentStyle, motifs, voice, systemComponents, scaleAudit…) are copied
 * from the brand surface — nothing is invented here. PRODUCT.md and DESIGN.md
 * prose stay LLM work (extract/SKILL.md § Phase 4); this script writes neither.
 *
 * Usage:
 *   node write-design-json.mjs [--out stardust/current] [--dry-run]
 *   node write-design-json.mjs --help
 *
 * Reads:  <out>/_brand-extraction.json (written by brand-surface.mjs)
 * Writes: <out>/DESIGN.json — _provenance first, schemaVersion 2, then
 *         colors · typography · rounded · spacing · components · extensions.
 *         Under a bounded brand surface (_provenance.mode "bounded") voice is
 *         absent from extensions and extensions.mode says so.
 *
 * Exit codes: 0 written / dry-printed · 2 usage, or <out>/_brand-extraction.json
 *   missing / unreadable (run brand-surface.mjs first — never seed from nothing).
 * Exports (tests): parseArgs, designJsonFrom — importing runs nothing; main() runs
 *   only when the file is the entry script.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `write-design-json — seed DESIGN.json (schemaVersion 2) from _brand-extraction.json
Usage: node write-design-json.mjs [--out stardust/current] [--dry-run]
Exit codes: 0 written/dry · 2 usage or missing _brand-extraction.json.`;

export function parseArgs(argv) {
  const rest = argv.slice(2);
  if (rest.includes('--help') || rest.includes('-h')) return { help: true };
  const o = { out: 'stardust/current', dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const val = () => { const v = rest[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${a} needs a value`); i += 1; return v; }; // a following flag is not a value (`--out --prep`)
    if (a === '--out') o.out = val();
    else if (a === '--dry-run') o.dryRun = true;
    else throw new Error(`unknown flag ${a}`);
  }
  return o;
}

const role = (brand, r) => ((brand.palette || []).find((p) => p.role === r) || {}).value || null;
const fam = (f) => (f ? { family: f.name, stack: f.stack, weights: f.weights || [], sizes: f.sizes || [], lineHeights: f.lineHeights || [], letterSpacing: f.letterSpacing || [] } : null);
const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Pure mapping brand surface → DESIGN.json object (_provenance first). */
export function designJsonFrom(brand, { readArtifact = 'stardust/current/_brand-extraction.json', now = new Date().toISOString() } = {}) {
  const accents = (brand.palette || []).filter((p) => /^accent-/.test(p.role)).map((p) => p.value);
  const bounded = brand._provenance && brand._provenance.mode === 'bounded';
  const t = brand.type || {}; const m = brand.motifs || {}; const sp = brand.spacing || {}; const cs = brand.componentStyle || {};
  return {
    _provenance: { writtenBy: 'stardust:extract', writtenAt: now, script: 'write-design-json.mjs', readArtifacts: [readArtifact], synthesizedInputs: [], mode: bounded ? 'bounded' : 'full' },
    schemaVersion: 2,
    colors: drop({ primary: role(brand, 'primary'), secondary: role(brand, 'secondary'), background: role(brand, 'background'), surface: role(brand, 'surface'), text: role(brand, 'text-primary'), textMuted: role(brand, 'text-secondary'), border: role(brand, 'border'), accents: accents.length ? accents : undefined, palette: (brand.palette || []).map((p) => ({ role: p.role, value: p.value, occurrences: p.occurrences, usedAs: p.usedAs })) }),
    typography: drop({ display: fam(t.headingFamily), body: fam(t.bodyFamily), mono: t.monoFamily || null, scaleRatio: t.scaleRatio ?? null, loadStrategy: t.loadStrategy || null, files: (t.files || []).map((f) => ({ family: f.family, weight: f.weight, style: f.style, localPath: f.localPath, url: f.url, licensingFlag: f.licensingFlag })) }),
    rounded: drop({ primary: (m.borderRadius || {}).primary || null, secondary: (m.borderRadius || {}).secondary || null, pill: (m.borderRadius || {}).pill || null }),
    spacing: drop({ baseUnit: sp.baseUnit ?? null, scale: sp.scale || [], sectionPadding: sp.sectionPadding || null, containerMaxWidth: sp.containerMaxWidth || null, gridGap: sp.gridGap || null }),
    components: drop({ buttons: cs.buttons || null, cards: cs.cards || null, inputs: cs.inputs || null, dualCTAPattern: cs.dualCTAPattern ?? null }),
    extensions: drop({
      mode: bounded ? 'bounded' : 'full',
      componentStyle: cs, motifs: m, voice: bounded ? undefined : brand.voice, voiceTable: bounded ? undefined : brand.voiceTable, crossPromo: bounded ? undefined : brand.crossPromo, register: bounded ? undefined : brand.register,
      systemComponents: brand.systemComponents || [], scaleAudit: t.scaleAudit || null, iconFont: brand.iconFont || null, logo: brand.logo || null, origins: brand.origins || [], site: brand.site || null,
      brandSurfaceNotes: (brand._provenance && brand._provenance.notes) || [],
    }),
  };
}

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (e) { console.error(`write-design-json: ${e.message}\n\n${HELP}`); process.exit(2); }
  if (args.help) { console.log(HELP); process.exit(0); }
  const src = path.join(args.out, '_brand-extraction.json');
  if (!existsSync(src)) { console.error(`write-design-json: ${src} missing — run brand-surface.mjs first (DESIGN.json is never seeded from nothing)`); process.exit(2); }
  let brand; try { brand = JSON.parse(readFileSync(src, 'utf8')); } catch (e) { console.error(`write-design-json: ${src} unreadable: ${e.message}`); process.exit(2); }
  if (!brand || typeof brand !== 'object' || !brand._provenance) { console.error(`write-design-json: ${src} has no _provenance — not a stardust brand surface`); process.exit(2); }
  const design = designJsonFrom(brand, { readArtifact: src });
  const target = path.join(args.out, 'DESIGN.json');
  if (args.dryRun) { console.log(JSON.stringify(design, null, 2)); console.log(`write-design-json (dry-run): would write ${target}`); return; }
  writeFileSync(target, `${JSON.stringify(design, null, 2)}\n`);
  console.log(`write-design-json: ${target} ← ${src} (mode ${design.extensions.mode}; colors ${Object.keys(design.colors).length - 1} roles · display ${design.typography.display ? design.typography.display.family : '-'} · rounded ${design.rounded.primary || '-'}). PRODUCT.md / DESIGN.md prose: author per extract/SKILL.md § Phase 4.`);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entry === import.meta.url) main();
