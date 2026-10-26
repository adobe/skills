// skills/reskin/scripts/deployed/stamp.mjs — the code stamp of an EDS project: what makes the evidence of `deployed-gate
// all` stale once the code changes after review. A library, no CLI.
//   codeStamp(root)  sha256 (hex, first 16 characters) over the sorted relative paths and contents of the files under
//                    <root>/blocks, <root>/styles and <root>/scripts, and <root>/head.html; a missing directory or file
//                    is skipped, node_modules and .DS_Store are ignored. root is the project root, the parent of --dir.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = ['blocks', 'styles', 'scripts'];
const FILES = ['head.html'];
const IGNORED = new Set(['node_modules', '.DS_Store']);

// The files under `rel` of root, as posix paths relative to root.
function filesUnder(root, rel) {
  const out = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (IGNORED.has(e.name)) continue;
    const child = `${rel}/${e.name}`;
    const stat = e.isSymbolicLink() ? statSync(join(root, child), { throwIfNoEntry: false }) : e;
    if (stat?.isDirectory() && !e.isSymbolicLink()) out.push(...filesUnder(root, child));
    else if (stat?.isFile()) out.push(child);
  }
  return out;
}

export function codeStamp(root) {
  const files = [
    ...DIRS.filter((d) => existsSync(join(root, d)) && statSync(join(root, d)).isDirectory()).flatMap((d) => filesUnder(root, d)),
    ...FILES.filter((f) => existsSync(join(root, f))),
  ].sort();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update('\0').update(readFileSync(join(root, f))).update('\0');
  return hash.digest('hex').slice(0, 16);
}
