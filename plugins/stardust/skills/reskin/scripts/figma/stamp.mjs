// skills/reskin/scripts/figma/stamp.mjs — stampDesignSource: the one state.json write of the Figma
// donor. Sets state.designSource = { url, capturedAt, path: "<dir>/canon-source/" } (the shape extract
// --design-source stamps; direct reads it to pin the donor system) and nothing else, through the
// master skill's state.mjs (readState / stampProvenance / writeState: atomic, ordered, provenance
// re-stamped as stardust:reskin). It never creates state.json: extract <content-url> does.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { UsageError } from './errors.mjs';
import { WRITTEN_BY } from './io.mjs';

export const REDACTED_URL = 'figma:redacted';

export function stampDesignSource({ dir = 'stardust', donorUrl, capturedAt, confidential = false, stateLib, cwd = process.cwd() }) {
  if (!existsSync(join(dir, 'state.json'))) {
    throw new UsageError(`${dir}/state.json does not exist: run $stardust extract <content-url> first (reskin Phase 1 extracts the content site before the Figma capture); stamp never creates state.json`);
  }
  for (const f of ['DESIGN.md', 'DESIGN.json']) {
    if (!existsSync(join(dir, 'canon-source', f))) throw new UsageError(`${dir}/canon-source/${f} is missing: run figma-donor.mjs curate before stamp`);
  }
  // DESIGN files left by another donor (or an older capture) must not be stamped as this Figma donor.
  let design = null;
  try { design = JSON.parse(readFileSync(join(dir, 'canon-source', 'DESIGN.json'), 'utf8')); } catch { /* reported below */ }
  if (design?._provenance?.writtenBy !== WRITTEN_BY || design?.generatedAt !== capturedAt) {
    throw new UsageError(`${dir}/canon-source/DESIGN.json was not written by curate for this capture (writtenBy ${design?._provenance?.writtenBy ?? 'unknown'}, generatedAt ${design?.generatedAt ?? 'unknown'}, capture ${capturedAt}): run figma-donor.mjs curate before stamp`);
  }
  const { state, file } = stateLib.readState(dir);
  const base = isAbsolute(dir) ? relative(cwd, dir) || '.' : dir;
  const designSource = { url: confidential ? REDACTED_URL : donorUrl, capturedAt, path: `${base.replace(/\/+$/, '')}/canon-source/` };
  // A new key goes right after site, where writeState's ordering then keeps it.
  const next = {};
  if (!('designSource' in state)) {
    for (const [k, v] of Object.entries(state)) {
      next[k] = v;
      if (k === 'site') next.designSource = designSource;
    }
    if (!('designSource' in next)) next.designSource = designSource;
  } else Object.assign(next, state, { designSource });
  next._provenance = stateLib.stampProvenance(state._provenance, 'stardust:reskin');
  stateLib.writeState(file, next);
  return { designSource, file };
}
