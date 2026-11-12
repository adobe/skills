import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import { exists } from './scenarios.mjs';

const execFileAsync = promisify(execFile);
const SYSTEM_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

export const PROVIDER_DOMAINS = [
  '*.githubcopilot.com',
  'api.github.com',
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
];

export const WORKER_DOMAINS = [
  ...PROVIDER_DOMAINS,
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'aem.live',
  '*.aem.live',
  '*.aem.page',
  '*.hlx.live',
  '*.hlx.page',
  'da.live',
  '*.da.live',
  '*.adobe.io',
];

const PROXY_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'NODE_USE_ENV_PROXY', 'NONO_PROXY_TOKEN', 'NONO_NO_PROXY'];

export async function which(bin) {
  const { stdout } = await execFileAsync('/usr/bin/which', [bin], { encoding: 'utf8' });
  return stdout.trim();
}

export const DEFAULT_CONCURRENCY = 5;

export const LOCAL_PORTS = [
  [1024, 17000],
  [35729, 35729],
];

export async function writeProfile(path, workdirAccess, domains, localPorts = []) {
  if (!domains?.length) throw new Error('writeProfile needs a network allowlist');
  const network = { allow_domain: domains };
  if (localPorts.length) network.open_port_range = localPorts;
  const profile = {
    extends: 'default',
    meta: { name: `skill-eval-${workdirAccess}`, description: 'skill-eval isolated pi run' },
    groups: { include: ['node_runtime', 'python_runtime'] },
    workdir: { access: workdirAccess },
    network,
  };
  await writeFile(path, JSON.stringify(profile, null, 2));
  return path;
}

const pendingCleanups = new Set();
const liveRoots = new Set();

export async function makeSandboxRoot() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'p-'));
  liveRoots.add(root);
  return root;
}

export async function moveDir(src, dest) {
  await mkdir(dirname(dest), { recursive: true });
  try {
    await rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await cp(src, dest, { recursive: true, verbatimSymlinks: true });
    await rm(src, { recursive: true, force: true });
  }
}

export async function removeDir(dir) {
  liveRoots.delete(dir);
  await rm(dir, { recursive: true, force: true });
}

export function keepDir(dir) {
  liveRoots.delete(dir);
}

export async function archiveWorkdir(root, work, dest) {
  try {
    if (await exists(work)) await moveDir(work, dest);
  } catch (e) {
    keepDir(root);
    return { error: `could not move workdir: ${e.message}`, kept: work };
  }
  await removeDir(root);
  return {};
}

export async function killStrays(root) {
  let real = root;
  try {
    real = await realpath(root);
  } catch {}
  let out = '';
  try {
    ({ stdout: out } = await execFileAsync('lsof', ['-a', '-d', 'cwd', '-F', 'pn'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch (e) {
    out = e.stdout ?? '';
  }
  const pids = [];
  let pid = null;
  for (const line of out.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid && pid !== process.pid) {
      const cwd = line.slice(1);
      if (cwd === real || cwd.startsWith(`${real}/`)) pids.push(pid);
    }
  }
  for (const p of pids) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {}
  }
  return pids;
}

export async function cleanupAll() {
  await Promise.all([...pendingCleanups].map((fn) => fn()));
  await Promise.all([...liveRoots].map(removeDir));
}

export async function prepareAgentHome(root, { authFile = join(homedir(), '.pi', 'agent', 'auth.json') } = {}) {
  const home = join(root, 'home');
  const agentDir = join(home, '.pi', 'agent');
  const tmp = join(root, 'tmp');
  await Promise.all([home, agentDir, tmp].map((d) => mkdir(d, { recursive: true })));
  const auth = join(agentDir, 'auth.json');
  const cleanup = async () => {
    pendingCleanups.delete(cleanup);
    await rm(auth, { force: true });
  };
  pendingCleanups.add(cleanup);
  if (await exists(authFile)) {
    await copyFile(authFile, auth);
    await chmod(auth, 0o600);
  }
  return { home, agentDir, tmp, cleanup };
}

async function gitPath(cwd, path, fallback) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-path', path], { cwd, encoding: 'utf8' });
    return resolve(cwd, stdout.trim());
  } catch {
    return fallback;
  }
}

export async function installContext(context, { work, agentDir }) {
  const skillsRoot = join(work, '.agents', 'skills');
  for (const s of context.skills) {
    if (await exists(join(skillsRoot, basename(s.dir)))) {
      throw new Error(`skill ${basename(s.dir)} already exists in the project's .agents/skills`);
    }
  }
  const agentsExisted = await exists(join(work, '.agents'));
  const skillsRootExisted = await exists(skillsRoot);
  const skills = [];
  let excludeFile = join(work, '.git', 'info', 'exclude');
  let originalExclude = null;
  const removeIfEmpty = async (d) => {
    try {
      await rmdir(d);
    } catch (e) {
      if (e.code !== 'ENOTEMPTY' && e.code !== 'ENOENT' && e.code !== 'EEXIST') throw e;
    }
  };
  const uninstall = async () => {
    for (const s of skills) await rm(s.dir, { recursive: true, force: true });
    if (!skillsRootExisted) await removeIfEmpty(skillsRoot);
    if (!agentsExisted) await removeIfEmpty(join(work, '.agents'));
    if (originalExclude !== null) await writeFile(excludeFile, originalExclude);
  };
  const rules = [];
  try {
    for (const s of context.skills) {
      const dir = join(skillsRoot, basename(s.dir));
      skills.push({ ...s, dir });
      await cp(s.dir, dir, { recursive: true });
    }
    if (skills.length && (await exists(join(work, '.git')))) {
      excludeFile = await gitPath(work, 'info/exclude', excludeFile);
      const current = (await exists(excludeFile)) ? await readFile(excludeFile, 'utf8') : '';
      originalExclude = current;
      await mkdir(dirname(excludeFile), { recursive: true });
      const lines = skills.map((s) => `/.agents/skills/${basename(s.dir)}/`).join('\n');
      await writeFile(excludeFile, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${lines}\n`);
    }
    for (const r of context.rules) {
      const to = join(agentDir, 'rules', basename(r));
      await mkdir(dirname(to), { recursive: true });
      await copyFile(r, to);
      rules.push(to);
    }
  } catch (e) {
    await uninstall();
    throw e;
  }
  return { skills, rules, uninstall };
}

export function sandboxEnv({ home, agentDir, tmp, piBin }) {
  const npmPrefix = join(home, '.npm-global');
  const path = [join(npmPrefix, 'bin'), dirname(process.execPath), dirname(piBin), ...SYSTEM_PATH];
  return {
    HOME: home,
    PI_CODING_AGENT_DIR: agentDir,
    TMPDIR: tmp,
    PATH: [...new Set(path)].join(':'),
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    TERM: 'dumb',
    NO_COLOR: '1',
    npm_config_prefix: npmPrefix,
    npm_config_cache: join(home, '.npm'),
    npm_config_update_notifier: 'false',
  };
}

export function sandboxedCommand({ profile, cwd, allow = [], read = [], env, command, args }) {
  const nonoArgs = ['run', '-s', '-p', profile, '--no-rollback', '--workdir', cwd];
  for (const p of allow) nonoArgs.push('--allow', p);
  for (const p of read) nonoArgs.push('--read', p);
  const envArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  const forward = PROXY_ENV.map((k) => `\${${k}+"${k}=$${k}"}`).join(' ');
  const reset = `exec /usr/bin/env -i ${forward} "$@"`;
  return { command: 'nono', args: [...nonoArgs, '--', '/bin/sh', '-c', reset, 'sh', ...envArgs, command, ...args] };
}

const activeChildren = new Set();

export function killAll() {
  for (const child of activeChildren) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
}

export async function runProcess({ command, args, cwd, stdoutFile, stderrFile, timeoutMs, onStdout }) {
  await mkdir(dirname(stdoutFile), { recursive: true });
  const out = createWriteStream(stdoutFile);
  const err = createWriteStream(stderrFile);
  const started = Date.now();
  const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  activeChildren.add(child);
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  let timedOut = false;
  let stopped = false;
  const terminate = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, 5000).unref();
    } catch {}
  };
  if (onStdout) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stopped) return;
      let stop = false;
      try {
        stop = onStdout(chunk) === true;
      } catch {}
      if (stop) {
        stopped = true;
        terminate();
      }
    });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, 5000).unref();
    } catch {}
  }, timeoutMs);
  const { code, signal } = await new Promise((resolve) => {
    child.once('error', (e) => {
      err.write(String(e.stack ?? e));
      resolve({ code: null, signal: null });
    });
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  activeChildren.delete(child);
  clearTimeout(timer);
  out.end();
  err.end();
  await Promise.all([finished(out), finished(err)]);
  return { exitCode: code, signal, timedOut, stopped, durationMs: Date.now() - started };
}

export function piArgs({ model, thinking, skills = [], rules = [], tools, noTools = false, prompt, contextFiles = false }) {
  const args = ['-p', '--mode', 'json', '--no-session', '-ne', '-ns', '--no-mcp', '-na', '-np', '--no-themes'];
  if (!contextFiles) args.push('-nc');
  if (model) args.push('--model', model);
  if (thinking) args.push('--thinking', thinking);
  if (noTools) args.push('--no-tools');
  else if (tools) args.push('--tools', tools);
  for (const s of skills) args.push('--skill', s);
  for (const r of rules) args.push('--append-system-prompt', r);
  args.push(prompt);
  return args;
}
