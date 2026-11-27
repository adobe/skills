/**
 * deploy/publish-guard.mjs — the publish guard of replica's extend pass, one copy for the two scripts that write
 * documents: deploy-batch.mjs (what it sends) and localize-links.mjs (what it rewrites). Library, no CLI.
 *
 *   publishGuard(content)  → null, or { file, allow } where `allow` is the Set of DA paths (`/visit/index`) listed in
 *                            <content>/.deploy-allow (`extend-roster.mjs publish` writes it). A caller touches only
 *                            the documents `allow` lists.
 *   openPassOf(content)    → the track of the open extend pass (`x1`), or null: a replica `extend start` with a track
 *                            and no `extend end` in the run ledger beside the content tree
 *                            (<content>/../stardust/status.jsonl).
 *
 * It fails closed. It throws when the ledger shows more than one pass open. It throws when a pass is open and the
 * guard file is missing. It also throws when the pass the guard
 * names (its `# pass x1` line, which `publish` writes) is not the open one: a guard left by an earlier pass, or one
 * that names no pass while a pass is open, authorizes nothing. No guard file and no open pass: null, and the caller
 * behaves as it always did.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * The track of the open extend pass in a run ledger (JSON lines), or null. A line that is not JSON is skipped; a
 * track is read in lower case, as ledger.mjs writes it. Throws when more than one pass is open: the ledger then does
 * not say which pass may publish. Pure.
 */
export function openExtendPass(ledgerText) {
  const open = new Set();
  for (const raw of String(ledgerText).split('\n')) {
    let l;
    try { l = JSON.parse(raw); } catch { continue; }
    if (!l || l.skill !== 'stardust:replica' || l.phase !== 'extend' || !l.track) continue;
    const track = String(l.track).trim().toLowerCase();
    if (l.event === 'start') open.add(track);
    if (l.event === 'end') open.delete(track);
  }
  if (open.size > 1) throw new Error(`more than one extend pass is open (${[...open].sort().join(', ')}) — nothing was sent or written; close the earlier pass with its \`extend end\` line first`);
  return [...open][0] || null;
}

const ledgerOf = (content) => join(dirname(resolve(content)), 'stardust', 'status.jsonl');

export function openPassOf(content) {
  const ledger = ledgerOf(content);
  return existsSync(ledger) ? openExtendPass(readFileSync(ledger, 'utf8')) : null;
}

export function publishGuard(content) {
  const file = join(content, '.deploy-allow');
  const open = openPassOf(content);
  const fix = open ? `run extend-roster.mjs publish --pass stardust/replica/extend/${open} first` : 'delete it';
  if (!existsSync(file)) {
    if (open) throw new Error(`extend pass ${open} is open (${ledgerOf(content)}) and ${file} is missing — nothing was sent or written; ${fix}`);
    return null;
  }
  const lines = readFileSync(file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const owner = (lines.find((l) => l.startsWith('# pass ')) || '').slice('# pass '.length);
  if (owner !== (open || '')) throw new Error(`${file} ${owner ? `belongs to extend pass ${owner}` : 'names no pass'}, but ${open ? `pass ${open} is open` : 'no extend pass is open'} (${ledgerOf(content)}) — nothing was sent or written; ${fix}`);
  return { file, allow: new Set(lines.filter((l) => !l.startsWith('#'))) };
}
