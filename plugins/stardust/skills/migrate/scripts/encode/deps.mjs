/**
 * migrate/encode/deps.mjs — the encoder's door to the deploy skill's scripts (eds-path.mjs, localize-links.mjs,
 * sanitise.js, content-inventory.mjs …), resolved in both layouts. A library module (no CLI); nothing runs on import.
 *
 *   plugin tree   skills/migrate/scripts/encode/   → skills/deploy/scripts/<file>   (../../../deploy/scripts/)
 *   project copy  stardust/scripts/migrate/encode/ → stardust/scripts/deploy/<file> (../../deploy/)
 *
 *   deployCandidates(file) → [pluginPath, projectPath], the plugin tree first
 *   deployPath(file)       → the first candidate that exists; throws naming both when neither does
 *   loadDeploy(file)       → Promise of the module namespace (dynamic import, one per file; a failed load is retried)
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const loaded = new Map();

export const deployCandidates = (file) => [join(HERE, '..', '..', '..', 'deploy', 'scripts', file), join(HERE, '..', '..', 'deploy', file)];

export function deployPath(file) {
  const candidates = deployCandidates(file);
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error(`deploy script ${file} not found: looked in ${candidates.join(' and ')}`);
  return hit;
}

export function loadDeploy(file) {
  if (!loaded.has(file)) {
    const p = (async () => import(pathToFileURL(deployPath(file)).href))();
    p.catch(() => loaded.delete(file));
    loaded.set(file, p);
  }
  return loaded.get(file);
}
