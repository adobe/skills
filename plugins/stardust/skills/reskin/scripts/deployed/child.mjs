// skills/reskin/scripts/deployed/child.mjs — what the deployed steps that run another script as a child process share
// (`tokens` runs donor-probe, `content` runs dom-equality and slot-coverage, `parity` and `sanity` run the instruments
// of replica and diff). A library, no CLI.
//   childEnv(env)                 the child's environment: this process's, with `env` over it
//   runChild(command, args, { env })   the child collected, as spawnSync's result ({ status, signal, stdout, stderr });
//                                 async, so a server in this process can answer it while the child runs
//   outputOf(result)              the child's own words (stderr, else stdout)
//   callTool(name, script, args, env)  an instrument run with node: its result; exit 3 thrown with code 3, a spawn
//                                 failure with code 124
//   exitOf, firstLine, parseJson  the exit (or signal) of a result, the first non-blank line of a text, JSON or null
//   setupError(result, { name })  the error for a child that exited 2 (a UsageError) or 3 (code 3: a bot
//                                 challenge); null for any other exit
//   coded(code, message)          an Error whose .code is the gate's exit code (3 or 124)
import { spawn } from 'node:child_process';
import { UsageError } from '../figma/errors.mjs';

export const coded = (code, message) => Object.assign(new Error(message), { code });

export const childEnv = (env) => ({ ...process.env, ...env });

export function runChild(command, args, { env }) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', fail);
    child.on('close', (status, signal) => done({ status, signal, stdout, stderr }));
  });
}

export const outputOf = (r) => (r.stderr || r.stdout || '').trim();

// Reading the result of an instrument whose exit is its verdict (0, or 2 for findings).
export const exitOf = (r) => r.status ?? r.signal;
export const firstLine = (text) => (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 300);
export const parseJson = (text) => { try { return JSON.parse(text); } catch { return null; } };

// An instrument as a child process: its result, a bot challenge (exit 3) thrown with code 3 and one that did not start
// with code 124. Whether any other exit is a verdict is the caller's to say. `env` is the child's environment as it is
// (childEnv(env)).
export async function callTool(name, script, args, env) {
  let r;
  try { r = await runChild(process.execPath, [script, ...args], { env }); } catch (e) { throw coded(124, `${name} did not start: ${e.message}`); }
  if (r.status === 3) throw coded(3, outputOf(r) || `${name} exited 3: bot challenge`);
  return r;
}

export function setupError(r, { name }) {
  if (r.status === 2) return new UsageError(outputOf(r) || `${name} exited 2`);
  if (r.status === 3) return coded(3, outputOf(r) || `${name} exited 3: bot challenge`);
  return null;
}
