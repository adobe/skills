import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function containsDynamics(dir) {
  return existsSync(join(dir, 'lib.mjs')) && existsSync(join(dir, 'vendors.json'));
}

function pluginCandidates(base, tail) {
  const candidates = [];
  try {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(base, entry.name, ...tail));
    }
  } catch {
    // The base may not exist in a harness; keep the resolved pattern in the error trace.
  }
  return candidates;
}

export function locateDynamics({ env = process.env, home = os.homedir(), here = HERE } = {}) {
  const tried = [];
  const check = (candidate) => {
    const dir = resolve(candidate);
    tried.push(dir);
    return containsDynamics(dir) ? dir : null;
  };

  if (env.STARDUST_DYNAMICS_DIR) {
    const found = check(env.STARDUST_DYNAMICS_DIR);
    if (found) return found;
  }

  // Plugin source layout: skills/api-integrations/scripts next to skills/dynamics/scripts.
  // Project-copy layout: stardust/scripts/api-integrations next to stardust/scripts/dynamics.
  for (const candidate of [
    join(here, '..', '..', 'dynamics'),
    join(here, '..', '..', '..', 'dynamics', 'scripts'),
  ]) {
    const found = check(candidate);
    if (found) return found;
  }

  const roots = [
    [join(home, '.copilot', 'installed-plugins'), ['stardust', 'skills', 'dynamics', 'scripts']],
    [join(home, '.claude', 'plugins', 'marketplaces'), ['plugins', 'stardust', 'skills', 'dynamics', 'scripts']],
  ];

  for (const [base, tail] of roots) {
    for (const candidate of pluginCandidates(base, tail)) {
      const found = check(candidate);
      if (found) return found;
    }
  }

  throw new Error(
    `stardust dynamics not found; tried:\n${tried.map((p) => `- ${p}`).join('\n')}\nInstall the Stardust plugin or copy dynamics to stardust/scripts/dynamics`,
  );
}
