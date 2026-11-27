#!/usr/bin/env node
// skills/reskin/scripts/foundation-css.mjs — the base rules deployed-gate tokens asserts, written from the donor token
// sheet into the EDS project's styles/styles.css at C0, before the foundation freeze. Hand-authored base CSS drifted
// from the sheet in recorded runs (a white heading, a 12px 24px button padding) and, frozen, stayed that way.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootTokens } from './render/root-tokens.mjs';

const HELP = `usage: node stardust/scripts/reskin/foundation-css.mjs [--dir stardust] [--styles <file>] [--check]

Writes one marked block, generated from <dir>/reskin/donor-tokens.json, at the end of <styles> (default
styles/styles.css under the project root, the parent of --dir), replacing the block a previous run wrote:
  :root            every token render/root-tokens.mjs derives (the :root rows deployed-gate tokens asserts)
  body             background-color palette.pageBg, color palette.bodyFg, font-family type.family,
                   font-size type.body.fontSize, line-height type.body.lineHeight
  main h1          font-weight type.display.fontWeight
  main h2          color palette.headingFg
  main a.button.primary  background-color, color, border-radius, padding, font-size of buttons.primary.*
A value the sheet does not carry is left out. The block sits last, so it wins over the boilerplate's rules of the
same specificity; a block's own scoped rule still wins over it. Run it at C0, before foundation-freeze.mjs freeze;
afterwards a change is a foundation request, never a second run.
--check  writes nothing: exit 1 when the file's block differs from what the sheet gives (or is missing).
Exit: 0 written or current · 1 --check found a difference · 2 usage or setup (no sheet, no styles file, a bad value).`;

const START = '/* stardust:foundation-css start: generated from donor-tokens.json by foundation-css.mjs; edit the sheet */';
const END = '/* stardust:foundation-css end */';
const RULES = [
  ['body', [['background-color', 'palette.pageBg'], ['color', 'palette.bodyFg'], ['font-family', 'type.family'], ['font-size', 'type.body.fontSize'], ['line-height', 'type.body.lineHeight']]],
  ['main h1', [['font-weight', 'type.display.fontWeight']]],
  ['main h2', [['color', 'palette.headingFg']]],
  ['main a.button.primary', [['background-color', 'buttons.primary.background'], ['color', 'buttons.primary.color'], ['border-radius', 'buttons.primary.borderRadius'], ['padding', 'buttons.primary.padding'], ['font-size', 'buttons.primary.fontSize']]],
];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lookup = (tokens, path) => path.split('.').reduce((o, k) => (isObject(o) ? o[k] : undefined), tokens);
const present = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

export function foundationBlock(tokens) {
  const parts = [rootTokens(tokens).css.trimEnd()];
  for (const [selector, decls] of RULES) {
    const lines = [];
    for (const [prop, path] of decls) {
      const value = lookup(tokens, path);
      if (!present(value)) continue;
      if (typeof value !== 'string' || /[;{}<\n\r]/.test(value)) throw new Error(`${path} must be a CSS value string, got ${JSON.stringify(value)}`);
      lines.push(`  ${prop}: ${value.trim()};`);
    }
    if (lines.length) parts.push(`${selector} {\n${lines.join('\n')}\n}`);
  }
  return `${START}\n${parts.join('\n\n')}\n${END}\n`;
}

// The stylesheet with the block in place of a previous one, else appended.
export function withBlock(css, block) {
  const at = css.indexOf(START);
  const end = at < 0 ? -1 : css.indexOf(END, at);
  if (at >= 0 && end >= 0) return `${css.slice(0, at)}${block}${css.slice(end + END.length).replace(/^\n/, '')}`;
  return `${css.replace(/\n*$/, '\n')}\n${block}`;
}

export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return 0; }
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--dir' || a === '--styles') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) { console.error(`${a} needs a value\n\n${HELP}`); return 2; }
      opts[a.slice(2)] = argv[i += 1];
    } else { console.error(`unknown argument ${a}\n\n${HELP}`); return 2; }
  }
  const dir = opts.dir ?? 'stardust';
  const sheet = join(dir, 'reskin', 'donor-tokens.json');
  const styles = opts.styles ?? join(dirname(resolve(dir)), 'styles', 'styles.css');
  if (!existsSync(sheet)) { console.error(`missing ${sheet}: the donor token sheet comes first`); return 2; }
  if (!existsSync(styles)) { console.error(`missing ${styles}: pass --styles <file>`); return 2; }
  let block;
  try { block = foundationBlock(JSON.parse(readFileSync(sheet, 'utf8'))); } catch (e) { console.error(`${sheet}: ${e.message}`); return 2; }
  const css = readFileSync(styles, 'utf8');
  const next = withBlock(css, block);
  if (opts.check) {
    if (next === css) { console.log(`current: ${styles}`); return 0; }
    console.log(`differs: ${styles} (run foundation-css.mjs without --check at C0, or queue a foundation request)`);
    return 1;
  }
  if (next !== css) writeFileSync(styles, next);
  console.log(`${next === css ? 'current' : 'written'}: ${styles}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
