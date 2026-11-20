// Whether the installs of this repository that skills hand to users are pinned to something
// that stays: a release of main.
//
// A skill may install a package of this repository from git, pinned to a commit:
//   npx -y pnpm@… add --dir "$DIR" "github:adobe/skills#<sha>&path:/plugins/web/cli"
// Pull requests are squash-merged, so a commit of a pull request's branch is never on main.
// Only its branch and the pull request's ref keep it, and the install breaks once those go
// (migrate-header 1.0.0 shipped pinned to such a commit). Such a pin also needs a person to
// move it: no Renovate manager reads it. So this fails when a pin in plugins/:
//   - is a commit that is not on the base branch, or that no release tag points at;
//   - is a short commit, a branch or a tag that does not exist (a pin is a full commit or a tag);
//   - sits in a file that names another commit as a cache folder (`web-cli-<sha7>`): the install
//     line skips the install when that folder holds one, so users would keep the old one.
// A ref written as a placeholder (`#<sha>`) is documentation and not checked.
//
//   node scripts/check-pins.mjs [<base>]     default: origin/main
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { error, summary } from './lib/actions.mjs';
import { isMain } from './lib/is-main.mjs';

// An install specifier, not an issue reference (adobe/skills#533): github:adobe/skills#<ref>,
// or a git URL of github.com/adobe/skills with a #<ref>.
const PIN = /(?:\bgithub:|github\.com[:/])adobe\/skills(?:\.git)?#([^\s"'`&)<>]+)(?=[\s"'`&)]|$)/g;
const FULL = /^[0-9a-f]{40}$/;
// A commit named as the suffix of a folder or file name: web-cli-0242a4a.
const NAMED = /[\w.][\w.-]*-([0-9a-f]{7,40})\b/g;

const git = (root, ...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

// The pins in the text of one file, as { line, ref }.
export function pinsIn(text) {
  const pins = [];
  text.split('\n').forEach((content, index) => {
    for (const match of content.matchAll(PIN)) pins.push({ line: index + 1, ref: match[1] });
  });
  return pins;
}

// The files under plugins/ that pin this repository, from git.
function pinningFiles(root) {
  const out = git(root, 'grep', '-l', '-E', '(github:|github\\.com[:/])adobe/skills(\\.git)?#', '--', 'plugins');
  return out ? out.split('\n').filter(Boolean) : [];
}

// What is wrong with the pins of the given files, as { file, line, message }.
export function problems(root, base, files = pinningFiles(root)) {
  const found = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    const commits = [];
    for (const { line, ref } of pinsIn(text)) {
      const at = (message) => found.push({ file, line, message });
      if (FULL.test(ref)) {
        commits.push(ref);
        if (git(root, 'cat-file', '-e', `${ref}^{commit}`) === null) {
          at(`pins ${ref}, a commit that is not in this repository's history. Pin a release commit of ${base}.`);
          continue;
        }
        if (git(root, 'merge-base', '--is-ancestor', ref, base) === null) {
          at(`pins ${ref.slice(0, 7)}, a commit that is not on ${base}: a squash merge leaves it behind. Pin a release commit of ${base}.`);
          continue;
        }
        if (!git(root, 'tag', '--points-at', ref)) {
          at(`pins ${ref.slice(0, 7)}, a commit of ${base} that no release tag points at. Pin the commit of a release (git rev-list -n 1 <tag>).`);
        }
      } else if (/^[0-9a-f]{7,39}$/.test(ref)) {
        at(`pins ${ref}, a short commit. Pin the full commit of a release.`);
      } else if (git(root, 'rev-parse', '-q', '--verify', `refs/tags/${ref}^{commit}`) === null) {
        at(`pins ${ref}, which is not a tag of this repository: a branch moves. Pin the full commit of a release.`);
      }
    }
    if (commits.length === 0) continue;
    text.split('\n').forEach((content, index) => {
      for (const match of content.matchAll(NAMED)) {
        const named = match[1];
        if (!/\d/.test(named) || commits.some((sha) => sha.startsWith(named))) continue;
        found.push({ file, line: index + 1, message: `names the commit ${named} in ${match[0]}, but the file pins ${commits.map((sha) => sha.slice(0, 7)).join(', ')}. A cache folder named after the old commit keeps the old install.` });
      }
    });
  }
  return found;
}

function main() {
  const root = process.cwd();
  const base = process.argv[2] || 'origin/main';
  if (git(root, 'rev-parse', '-q', '--verify', `${base}^{commit}`) === null) {
    error(`${base} is not in this checkout: fetch it (actions/checkout with fetch-depth: 0).`);
    process.exit(1);
  }
  const found = problems(root, base);
  if (found.length === 0) {
    console.log(`Every install of this repository that a skill pins is a release commit of ${base}.`);
    return;
  }
  for (const { file, line, message } of found) error(`${file}:${line}: ${message}`);
  summary(['### Pins of adobe/skills', '', ...found.map(({ file, line, message }) => `- \`${file}:${line}\` ${message}`)]);
  process.exit(1);
}

if (isMain(import.meta.url)) main();
