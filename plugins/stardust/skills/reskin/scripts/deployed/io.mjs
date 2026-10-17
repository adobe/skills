// skills/reskin/scripts/deployed/io.mjs — where the deployed leg keeps its evidence, and how a later step reads
// the record of the preview check (A0).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../figma/errors.mjs';
import { readJson } from '../figma/io.mjs';

export const deployedDir = (dir, slug) => join(dir, '.work', 'reskin', 'gates', slug, 'deployed');

// preview.json as `deployed-gate preview` wrote it; absent or unreadable is a setup error naming that step.
export function readPreview(dir, slug) {
  const path = join(deployedDir(dir, slug), 'preview.json');
  if (!existsSync(path)) throw new UsageError(`missing ${path}: run deployed-gate preview --page ${slug} first`);
  try {
    return readJson(path);
  } catch (e) {
    throw new UsageError(`${path} is not valid JSON (${e.message}): re-run deployed-gate preview --page ${slug}`);
  }
}

// An input file a step needs, as JSON; missing or unreadable is a setup error naming the file and what writes it.
export function readInput(path, what) {
  if (!existsSync(path)) throw new UsageError(`missing ${path}: ${what}`);
  try { return readJson(path); } catch (e) { throw new UsageError(`${path} is not valid JSON (${e.message})`); }
}
