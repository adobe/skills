// skills/reskin/scripts/deployed/child.mjs — what the deployed steps that run another script as a child process share
// (`tokens` runs donor-probe, `content` runs dom-equality and slot-coverage, `parity` and `sanity` run the instruments
// of replica and diff). A library, no CLI.
//   TOKEN_ENV, tokenFlags(auth)   the variable the site token travels in, and the flag that names it for the child
//   childEnv(env, auth)           the child's environment: an inherited TOKEN_ENV dropped, the token set only when given
//   runChild(command, args, { env })   the child collected, as spawnSync's result ({ status, signal, stdout, stderr });
//                                 async, so a server in this process can answer it while the child runs
//   outputOf(result, auth)        the child's own words (stderr, else stdout), the token redacted
//   callTool(name, script, args, env, auth)  an instrument run with node: its result; exit 3 thrown with code 3, a spawn
//                                 failure with code 124 (the token, when given, redacted from both messages)
//   previewToken(step, preview, auth)  the token a step sends: `auth` for a protected preview (a UsageError without one),
//                                 null for a public preview, whatever it was given
//   callOnPreview(name, script, args, env, { token, url })  callTool for an instrument that loads the preview at `url`: the
//                                 token by environment and --token-env, aimed by --auth-origin at the origin of `url` and no
//                                 other, its output redacted; with no token it is callTool with the token variable dropped
//   exitOf, firstLine, parseJson  the exit (or signal) of a result, the first non-blank line of a text, JSON or null
//   setupError(result, { name, auth, hint })  the error for a child that exited 2 (a UsageError) or 3 (code 3: a bot
//                                 challenge or token halt); null for any other exit
//   authHint(preview, auth)       the line a setup error gets when the preview was reached with a token this run lacks
//   coded(code, message)          an Error whose .code is the gate's exit code (3 or 124)
// The site token reaches a child by environment, never argv.
import { spawn } from 'node:child_process';
import { UsageError } from '../figma/errors.mjs';
import { redact } from './eds.mjs';

export const TOKEN_ENV = 'DEPLOYED_GATE_SITE_TOKEN';

export const coded = (code, message) => Object.assign(new Error(message), { code });

export const tokenFlags = (auth) => (auth ? ['--token-env', TOKEN_ENV] : []);

export function childEnv(env, auth) {
  const out = { ...process.env, ...env };
  delete out[TOKEN_ENV];
  if (auth) out[TOKEN_ENV] = auth;
  return out;
}

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

export const outputOf = (r, auth) => redact((r.stderr || r.stdout || '').trim(), auth);

// Reading the result of an instrument whose exit is its verdict (0, or 2 for findings).
export const exitOf = (r) => r.status ?? r.signal;
export const firstLine = (text) => (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 300);
export const parseJson = (text) => { try { return JSON.parse(text); } catch { return null; } };

// An instrument as a child process: its result, a bot challenge (exit 3) thrown with code 3 and one that did not start
// with code 124. Whether any other exit is a verdict is the caller's to say. `env` is the child's environment as it is
// (childEnv(env, null) for none); `auth` only says what to redact.
export async function callTool(name, script, args, env, auth = null) {
  let r;
  try { r = await runChild(process.execPath, [script, ...args], { env }); } catch (e) { throw coded(124, redact(`${name} did not start: ${e.message}`, auth)); }
  if (r.status === 3) throw coded(3, outputOf(r, auth) || `${name} exited 3: bot challenge`);
  return r;
}

export function previewToken(step, preview, auth) {
  if (!preview.auth) return null;
  if (!auth) throw new UsageError(`${step} needs the site token to read a protected preview${authHint(preview, auth)}`);
  return auth;
}

export async function callOnPreview(name, script, args, env, { token, url }) {
  if (!token) return callTool(name, script, args, childEnv(env, null));
  const r = await callTool(name, script, [...args, ...tokenFlags(token), '--auth-origin', new URL(url).origin], childEnv(env, token), token);
  return { ...r, stdout: redact(r.stdout, token), stderr: redact(r.stderr, token) };
}

export const authHint = (preview, auth) => (preview.auth && !auth ? '\npreview.json says the preview was reached with a site token: pass --auth-header or --token-env' : '');

export function setupError(r, { name, auth, hint = '' }) {
  if (r.status === 2) return new UsageError(`${outputOf(r, auth) || `${name} exited 2`}${hint}`);
  if (r.status === 3) return coded(3, outputOf(r, auth) || `${name} exited 3: bot challenge`);
  return null;
}
