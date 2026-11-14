import { createHash } from 'node:crypto';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BASELINE } from './contexts.mjs';
import { attemptDir } from './rerun.mjs';
import { walk } from './workdir.mjs';

export async function scenarioFingerprint(dir) {
  const files = (await walk(dir, { skip: ['node_modules', '.git', '.DS_Store'] })).sort();
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f);
    h.update('\0');
    h.update(createHash('sha256').update(await readFile(join(dir, f))).digest());
  }
  return h.digest('hex');
}

export function baselineCompatible(prior, a, { thinking, scorerModel, skipScoring }) {
  if (!prior || prior.status !== 'ok' || prior.variant !== BASELINE || a.variant !== BASELINE) return false;
  if (!prior.scenarioHash || prior.scenarioHash !== a.scenarioHash) return false;
  if (prior.scenario !== a.scenario.name || prior.model !== a.model || prior.run !== a.run) return false;
  if ((prior.thinking ?? null) !== (thinking ?? null)) return false;
  if (!skipScoring && prior.score?.judgeModel !== scorerModel) return false;
  if (!skipScoring && !prior.score) return false;
  return true;
}

export async function reuseBaseline(a, { runDirs, thinking, scorerModel, skipScoring }) {
  for (const runDir of runDirs) {
    const dir = attemptDir(runDir, { ...a, scenario: a.scenario.name });
    let prior;
    try {
      prior = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!baselineCompatible(prior, a, { thinking, scorerModel, skipScoring })) continue;
    await cp(dir, a.dir, { recursive: true });
    const reused = { ...prior, dir: a.dir, reusedFrom: runDir };
    await writeFile(join(a.dir, 'result.json'), JSON.stringify(reused, null, 2));
    return reused;
  }
  return null;
}
