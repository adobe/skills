// Report: how much skill prose a change adds or removes — advisory, never a gate.
//
// Every line of skills/**/*.md is re-read by the model on each turn that loads the skill, so an
// addition should look for prose to fold elsewhere (a rationale duplicated between a SKILL.md and
// its reference doc, an anecdote told twice, a rule the addition supersedes). This prints the
// numbers that conversation needs: per changed file, lines and words before → after, then the net
// total. The baseline is a git ref (default origin/main, then main); with no usable ref the report
// says so and exits 0 — the reviewer still has the PR diff.
//
// Usage: node plugins/stardust/evals/lint/prose-delta.mjs [--ref <git-ref>] [--all]
//   --ref <ref>   baseline ref (default: origin/main, else main)
//   --all         list every file, not only the changed ones
// Exit: always 0.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
const refArg = argv.includes('--ref') ? argv[argv.indexOf('--ref') + 1] : null;
const all = argv.includes('--all');
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const count = (text) => ({ lines: text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0, words: text ? (text.match(/\S+/g) || []).length : 0 });

let ref = null;
for (const r of refArg ? [refArg] : ['origin/main', 'main']) { try { git(['rev-parse', '--verify', `${r}^{commit}`]); ref = r; break; } catch { /* next */ } }
if (!ref) { console.log(`prose-delta: no baseline ref (${refArg || 'origin/main, main'}) in this checkout — fetch one to see the delta; nothing to fail`); process.exit(0); }

const PATH = 'plugins/stardust/skills';
const before = new Map(git(['ls-tree', '-r', '--name-only', ref, '--', PATH]).split('\n').filter((f) => f.endsWith('.md')).map((f) => [f, count(git(['show', `${ref}:${f}`]))]));
const after = new Map(git(['ls-files', '--cached', '--others', '--exclude-standard', '--', PATH]).split('\n').filter((f) => f.endsWith('.md')).map((f) => { try { return [f, count(readFileSync(resolve(REPO, f), 'utf8'))]; } catch { return [f, null]; } }).filter(([, c]) => c));

const rows = [];
const total = { before: { lines: 0, words: 0 }, after: { lines: 0, words: 0 } };
for (const f of new Set([...before.keys(), ...after.keys()])) {
  const b = before.get(f) || { lines: 0, words: 0 }; const a = after.get(f) || { lines: 0, words: 0 };
  total.before.lines += b.lines; total.before.words += b.words; total.after.lines += a.lines; total.after.words += a.words;
  if (all || b.lines !== a.lines || b.words !== a.words) rows.push({ f: f.replace(`${PATH}/`, ''), b, a });
}
const signed = (n) => (n > 0 ? `+${n}` : String(n));
rows.sort((x, y) => (y.a.words - y.b.words) - (x.a.words - x.b.words));
for (const { f, b, a } of rows) console.log(`  ${signed(a.lines - b.lines).padStart(6)} lines  ${signed(a.words - b.words).padStart(7)} words  ${f}  (${b.lines}→${a.lines} / ${b.words}→${a.words})`);
const dl = total.after.lines - total.before.lines; const dw = total.after.words - total.before.words;
console.log(`prose-delta vs ${ref}: ${signed(dl)} lines, ${signed(dw)} words across skill docs (${total.before.lines}→${total.after.lines} lines, ${total.before.words}→${total.after.words} words)${dw > 0 ? ' — added prose: is there duplicated rationale, a twice-told anecdote or a superseded rule to fold?' : ''}`);
