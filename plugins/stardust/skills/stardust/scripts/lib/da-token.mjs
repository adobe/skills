/**
 * skills/stardust/scripts/lib/da-token.mjs — owns where a script that calls admin.da.live / admin.hlx.page finds its IMS
 * bearer token, and the token's JWT expiry. One copy of that rule for deploy/da-media-upload, deploy/deploy-batch,
 * rollout/da-library and dynamics/sync-sheets (each used to spell it out, and only some knew the harness's token file).
 *
 * Sources, never more than one:
 *   --token-file <path>        the file, read once at start and trimmed
 *   --token-env <NAME>         that variable; an explicit name never falls back
 *   neither flag               DA_TOKEN; when DA_TOKEN is unset and ADOBE_IMS_TOKEN_FILE names a file (a hands-off
 *                              harness rewrites it on refresh), that file
 * This is the one statement of that order; the deploy, rollout and replica docs point here. A hand-written admin request
 * follows it in shell, expanded per request (the harness rewrites the file in place):
 *   ${DA_TOKEN:-$(tr -d '[:space:]' < "$ADOBE_IMS_TOKEN_FILE")}
 * Every message names the source (`via` and the file or variable), never the value. Nothing runs on import; the file
 * is read only by readDaToken.
 */
import { readFileSync } from 'node:fs';

/**
 * The token's source from the flags and the environment: `{ tokenFile, via }` or `{ tokenEnv, via }`, where `via` is
 * what a message calls it (`--token-file`, `ADOBE_IMS_TOKEN_FILE`, or the variable). Throws on both flags.
 */
export function daTokenSource({ tokenEnv, tokenFile } = {}, env = process.env) {
  if (tokenEnv && tokenFile) throw new Error('give at most one of --token-env / --token-file');
  if (tokenFile) return { tokenFile, via: '--token-file' };
  if (tokenEnv) return { tokenEnv, via: tokenEnv };
  if (!env.DA_TOKEN && env.ADOBE_IMS_TOKEN_FILE) return { tokenFile: env.ADOBE_IMS_TOKEN_FILE, via: 'ADOBE_IMS_TOKEN_FILE' };
  return { tokenEnv: 'DA_TOKEN', via: 'DA_TOKEN' };
}

/**
 * The token from a daTokenSource result, trimmed. A file source throws on an unreadable or empty file, naming the
 * source; a variable source returns '' when unset (each script words its own "not set" usage error).
 */
export function readDaToken(src, env = process.env) {
  if (!src.tokenFile) return String(env[src.tokenEnv] || '').trim();
  let raw;
  try { raw = readFileSync(src.tokenFile, 'utf8'); } catch (e) { throw new Error(`cannot read ${src.via} ${src.tokenFile}: ${e.message}`); }
  const token = raw.trim();
  if (!token) throw new Error(`${src.via} ${src.tokenFile} is empty`);
  return token;
}

/**
 * The `exp` claim (seconds since the epoch) of a JWT-shaped token, or null when the token is not a JWT or carries no
 * numeric exp. Decodes the middle segment only; nothing about the token is ever printed.
 */
export function jwtExpiry(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((x) => /^[A-Za-z0-9_-]+$/.test(x))) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && Number.isFinite(claims.exp) ? claims.exp : null;
  } catch { return null; }
}
