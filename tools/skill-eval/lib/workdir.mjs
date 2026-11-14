import { execFile } from 'node:child_process';
import { copyFile, cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { exists } from './scenarios.mjs';

const execFileAsync = promisify(execFile);

function confined(root, p) {
  const abs = resolve(root, p);
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`installPath escapes workdir: ${p}`);
  return abs;
}

export async function walk(dir, { skip = [] } = {}, base = dir, out = []) {
  for (const name of await readdir(dir)) {
    if (skip.includes(name)) continue;
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) await walk(p, { skip }, base, out);
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

export function selectFiles(files, include, exclude) {
  const inc = include?.length ? include : null;
  return files.filter(
    (f) => (!inc || inc.some((g) => matchesGlob(f, g))) && !(exclude ?? []).some((g) => matchesGlob(f, g)),
  );
}

async function copyFiles(srcDir, destDir, files) {
  for (const f of files) {
    const to = join(destDir, f);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(srcDir, f), to);
  }
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}

const inflight = new Map();

export function fetchCommit(cacheDir, repoUrl, ref) {
  const key = Buffer.from(`${repoUrl}#${ref}`).toString('base64url');
  if (!inflight.has(key)) {
    inflight.set(
      key,
      (async () => {
        const dir = join(cacheDir, key);
        if (await exists(join(dir, '.done'))) return dir;
        await mkdir(dir, { recursive: true });
        await git(dir, 'init', '-q');
        await git(dir, 'fetch', '-q', '--depth', '1', repoUrl, ref);
        await git(dir, 'checkout', '-q', 'FETCH_HEAD');
        await copyFile(join(dir, '.git', 'HEAD'), join(dir, '.done'));
        return dir;
      })(),
    );
  }
  return inflight.get(key);
}

async function freshRepo(dir, remote) {
  await git(dir, 'init', '-q');
  if (remote) await git(dir, 'remote', 'add', 'origin', remote);
  await git(dir, 'add', '-A');
  await git(dir, '-c', 'user.name=skill-eval', '-c', 'user.email=skill-eval@localhost', 'commit', '-q', '--allow-empty', '-m', 'fixture');
}

export function normalizeFixtures(config) {
  const fixtures = { ...(config.fixtures ?? {}) };
  if (config.fixture && !fixtures.codebase) fixtures.codebase = { type: 'commit', ...config.fixture };
  return fixtures;
}

export async function setupScripts(scenario) {
  const list = (scenario.config.setup ?? []).map((s) => resolve(scenario.dir, s));
  const auto = join(scenario.dir, 'setup.sh');
  if (!list.includes(auto) && (await exists(auto))) list.push(auto);
  return list;
}

export async function includeDirs(scenario) {
  if (scenario.config.include) return scenario.config.include;
  return (await exists(join(scenario.dir, 'resources'))) ? ['./resources'] : [];
}

export async function assembleWorkdir(scenario, workDir, { cacheDir }) {
  await mkdir(workDir, { recursive: true });
  for (const [name, fx] of Object.entries(normalizeFixtures(scenario.config))) {
    if (fx.type === 'commit') {
      const src = await fetchCommit(cacheDir, fx.repoUrl, fx.ref);
      const dest = confined(workDir, fx.installPath ?? '.');
      const files = selectFiles(
        (await walk(src, { skip: ['.git'] })).filter((f) => f !== '.done'),
        fx.include,
        fx.exclude,
      );
      await copyFiles(src, dest, files);
      await freshRepo(dest, fx.remote);
    } else if (fx.type === 'directory') {
      if (!fx.installPath) throw new Error(`${scenario.name}: directory fixture ${name} needs installPath`);
      const src = resolve(scenario.dir, fx.path);
      await copyFiles(src, confined(workDir, fx.installPath), selectFiles(await walk(src), fx.include, fx.exclude));
    } else {
      throw new Error(`${scenario.name}: unsupported fixture type ${fx.type} (${name})`);
    }
  }
  for (const inc of await includeDirs(scenario)) {
    const src = resolve(scenario.dir, inc);
    let ok = false;
    try {
      ok = (await stat(src)).isDirectory();
    } catch {}
    if (!ok) throw new Error(`${scenario.name}: include ${inc} is not a directory`);
    await cp(src, confined(workDir, relative(scenario.dir, src)), { recursive: true });
  }
  return setupScripts(scenario);
}
