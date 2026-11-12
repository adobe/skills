import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { archiveWorkdir, cleanupAll, installContext, LOCAL_PORTS, makeSandboxRoot, moveDir, piArgs, prepareAgentHome, PROVIDER_DOMAINS, removeDir, sandboxedCommand, WORKER_DOMAINS, writeProfile } from '../lib/sandbox.mjs';
import { exists } from '../lib/scenarios.mjs';

const execFileAsync = promisify(execFile);

test('sandbox roots live in the OS temp dir with neutral names, outside the repo', async () => {
  const root = await makeSandboxRoot();
  try {
    assert.equal(dirname(root), await realpath(tmpdir()));
    assert.match(basename(root), /^p-[A-Za-z0-9]+$/);
    assert.ok(!root.startsWith(process.cwd()));
    for (let d = root; d !== dirname(d); d = dirname(d)) {
      assert.equal(await exists(join(d, 'package.json')), false, `package.json above workdir at ${d}`);
    }
  } finally {
    await removeDir(root);
  }
  assert.equal(await exists(root), false);
});

test('profiles restrict network to an allowlist', async () => {
  const root = await makeSandboxRoot();
  try {
    const worker = JSON.parse(await readFile(await writeProfile(join(root, 'w.json'), 'readwrite', WORKER_DOMAINS), 'utf8'));
    const judge = JSON.parse(await readFile(await writeProfile(join(root, 'j.json'), 'read', PROVIDER_DOMAINS), 'utf8'));
    for (const p of [worker, judge]) assert.notEqual(p.network.block, false);
    assert.deepEqual(worker.network.allow_domain, WORKER_DOMAINS);
    assert.deepEqual(judge.network.allow_domain, PROVIDER_DOMAINS);
    for (const d of PROVIDER_DOMAINS) assert.ok(WORKER_DOMAINS.includes(d));
    for (const d of ['registry.npmjs.org', 'github.com', '*.aem.live', '*.da.live']) assert.ok(WORKER_DOMAINS.includes(d));
    assert.ok(!PROVIDER_DOMAINS.includes('registry.npmjs.org'));
    assert.deepEqual(judge.network.open_port_range, undefined);
    const local = JSON.parse(await readFile(await writeProfile(join(root, 'l.json'), 'readwrite', WORKER_DOMAINS, LOCAL_PORTS), 'utf8'));
    assert.deepEqual(local.network.open_port_range, LOCAL_PORTS);
    for (const p of [3000, 3201, 3977, 4502, 8765, 35729]) assert.ok(LOCAL_PORTS.some(([a, b]) => a <= p && p <= b), String(p));
    assert.ok(LOCAL_PORTS.reduce((n, [a, b]) => n + b - a + 1, 0) <= 16384);
    await assert.rejects(writeProfile(join(root, 'x.json'), 'read'));
  } finally {
    await removeDir(root);
  }
});

test('sandboxedCommand forwards only nono proxy variables past the env reset', () => {
  const { command, args } = sandboxedCommand({ profile: 'p.json', cwd: '/w', env: { HOME: '/h', PATH: '/bin' }, command: 'pi', args: ['-p', 'hi'] });
  assert.equal(command, 'nono');
  const rest = args.slice(args.indexOf('--') + 1);
  assert.equal(rest[0], '/bin/sh');
  assert.equal(rest[1], '-c');
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'NONO_PROXY_TOKEN']) assert.ok(rest[2].includes(`\${${k}+"${k}=$${k}"}`), k);
  assert.match(rest[2], /^exec \/usr\/bin\/env -i .* "\$@"$/);
  assert.deepEqual(rest.slice(3), ['sh', 'HOME=/h', 'PATH=/bin', 'pi', '-p', 'hi']);
});

test('archiveWorkdir moves the workdir out and removes the sandbox root', async () => {
  const root = await makeSandboxRoot();
  const dest = await makeSandboxRoot();
  await mkdir(join(root, 'project'), { recursive: true });
  await writeFile(join(root, 'project', 'f.txt'), 'x');
  assert.deepEqual(await archiveWorkdir(root, join(root, 'project'), join(dest, 'attempt', 'work')), {});
  assert.equal(await readFile(join(dest, 'attempt', 'work', 'f.txt'), 'utf8'), 'x');
  assert.equal(await exists(root), false);
  await removeDir(dest);
});

test('archiveWorkdir keeps the source when the move fails and global cleanup spares it', async () => {
  const root = await makeSandboxRoot();
  const blocker = await makeSandboxRoot();
  await mkdir(join(root, 'project'), { recursive: true });
  await writeFile(join(root, 'project', 'f.txt'), 'x');
  await writeFile(join(blocker, 'file'), 'not a dir');
  const r = await archiveWorkdir(root, join(root, 'project'), join(blocker, 'file', 'work'));
  assert.match(r.error, /could not move workdir/);
  assert.equal(r.kept, join(root, 'project'));
  await removeDir(blocker);
  await cleanupAll();
  assert.equal(await readFile(join(root, 'project', 'f.txt'), 'utf8'), 'x');
  await removeDir(root);
});

async function runContext(src) {
  const runCtx = join(src, 'runs', '2026-label', 'context', 'org-p');
  for (const n of ['alpha', 'beta']) {
    await mkdir(join(runCtx, 'skills', n, 'scripts'), { recursive: true });
    await writeFile(join(runCtx, 'skills', n, 'SKILL.md'), `---\nname: ${n}\n---\n`);
    await writeFile(join(runCtx, 'skills', n, 'scripts', 'x.js'), '');
  }
  await mkdir(join(runCtx, 'rules'), { recursive: true });
  await writeFile(join(runCtx, 'rules', '00-style.md'), 'rule');
  return {
    skills: ['alpha', 'beta'].map((n) => ({ name: n, dir: join(runCtx, 'skills', n) })),
    rules: [join(runCtx, 'rules', '00-style.md')],
  };
}

test('skills are hidden from git when the project is a git worktree', async () => {
  const src = await makeSandboxRoot();
  const root = await makeSandboxRoot();
  try {
    const context = await runContext(src);
    const main = join(root, 'main');
    const work = join(root, 'project');
    await mkdir(main, { recursive: true });
    const git = (cwd, ...args) => execFileAsync('git', args, { cwd });
    await git(main, 'init', '-q');
    await git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    await git(main, 'worktree', 'add', '-q', '-b', 'feature', work);
    const sandbox = await prepareAgentHome(root);

    const installed = await installContext(context, { work, agentDir: sandbox.agentDir });
    const { stdout } = await git(work, 'status', '--porcelain', '--untracked-files=all');
    assert.equal(stdout, '');

    await installed.uninstall();
    assert.equal(await exists(join(work, '.agents')), false);
    await sandbox.cleanup();
  } finally {
    await removeDir(src);
    await removeDir(root);
  }
});

test('skills install into the project .agents/skills, hidden from git, and uninstall cleanly', async () => {
  const src = await makeSandboxRoot();
  const root = await makeSandboxRoot();
  try {
    const context = await runContext(src);
    const work = join(root, 'project');
    await mkdir(join(work, '.git', 'info'), { recursive: true });
    await writeFile(join(work, '.git', 'info', 'exclude'), '# original\n');
    await mkdir(join(work, '.agents', 'skills', 'project-own'), { recursive: true });
    await writeFile(join(work, '.agents', 'skills', 'project-own', 'SKILL.md'), 'shipped by the project');
    const sandbox = await prepareAgentHome(root);

    const installed = await installContext(context, { work, agentDir: sandbox.agentDir });
    assert.deepEqual(installed.skills.map((s) => s.dir), [join(work, '.agents', 'skills', 'alpha'), join(work, '.agents', 'skills', 'beta')]);
    assert.ok(await exists(join(work, '.agents', 'skills', 'beta', 'scripts', 'x.js')));
    assert.deepEqual(installed.rules, [join(sandbox.agentDir, 'rules', '00-style.md')]);
    const exclude = await readFile(join(work, '.git', 'info', 'exclude'), 'utf8');
    assert.ok(exclude.startsWith('# original') && exclude.includes('/.agents/skills/alpha/') && exclude.includes('/.agents/skills/beta/'));
    const args = piArgs({ skills: installed.skills.map((s) => s.dir), rules: installed.rules, prompt: 'task' }).join(' ');
    assert.ok(!args.includes(src), 'worker args reference the run folder');
    assert.ok(!args.includes('/home/.pi/agent/skills'), 'skills must not look like a home install');

    await installed.uninstall();
    assert.equal(await exists(join(work, '.agents', 'skills', 'alpha')), false);
    assert.equal(await exists(join(work, '.agents', 'skills', 'beta')), false);
    assert.ok(await exists(join(work, '.agents', 'skills', 'project-own', 'SKILL.md')));
    assert.equal(await readFile(join(work, '.git', 'info', 'exclude'), 'utf8'), '# original\n');
    await sandbox.cleanup();
  } finally {
    await removeDir(src);
    await removeDir(root);
  }
});

test('uninstall removes an .agents folder it created and refuses to overwrite project skills', async () => {
  const src = await makeSandboxRoot();
  const root = await makeSandboxRoot();
  try {
    const context = await runContext(src);
    const work = join(root, 'project');
    await mkdir(work, { recursive: true });
    const sandbox = await prepareAgentHome(root);
    const installed = await installContext(context, { work, agentDir: sandbox.agentDir });
    assert.equal(await exists(join(work, '.git')), false);
    await installed.uninstall();
    assert.equal(await exists(join(work, '.agents')), false);

    await mkdir(join(work, '.agents', 'skills', 'alpha'), { recursive: true });
    await assert.rejects(installContext(context, { work, agentDir: sandbox.agentDir }), /alpha.*already exists/);
    await sandbox.cleanup();
  } finally {
    await removeDir(src);
    await removeDir(root);
  }
});

test('uninstall keeps anything the agent added under .agents', async () => {
  const src = await makeSandboxRoot();
  const root = await makeSandboxRoot();
  try {
    const context = await runContext(src);
    const work = join(root, 'project');
    await mkdir(work, { recursive: true });
    const sandbox = await prepareAgentHome(root);
    const installed = await installContext(context, { work, agentDir: sandbox.agentDir });
    await mkdir(join(work, '.agents', 'skills', 'agent-made'), { recursive: true });
    await writeFile(join(work, '.agents', 'skills', 'agent-made', 'SKILL.md'), 'new');
    await writeFile(join(work, '.agents', 'config.json'), '{}');
    await installed.uninstall();
    assert.ok(await exists(join(work, '.agents', 'skills', 'agent-made', 'SKILL.md')));
    assert.ok(await exists(join(work, '.agents', 'config.json')));
    assert.equal(await exists(join(work, '.agents', 'skills', 'alpha')), false);
    await sandbox.cleanup();
  } finally {
    await removeDir(src);
    await removeDir(root);
  }
});

test('a failed install rolls back skills and the git exclude change', async () => {
  const src = await makeSandboxRoot();
  const root = await makeSandboxRoot();
  try {
    const context = await runContext(src);
    context.rules.push(join(src, 'missing-rule.md'));
    const work = join(root, 'project');
    await mkdir(join(work, '.git', 'info'), { recursive: true });
    await writeFile(join(work, '.git', 'info', 'exclude'), '# original\n');
    const sandbox = await prepareAgentHome(root);
    await assert.rejects(installContext(context, { work, agentDir: sandbox.agentDir }), /missing-rule/);
    assert.equal(await exists(join(work, '.agents')), false);
    assert.equal(await readFile(join(work, '.git', 'info', 'exclude'), 'utf8'), '# original\n');
    await sandbox.cleanup();
  } finally {
    await removeDir(src);
    await removeDir(root);
  }
});

test('moveDir moves a tree into a new parent', async () => {
  const root = await makeSandboxRoot();
  try {
    await mkdir(join(root, 'src', 'a'), { recursive: true });
    await writeFile(join(root, 'src', 'a', 'f.txt'), 'hi');
    await moveDir(join(root, 'src'), join(root, 'out', 'nested', 'dest'));
    assert.equal(await readFile(join(root, 'out', 'nested', 'dest', 'a', 'f.txt'), 'utf8'), 'hi');
    assert.equal(await exists(join(root, 'src')), false);
  } finally {
    await removeDir(root);
  }
});

test('piArgs --no-tools wins over a tool allowlist and keeps context files off', () => {
  const args = piArgs({ model: 'm', noTools: true, tools: 'read', prompt: 'p' });
  assert.ok(args.includes('--no-tools'));
  assert.ok(!args.includes('--tools'));
  assert.ok(args.includes('-nc') && args.includes('-ns'));
  assert.equal(args.at(-1), 'p');
});

test('runProcess stops the child when onStdout returns true', async () => {
  const { runProcess } = await import('../lib/sandbox.mjs');
  const dir = await makeSandboxRoot();
  try {
    const r = await runProcess({
      command: '/bin/sh',
      args: ['-c', 'echo first; sleep 30; echo never'],
      cwd: dir,
      stdoutFile: `${dir}/o.txt`,
      stderrFile: `${dir}/e.txt`,
      timeoutMs: 60_000,
      onStdout: (c) => c.includes('first'),
    });
    assert.equal(r.stopped, true);
    assert.equal(r.timedOut, false);
    assert.ok(r.durationMs < 10_000);
  } finally {
    await removeDir(dir);
  }
});

test('killStrays stops background processes left in the attempt dir', async () => {
  const { killStrays } = await import('../lib/sandbox.mjs');
  const { spawn } = await import('node:child_process');
  const root = await makeSandboxRoot();
  const other = await makeSandboxRoot();
  try {
    await mkdir(join(root, 'project'), { recursive: true });
    const stray = spawn('/bin/sleep', ['60'], { cwd: join(root, 'project'), detached: true, stdio: 'ignore' });
    stray.unref();
    const keep = spawn('/bin/sleep', ['60'], { cwd: other, detached: true, stdio: 'ignore' });
    keep.unref();
    await new Promise((r) => setTimeout(r, 200));
    const killed = await killStrays(root);
    assert.deepEqual(killed, [stray.pid]);
    await new Promise((r) => setTimeout(r, 200));
    assert.throws(() => process.kill(stray.pid, 0));
    assert.doesNotThrow(() => process.kill(keep.pid, 0));
    process.kill(keep.pid, 'SIGKILL');
  } finally {
    await removeDir(root);
    await removeDir(other);
  }
});
