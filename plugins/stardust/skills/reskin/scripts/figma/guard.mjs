// skills/reskin/scripts/figma/guard.mjs — the --confidential guard. A Figma design under NDA would
// otherwise be committed by default: the stardust gitignore template ignores .work/ and screenshots,
// not the foundation, the candidates, the curated tokens or the rules. With --confidential, capture
// and curate check every path they would write BEFORE writing it — every fixed output, then the cache
// and screenshot paths that depend on the file version and frames, as soon as those are known — with
// one batched `git check-ignore`, and refuse (exit 2) with the exact lines to add to <dir>/.gitignore.
// A path that is not ignored (an ignore negation) or already tracked is refused, and so is any tracked
// file under a capture output directory, whether or not this run would write it. state.json is never
// checked: it must stay tracked; stamp --confidential stores a redacted URL instead.
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { UsageError } from './errors.mjs';
import { FOUNDATION_FILES } from './foundation.mjs';

// [path under <dir>, the .gitignore line that covers it]
export const CAPTURE_OUTPUTS = [
  ...FOUNDATION_FILES.map((f) => [`canon-source/foundation/${f}.json`, 'canon-source/foundation/']),
  ['canon-source/role-candidates.json', 'canon-source/role-candidates.json'],
  ['canon-source/module-candidates.json', 'canon-source/module-candidates.json'],
  ['canon-source/spec-tables.json', 'canon-source/spec-tables.json'],
  ['canon-source/assets/screenshots/index.json', 'canon-source/assets/screenshots/'],
  ['canon-source/_crawl-log.json', 'canon-source/_crawl-log.json'],
  ['.work/reskin/figma/current.json', '.work/'],
];
// Directories that hold nothing but capture output.
export const CAPTURE_NAMESPACES = [
  ['canon-source/foundation/', 'canon-source/foundation/'],
  ['canon-source/assets/screenshots/', 'canon-source/assets/screenshots/'],
  ['.work/reskin/figma/', '.work/'],
];
export const CURATE_OUTPUTS = [
  ['reskin/curation-rules.json', 'reskin/curation-rules.json'],
  ['reskin/donor-tokens.json', 'reskin/donor-tokens.json'],
  ['reskin/donor-modules.md', 'reskin/donor-modules.md'],
  ['canon-source/DESIGN.md', 'canon-source/DESIGN.md'],
  ['canon-source/DESIGN.json', 'canon-source/DESIGN.json'],
  ['canon-source/_brand-extraction.json', 'canon-source/_brand-extraction.json'],
];

const CHUNK = 200;

function git(args, { cwd, input } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new UsageError(`--confidential needs git to check that outputs are ignored (${r.error.code === 'ENOENT' ? 'git not found' : r.error.message})`);
  return r;
}

// The outputs git would track (with the namespaces' tracked files). Throws only when git cannot answer.
export function exposedOutputs(outputs, { dir = 'stardust', cwd = process.cwd(), namespaces = [] } = {}) {
  const wanted = new Map(outputs.map(([rel, line]) => [join(dir, rel), line]));
  const spaces = namespaces.map(([rel, line]) => [join(dir, rel), line]);
  if (!wanted.size && !spaces.length) return [];
  // ls-files prints paths relative to cwd, whatever form --dir took.
  const key = (p) => relative(cwd, resolve(cwd, p));

  const ignored = new Set();
  for (let i = 0; i < wanted.size; i += CHUNK) {
    const paths = [...wanted.keys()].slice(i, i + CHUNK);
    const r = git(['check-ignore', '-z', '--stdin'], { cwd, input: `${paths.join('\0')}\0` });
    if (r.status === 128 && /not a git repository/i.test(r.stderr)) throw new UsageError('not a git repository: --confidential needs one to check that every output is git-ignored');
    if (r.status !== 0 && r.status !== 1) throw new UsageError(`git check-ignore failed (exit ${r.status}): ${String(r.stderr).trim()}`);
    for (const p of r.stdout.split('\0')) if (p) ignored.add(p);
  }
  // check-ignore skips a tracked file even when a pattern matches it: list what is tracked.
  const tracked = new Set();
  const probes = [...wanted.keys(), ...spaces.map(([p]) => p)];
  for (let i = 0; i < probes.length; i += CHUNK) {
    const r = git(['--literal-pathspecs', 'ls-files', '-z', '--', ...probes.slice(i, i + CHUNK)], { cwd });
    if (r.status !== 0) throw new UsageError(`git ls-files failed (exit ${r.status}): ${String(r.stderr).trim()}`);
    for (const p of r.stdout.split('\0')) if (p) tracked.add(p);
  }

  const exposed = [];
  for (const [path, line] of wanted) if (!ignored.has(path) || tracked.has(key(path))) exposed.push({ path, line, tracked: tracked.has(key(path)) });
  const listed = new Set([...wanted.keys()].map(key));
  for (const path of tracked) {
    const space = spaces.find(([p]) => path.startsWith(`${key(p)}/`));
    if (space && !listed.has(path)) exposed.push({ path, line: space[1], tracked: true });
  }
  return exposed;
}

// The .gitignore lines still missing for later steps (capture → curate), so one edit covers the pipeline.
export function laterLines(later, opts = {}) {
  return later?.length ? [...new Set(exposedOutputs(later, opts).map((t) => t.line))] : [];
}

// later: outputs of the steps that follow (capture passes CURATE_OUTPUTS) — their missing lines join the
// refusal, so the user fixes .gitignore once instead of once per step.
export function assertIgnored(outputs, { dir = 'stardust', cwd = process.cwd(), namespaces = [], later = [] } = {}) {
  const exposed = exposedOutputs(outputs, { dir, cwd, namespaces });
  if (!exposed.length) return;
  const lines = [...new Set([...exposed.map((t) => t.line), ...laterLines(later, { dir, cwd })])];
  const trackedPaths = exposed.filter((t) => t.tracked).map((t) => t.path);
  throw new UsageError([
    `--confidential: ${exposed.length} output(s) would be tracked by git: ${exposed.map((t) => t.path).join(', ')}.`,
    `Nothing was written to them. Add these lines to ${dir}/.gitignore (below the template; the project owns them), then re-run:`,
    ...lines,
    ...(trackedPaths.length ? [`Already tracked, so .gitignore alone will not do: git rm --cached -- ${trackedPaths.join(' ')}`] : []),
  ].join('\n'));
}

// content (Figma-only, --confidential): the model holds the design's copy and the assets its images.
export const contentOutputs = (slug) => [
  [`reskin/content-model/${slug}/content-model.json`, 'reskin/content-model/'],
  [`reskin/content-model/${slug}/assets/x.png`, 'reskin/content-model/'],
  ['reskin/content-model/_chrome/content-model.json', 'reskin/content-model/'],
];
