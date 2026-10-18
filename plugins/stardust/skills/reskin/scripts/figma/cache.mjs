// skills/reskin/scripts/figma/cache.mjs — the raw capture cache under
// <dir>/.work/reskin/figma/<fileKey>/<version>/: file.json, nodes.json, variables.json (when the plan
// allows), images.json (frame id → cached PNG path or null; never a signed URL), images/<id>.png,
// selection.json (the frames captured) and manifest.json. latest.json beside the version dirs points
// at the last complete capture: { version }. current.json at .work/reskin/figma/ names the capture
// whose outputs canon-source/ holds: { fileKey, version }.
// A version dir is a complete capture and is never written to in place: a capture is built in
// <fileKey>/.staging/<version>-<selection hash>/ (a stopped run resumes there) and promote() swaps it
// in whole, so a failed refresh leaves the previous capture of the same version intact.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonIf, writeJson } from './io.mjs';

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '-');
const rm = (p) => rmSync(p, { recursive: true, force: true });
const stagingName = (version, frames) => `${safe(version)}-${createHash('sha256').update(JSON.stringify(frames)).digest('hex').slice(0, 8)}`;

export const currentPath = (dir) => join(dir, '.work', 'reskin', 'figma', 'current.json');
export const readCurrent = (dir) => readJsonIf(currentPath(dir));
export const writeCurrent = (dir, fileKey, version, confidential = false) => writeJson(currentPath(dir), { fileKey, version, ...(confidential ? { confidential: true } : {}) });

const handle = (vdir) => ({
  dir: vdir,
  path: (name) => join(vdir, name),
  has: (name) => existsSync(join(vdir, name)),
  read: (name) => readJsonIf(join(vdir, name)),
  write: (name, obj) => writeJson(join(vdir, name), obj),
  imageFile: (id) => `images/${safe(id)}.png`,
});

// Why a complete capture cannot be trusted, or null: the manifest, the saved selection and the node set
// must name the same frames (a cache overwritten part-way by an older release does not).
export function cacheProblem(v, manifest) {
  const ids = (list) => [...(list || [])].sort().join(',') || 'none';
  const want = ids(manifest.frames);
  const nodes = v.read('nodes.json');
  const selection = v.read('selection.json');
  const images = v.read('images.json');
  const problems = ['file.json', 'nodes.json', 'images.json'].filter((f) => !v.has(f)).map((f) => `${f} is missing`);
  if (nodes && ids(Object.keys(nodes.nodes || {})) !== want) problems.push(`nodes.json holds ${ids(Object.keys(nodes.nodes || {}))}`);
  if (selection && ids(selection.frames) !== want) problems.push(`selection.json names ${ids(selection.frames)}`);
  if (images && Object.keys(images).some((id) => !(manifest.frames || []).includes(id))) problems.push(`images.json holds ${ids(Object.keys(images))}`);
  return problems.length ? `manifest.json lists frames ${want}, but ${problems.join('; ')}` : null;
}

export function cacheFor(dir, fileKey) {
  const root = join(dir, '.work', 'reskin', 'figma', safe(fileKey));
  const latestPath = join(root, 'latest.json');
  const stagingRoot = join(root, '.staging');
  const prevRoot = join(root, '.prev');
  return {
    root,
    latest: () => readJsonIf(latestPath),
    setLatest: (version) => writeJson(latestPath, { version }),
    version: (v) => handle(join(root, safe(v))),
    staging: (v, frames) => handle(join(stagingRoot, stagingName(v, frames))),
    // Versions with a capture in progress or stopped part-way, from the staging dir names.
    stalled: () => (existsSync(stagingRoot) ? [...new Set(readdirSync(stagingRoot).map((d) => d.slice(0, -9)))].sort() : []),
    // Swap a finished staging capture in as the complete one for its version and point latest at it.
    promote(v, staged) {
      const dest = join(root, safe(v));
      const prev = join(prevRoot, safe(v));
      rm(prev);
      if (existsSync(dest)) { mkdirSync(prevRoot, { recursive: true }); renameSync(dest, prev); }
      renameSync(staged.dir, dest);
      writeJson(latestPath, { version: v });
      rm(prev);
      if (existsSync(stagingRoot)) for (const d of readdirSync(stagingRoot)) if (d.slice(0, -9) === safe(v)) rm(join(stagingRoot, d));
      for (const d of [prevRoot, stagingRoot]) { try { rmdirSync(d); } catch { /* absent or still holding another capture */ } }
    },
    // A run killed between the two renames of promote() left the previous capture in .prev: put it back.
    recover() {
      if (!existsSync(prevRoot)) return;
      for (const d of readdirSync(prevRoot)) {
        const dest = join(root, d);
        const prev = join(prevRoot, d);
        if (existsSync(join(prev, 'manifest.json')) && !existsSync(join(dest, 'manifest.json'))) { rm(dest); renameSync(prev, dest); } else rm(prev);
      }
      try { rmdirSync(prevRoot); } catch { /* not empty */ }
    },
  };
}
