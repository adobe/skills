// What the releases of skills and plugins share: which skills and plugins a release may
// touch, the version something had before a push, and the tag that semantic-release
// counts from.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// Brought in from another repository, with the versions they have there. A release here
// would be overwritten by the next import, so these are left alone. run-workflow's plugin
// is versioned here; its skill comes from upstream with a version of its own.
export const IMPORTED = [
  'plugins/commerce/',
  'plugins/creative-cloud/adobe-for-creativity/',
  'plugins/creative-cloud/run-workflow/skills/',
];
export const isImported = (path) => IMPORTED.some((prefix) => `${path}/`.startsWith(prefix));

// semver.org's own expression, without build metadata, which a tag can't carry
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
export const isVersion = (value) => typeof value === 'string' && SEMVER.test(value);

// Skill folders that share their name with another one. A skill is tagged <folder>-v<version>,
// so two of them would count from each other's tags.
export function duplicateNames(skillDirs) {
  const seen = new Map();
  for (const dir of skillDirs) seen.set(basename(dir), (seen.get(basename(dir)) ?? 0) + 1);
  return new Set([...seen].filter(([, count]) => count > 1).map(([name]) => name));
}

// The version in the frontmatter of a SKILL.md (metadata.version), or undefined.
export function skillVersion(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const metadata = block.match(/^metadata:[ \t]*\r?\n((?:[ \t]+.*\r?\n?)*)/m)?.[1] ?? '';
  return metadata.match(/^[ \t]+version:[ \t]*["']?([^"'\s#]+)/m)?.[1];
}

// The version in a plugin manifest, or undefined.
export function manifestVersion(text) {
  try {
    const { version } = JSON.parse(text);
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// A file as it was at a commit, or null when it wasn't there or the commit isn't known.
export function fileAt(root, commit, file) {
  try {
    return git(root, ['show', `${commit}:${file}`]);
  } catch {
    return null;
  }
}

export const knownCommit = (commit) => typeof commit === 'string' && commit !== '' && !/^0+$/.test(commit);

// A file as it was before the push. When the commit before the push isn't known (a first
// push, a force push), the file as it is now stands in: it shows whether there is a version
// that a release would have to count from.
export function fileBefore(root, before, file) {
  if (knownCommit(before)) return fileAt(root, before, file);
  return existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null;
}

// semantic-release counts from the last tag of its format, and starts at 1.0.0 without
// one. Something that already has a version and no tag yet gets one first: on the commit
// before this push, with the version it had there, so that the push is what is released.
//   'tagged'    there are tags already
//   'created'   the tag was made (and pushed, unless push is false)
//   'first'     no version before this push: the first release is 1.0.0
//   'unknown'   it has a version, but the commit before the push isn't known: don't
//               release, or 1.0.0 would follow a higher version
export function ensureBaseline(root, { prefix, version, before, push = true, remote = 'origin' }) {
  const tags = git(root, ['tag', '--list', `${prefix}*`]).split('\n').filter((tag) => isVersion(tag.slice(prefix.length)));
  if (tags.length > 0) return 'tagged';
  if (!isVersion(version)) return 'first';
  if (!knownCommit(before)) return 'unknown';
  const tag = `${prefix}${version}`;
  git(root, ['tag', tag, before]);
  if (push) {
    const pushed = spawnSync('git', ['push', remote, `refs/tags/${tag}`], { cwd: root, encoding: 'utf8' });
    if (pushed.status !== 0) console.log(`::warning::The tag ${tag} was made but not pushed: ${(pushed.stderr ?? '').trim()}`);
  }
  return 'created';
}
