// skills/reskin/scripts/figma/io.mjs — file helpers for figma-donor.mjs: atomic writes (temp file +
// rename, so a crash never leaves half a JSON), JSON read/write in the repo's format
// (2-space indent, trailing newline) and the _provenance block every generated artifact carries first.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Plugin tree: skills/reskin/scripts/figma → plugin root. In a project copy the manifest is absent.
const PLUGIN_MANIFEST = join(HERE, '..', '..', '..', '..', '.claude-plugin', 'plugin.json');
export const WRITTEN_BY = 'stardust:reskin/figma-donor.mjs';

export function pluginVersion() {
  try { return JSON.parse(readFileSync(PLUGIN_MANIFEST, 'utf8')).version || null; } catch { return null; }
}

export function writeFileAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export const writeJson = (path, obj) => writeFileAtomic(path, `${JSON.stringify(obj, null, 2)}\n`);
export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
export const readJsonIf = (path) => (existsSync(path) ? readJson(path) : null);

export function provenance({ at, readArtifacts = [], note, writtenBy = WRITTEN_BY } = {}) {
  const version = pluginVersion();
  return {
    writtenBy,
    writtenAt: at,
    readArtifacts,
    synthesizedInputs: [],
    ...(version ? { stardustVersion: version } : {}),
    ...(note ? { note } : {}),
  };
}

// The Markdown form (artifact-map.md § Provenance): an HTML comment on the first line.
export function mdProvenance(prov) {
  const lines = ['<!-- stardust:provenance'];
  for (const [k, v] of Object.entries(prov)) {
    if (Array.isArray(v)) {
      lines.push(v.length ? `  ${k}:` : `  ${k}: []`);
      for (const item of v) lines.push(`    - ${item}`);
    } else lines.push(`  ${k}: ${v}`);
  }
  lines.push('-->');
  return lines.join('\n');
}
