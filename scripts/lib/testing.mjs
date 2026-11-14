// Helpers for the tests of the scripts: a tree in a temporary directory, a git repository
// with commits, a fake command on the PATH, and a run of a script that collects what it
// told GitHub Actions.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)));

export function tree(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'skills-scripts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, files);
  return root;
}

export function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};

// Runs the real git, not a wrapper that may be first on the PATH.
export function git(root, ...args) {
  const bin = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git'].find((path) => existsSync(path)) ?? 'git';
  return execFileSync(bin, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim();
}

// Commits everything in the tree and returns the commit.
export function commit(root, message = 'change') {
  if (!existsSync(join(root, '.git'))) git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '--all');
  git(root, 'commit', '-q', '--allow-empty', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

// A directory with fake commands, each a shell script, and the PATH that finds them
// before anything else. The real git stays reachable.
export function fakeBin(t, commands) {
  const bin = mkdtempSync(join(tmpdir(), 'skills-fake-bin-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  for (const [name, script] of Object.entries(commands)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter);
}

// Runs a script of scripts/ in root. Returns its exit status, output, step summary and step outputs.
export function run(t, script, args, { cwd, env = {} } = {}) {
  const out = mkdtempSync(join(tmpdir(), 'skills-actions-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...GIT_ENV, ...env, GITHUB_STEP_SUMMARY: join(out, 'summary'), GITHUB_OUTPUT: join(out, 'output') },
  });
  const read = (name) => (existsSync(join(out, name)) ? readFileSync(join(out, name), 'utf8') : '');
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, summary: read('summary'), output: read('output') };
}
