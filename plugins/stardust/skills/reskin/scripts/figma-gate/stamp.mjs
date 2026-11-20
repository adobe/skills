// skills/reskin/scripts/figma-gate/stamp.mjs — what a step file records of the checks it measured, so the register can
// tell results of the checks file as it stands from results of an older one. A section's stamp covers what is measured
// (its roots and its geometry and type entries), not what only lowers the floor (waivers, skip) or is advisory (pixel).
// Pure.
import { createHash } from 'node:crypto';

// JSON with the keys of every object sorted: the order an author wrote an entry's keys in does not change its stamp.
const canon = (v) => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
};

export const sectionStamp = (s) => createHash('sha256').update(canon({ root: s.root, width: s.width, roots: s.roots, geometry: s.geometry, type: s.type })).digest('hex').slice(0, 16);

// validateChecks(...).sections → { <slot>: stamp }, what geometry.json and ramp.json record as checksStamp.
export const stampsOf = (checks) => Object.fromEntries(Object.entries(checks ?? {}).map(([slot, s]) => [slot, sectionStamp(s)]));
