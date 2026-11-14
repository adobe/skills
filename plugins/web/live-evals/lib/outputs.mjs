import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ok = (reason) => ({ pass: true, score: 1, reason });
export const fail = (reason) => ({ pass: false, score: 0, reason });

/** A skill that produces broken output is a benchmark failure, never a harness error. */
export const graded = (check) => async (output, context) => {
  try {
    return await check(output, context);
  } catch (error) {
    return fail(`check crashed on the agent's output: ${String(error.message).split('\n')[0]}`);
  }
};

/** Directory the agent was told to write to (`./out`) in the run that produced `providerResponse`. */
export const outDir = (providerResponse) => join(providerResponse.metadata.workingDir, 'out');

export const readText = (providerResponse, name) => {
  const path = join(outDir(providerResponse), name);
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
};

/** Missing or malformed JSON reads as null so assertions report a failure instead of crashing. */
export function readJson(providerResponse, name) {
  const text = readText(providerResponse, name);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Runs `playwright-cli` inside the browser session the agent used in this run. */
export function sessionEval(providerResponse, expression) {
  const session = `run-${providerResponse.metadata.runId}`;
  const raw = execFileSync('playwright-cli', [`-s=${session}`, 'eval', expression], {
    encoding: 'utf-8',
    timeout: 30_000,
  });
  const start = raw.indexOf('### Result');
  const end = raw.indexOf('### Ran Playwright code');
  const value = raw.slice(start + '### Result'.length, end === -1 ? undefined : end).trim();
  return JSON.parse(value);
}

/** Path of the first file called `name` anywhere under the run's out dir (agents pick their own subfolders). */
export function findFile(providerResponse, name) {
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(path);
        if (found) return found;
      } else if (entry.name === name) return path;
    }
    return null;
  };
  const root = outDir(providerResponse);
  return existsSync(root) ? walk(root) : null;
}

export function findJson(providerResponse, name) {
  const path = findFile(providerResponse, name);
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** Everything the agent's tools printed in this run: evidence of what actually happened in the browser or shell. */
export const toolOutput = (providerResponse) => (providerResponse.metadata.toolResults ?? []).map((r) => r.text).join('\n');
