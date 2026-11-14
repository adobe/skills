import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

async function git(cwd, ...args) {
  try {
    return (await run('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
  } catch (e) {
    throw new Error(`git ${args.join(' ')}: ${(e.stderr || e.message).trim()}`);
  }
}

async function gitOk(cwd, ...args) {
  try {
    await run('git', ['-C', cwd, ...args]);
    return true;
  } catch {
    return false;
  }
}

export function parseTake(spec) {
  const i = spec.indexOf(':');
  if (i <= 0 || i === spec.length - 1) throw new Error(`--take ${spec}: expected <ref>:<path>`);
  const path = spec.slice(i + 1).replace(/^\/+|\/+$/g, '');
  if (!path || path.split('/').includes('..')) throw new Error(`--take ${spec}: path must be inside the repo`);
  return { ref: spec.slice(0, i), path };
}

export async function buildContext({ repo = '.', base, takes = [], out, name }) {
  if (!base) throw new Error('--base <ref> is required');
  if (!out) throw new Error('--out <dir> is required');
  const outDir = resolve(out);
  const label = name ?? basename(outDir);
  if (!NAME.test(label)) throw new Error(`name ${label}: may only use letters, digits, . _ -`);
  const top = await git(resolve(repo), 'rev-parse', '--show-toplevel');
  const baseSha = await git(top, 'rev-parse', '--verify', `${base}^{commit}`);
  const parsed = takes.map(parseTake);
  const resolved = [];
  for (const t of parsed) resolved.push({ ...t, sha: await git(top, 'rev-parse', '--verify', `${t.ref}^{commit}`) });

  await git(top, 'worktree', 'add', '--detach', outDir, baseSha);
  const present = [];
  for (const t of resolved) {
    await git(outDir, 'rm', '-r', '-q', '-f', '--ignore-unmatch', '--', t.path);
    const inRef = await gitOk(outDir, 'cat-file', '-e', `${t.sha}:${t.path}`);
    if (inRef) await git(outDir, 'checkout', t.sha, '--', t.path);
    present.push(inRef);
  }
  await git(outDir, '-c', 'user.name=skill-eval', '-c', 'user.email=skill-eval@localhost', 'commit', '-q', '--allow-empty', '-m', `skill-eval ctx ${label}: ${base} + ${resolved.map((t) => `${t.ref}:${t.path}`).join(' ') || 'nothing'}`);
  const commit = await git(outDir, 'rev-parse', 'HEAD');

  const takesOut = [];
  for (const [i, t] of resolved.entries()) {
    const same = await gitOk(outDir, 'diff', '--quiet', t.sha, 'HEAD', '--', t.path);
    if (!same) throw new Error(`context ${label}: ${t.path} differs from ${t.ref} after taking it`);
    takesOut.push({ ref: t.ref, sha: t.sha, path: t.path, present: present[i] });
  }
  await git(top, 'update-ref', `refs/skill-eval/ctx/${label}`, commit);
  const manifest = { name: label, out: outDir, commit, base: { ref: base, sha: baseSha }, takes: takesOut, createdAt: new Date().toISOString() };
  const manifestPath = join(top, '.skill-eval', 'ctx', `${label}.json`);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { ...manifest, manifest: manifestPath };
}

export async function removeContext({ repo = '.', target, dropRef = false }) {
  const top = await git(resolve(repo), 'rev-parse', '--show-toplevel');
  const dir = resolve(target);
  await git(top, 'worktree', 'remove', '--force', dir);
  if (dropRef) await git(top, 'update-ref', '-d', `refs/skill-eval/ctx/${basename(dir)}`);
  return { removed: dir, refKept: !dropRef };
}
