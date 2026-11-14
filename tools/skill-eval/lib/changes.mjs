import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { exists } from './scenarios.mjs';
import { walk } from './workdir.mjs';

const SKIP = ['node_modules', '.git'];
const DEFAULT_MAX_CHARS = 120_000;

async function listFiles(dir) {
  return (await exists(dir)) ? (await walk(dir, { skip: SKIP })).sort() : [];
}

export async function snapshotWorkdir(work, snap) {
  for (const f of await listFiles(work)) {
    await mkdir(dirname(join(snap, f)), { recursive: true });
    await copyFile(join(work, f), join(snap, f));
  }
  await mkdir(snap, { recursive: true });
}

async function sameContent(a, b) {
  const [x, y] = await Promise.all([readFile(a), readFile(b)]);
  return x.equals(y);
}

function gitDiff(a, b, limit) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['diff', '--no-index', '--no-color', '--', a, b], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let cut = false;
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (cut) return;
      out += chunk;
      if (out.length > limit) {
        cut = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (!cut && code !== 0 && code !== 1) return reject(new Error(`git diff failed (${code}): ${stderr.trim()}`));
      resolve({ text: out, cut });
    });
  });
}

export async function describeChanges(snap, work, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const snapAbs = await realpath(snap);
  const workAbs = await realpath(work);
  const before = new Set(await listFiles(snapAbs));
  const after = new Set(await listFiles(workAbs));
  const files = [];
  for (const p of [...new Set([...before, ...after])].sort()) {
    if (!before.has(p)) files.push({ status: 'A', path: p });
    else if (!after.has(p)) files.push({ status: 'D', path: p });
    else if (!(await sameContent(join(snapAbs, p), join(workAbs, p)))) files.push({ status: 'M', path: p });
  }
  let diff = '';
  let truncated = false;
  for (const [i, f] of files.entries()) {
    const a = f.status === 'A' ? '/dev/null' : join(snapAbs, f.path);
    const b = f.status === 'D' ? '/dev/null' : join(workAbs, f.path);
    const { text, cut } = await gitDiff(a, b, maxChars - diff.length + Math.max(snapAbs.length, workAbs.length) * 4);
    const part = text.replaceAll(`${snapAbs}/`, '/').replaceAll(`${workAbs}/`, '/');
    if (cut || diff.length + part.length > maxChars) {
      diff += part.slice(0, Math.max(0, maxChars - diff.length));
      diff += `\n… diff truncated (${files.length - i} file(s) not fully shown)\n`;
      truncated = true;
      break;
    }
    diff += part;
  }
  return { files, diff, truncated };
}
