// skills/reskin/scripts/figma/guard.mjs — the --confidential guard. A Figma design under NDA would
// otherwise be committed by default: the stardust gitignore template ignores .work/ and screenshots,
// not the foundation, the candidates, the curated tokens or the rules. With --confidential, capture
// and curate check every path they would write with `git check-ignore` BEFORE any write or request,
// and refuse (exit 2) with the exact lines to add to <dir>/.gitignore. state.json is never checked:
// it must stay tracked; stamp --confidential stores a redacted URL instead.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { UsageError } from './errors.mjs';

// [path under <dir>, the .gitignore line that covers it]
export const CAPTURE_OUTPUTS = [
  ['canon-source/foundation/colors.json', 'canon-source/foundation/'],
  ['canon-source/role-candidates.json', 'canon-source/role-candidates.json'],
  ['canon-source/module-candidates.json', 'canon-source/module-candidates.json'],
  ['canon-source/spec-tables.json', 'canon-source/spec-tables.json'],
  ['canon-source/assets/screenshots/index.json', 'canon-source/assets/screenshots/'],
  ['canon-source/_crawl-log.json', 'canon-source/_crawl-log.json'],
  ['.work/reskin/figma/current.json', '.work/'],
];
export const CURATE_OUTPUTS = [
  ['reskin/curation-rules.json', 'reskin/curation-rules.json'],
  ['reskin/donor-tokens.json', 'reskin/donor-tokens.json'],
  ['reskin/donor-modules.md', 'reskin/donor-modules.md'],
  ['canon-source/DESIGN.md', 'canon-source/DESIGN.md'],
  ['canon-source/DESIGN.json', 'canon-source/DESIGN.json'],
  ['canon-source/_brand-extraction.json', 'canon-source/_brand-extraction.json'],
];

export function assertIgnored(outputs, { dir = 'stardust', cwd = process.cwd() } = {}) {
  const exposed = [];
  for (const [rel, line] of outputs) {
    const path = join(dir, rel);
    const r = spawnSync('git', ['check-ignore', '-q', '--', path], { cwd, encoding: 'utf8' });
    if (r.error) throw new UsageError(`--confidential needs git to check that outputs are ignored (${r.error.code === 'ENOENT' ? 'git not found' : r.error.message})`);
    if (r.status === 128) throw new UsageError('not a git repository: --confidential needs one to check that every output is git-ignored');
    if (r.status === 1) {
      // check-ignore says "not ignored" for a tracked file even when a pattern matches it.
      const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd, encoding: 'utf8' }).status === 0;
      exposed.push({ path, line, tracked });
    } else if (r.status !== 0) throw new UsageError(`git check-ignore failed (exit ${r.status}): ${String(r.stderr).trim()}`);
  }
  if (!exposed.length) return;
  const lines = [...new Set(exposed.map((t) => t.line))];
  const tracked = exposed.filter((t) => t.tracked).map((t) => t.path);
  throw new UsageError([
    `--confidential: ${exposed.length} output(s) would be tracked by git: ${exposed.map((t) => t.path).join(', ')}.`,
    `Nothing was written. Add these lines to ${dir}/.gitignore (below the template; the project owns them), then re-run:`,
    ...lines,
    ...(tracked.length ? [`Already tracked, so .gitignore alone will not do: git rm --cached -- ${tracked.join(' ')}`] : []),
  ].join('\n'));
}
