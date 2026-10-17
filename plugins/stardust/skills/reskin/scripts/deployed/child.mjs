// skills/reskin/scripts/deployed/child.mjs — what the deployed steps that run another script as a child process share
// (`tokens` runs donor-probe, `content` runs dom-equality and slot-coverage). A library, no CLI.
//   TOKEN_ENV, tokenFlags(auth)   the variable the site token travels in, and the flag that names it for the child
//   childEnv(env, auth)           the child's environment: an inherited TOKEN_ENV dropped, the token set only when given
//   runChild(command, args, { env })   the child collected, as spawnSync's result ({ status, signal, stdout, stderr });
//                                 async, so a server in this process can answer it while the child runs
//   outputOf(result, auth)        the child's own words (stderr, else stdout), the token redacted
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

export const authHint = (preview, auth) => (preview.auth && !auth ? '\npreview.json says the preview was reached with a site token: pass --auth-header or --token-env' : '');

export function setupError(r, { name, auth, hint = '' }) {
  if (r.status === 2) return new UsageError(`${outputOf(r, auth) || `${name} exited 2`}${hint}`);
  if (r.status === 3) return coded(3, outputOf(r, auth) || `${name} exited 3: bot challenge`);
  return null;
}
