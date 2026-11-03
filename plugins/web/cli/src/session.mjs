import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CliError } from '#src/errors.mjs';
import { resolveLaunch } from '#src/recipe.mjs';

/** @returns {string} `web-` plus 4 hex characters */
export function generateSessionName() {
  return `web-${randomBytes(2).toString('hex')}`;
}

/**
 * @param {object} driver
 * @param {string | undefined} name
 */
export function requireOpenSession(driver, name) {
  const open = name && driver.list().some((s) => s.name === name && s.status === 'open');
  if (!open) {
    throw new CliError('NO_SESSION', `no open session${name ? ` named ${name}` : ''}`, {
      hint: 'run: web browser open <url> --session <name>',
    });
  }
}

/**
 * Run `fn` against a given session (opened on demand when a url is given), or against an ephemeral one closed afterwards.
 * Explicit `config`, `persistent`, `initScripts` win over values loaded from `recipePath`.
 * `recipeSkip` lists recipe types not to apply. A recipe cannot change a browser that is already open: with `recipeExplicit` that warns.
 * @param {object} driver
 * @param {object} opts session, url, headed, recipePath, config, persistent, initScripts
 * @param {(session: string) => unknown} fn
 */
export async function withSession(driver, opts, fn) {
  const { session, url, headed, recipePath, recipeExplicit, recipeSkip, ...launch } = opts;
  const resolve = () => resolveLaunch(recipePath, launch, { skip: recipeSkip });
  if (session) {
    const isOpen = driver.list().some((s) => s.name === session && s.status === 'open');
    if (!isOpen && url) {
      driver.open({ session, url, headed, ...resolve() });
    } else {
      requireOpenSession(driver, session);
      if (recipePath && recipeExplicit) {
        process.stderr.write(
          `warning: --recipe ignored, session ${session} is already open (a recipe applies when a browser launches)\n`,
        );
      }
      if (url) driver.goto(session, url);
    }
    return fn(session);
  }
  const name = generateSessionName();
  const cleanup = installSignalCleanup(driver, name);
  let failed = false;
  let owned = true;
  try {
    try {
      driver.open({ session: name, url, headed, ...resolve() });
    } catch (err) {
      owned = err?.code !== 'SESSION_EXISTS';
      throw err;
    }
    return await fn(name);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    cleanup();
    if (owned) closeQuietlyIf(driver, name, failed);
  }
}

function installSignalCleanup(driver, name) {
  const handlers = ['SIGINT', 'SIGTERM'].map((signal) => {
    const handler = () => {
      cleanup();
      try {
        driver.close(name);
      } catch {
        // best effort: the process is being killed anyway
      }
      process.kill(process.pid, signal);
    };
    return [signal, handler];
  });
  const cleanup = () => handlers.forEach(([s, h]) => process.removeListener(s, h));
  handlers.forEach(([s, h]) => process.once(s, h));
  return cleanup;
}

function closeQuietlyIf(driver, name, failed) {
  try {
    driver.close(name);
  } catch (err) {
    if (!failed) throw err;
    process.stderr.write(`warning: failed to close session ${name}: ${err.message}\n`);
  }
}

// Artifact paths are absolute: agents often change directory between commands and a relative
// `.web/...` in the printed document sent weaker models hunting the filesystem for the file.
/** @returns {string} absolute `<outputDir>/<session>-<command>-<name>` */
export function artifactPath(outputDir, session, command, name) {
  return resolve(outputDir, `${session}-${command}-${name}`);
}

/** @returns {string} absolute `<outputDir>/<session>-<command>`, created if missing */
export function artifactDir(outputDir, session, command) {
  const dir = resolve(outputDir, `${session}-${command}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
