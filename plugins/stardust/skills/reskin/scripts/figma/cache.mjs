// skills/reskin/scripts/figma/cache.mjs — the raw capture cache under
// <dir>/.work/reskin/figma/<fileKey>/<version>/: file.json, nodes.json, variables.json (when the plan
// allows), images.json (frame id → cached PNG path or null; never a signed URL), images/<id>.png,
// selection.json (the frames a partial run was fetching) and manifest.json (written last). latest.json
// beside the version dirs points at the last complete capture: { version }. current.json at
// .work/reskin/figma/ names the capture whose outputs canon-source/ holds: { fileKey, version }.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonIf, writeJson } from './io.mjs';

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '-');

export const currentPath = (dir) => join(dir, '.work', 'reskin', 'figma', 'current.json');
export const readCurrent = (dir) => readJsonIf(currentPath(dir));
export const writeCurrent = (dir, fileKey, version, confidential = false) => writeJson(currentPath(dir), { fileKey, version, ...(confidential ? { confidential: true } : {}) });

export function cacheFor(dir, fileKey) {
  const root = join(dir, '.work', 'reskin', 'figma', safe(fileKey));
  const latestPath = join(root, 'latest.json');
  return {
    root,
    latest: () => readJsonIf(latestPath),
    setLatest: (version) => writeJson(latestPath, { version }),
    version(v) {
      const vdir = join(root, safe(v));
      return {
        dir: vdir,
        path: (name) => join(vdir, name),
        has: (name) => existsSync(join(vdir, name)),
        read: (name) => readJsonIf(join(vdir, name)),
        write: (name, obj) => writeJson(join(vdir, name), obj),
        imageFile: (id) => `images/${safe(id)}.png`,
      };
    },
  };
}
