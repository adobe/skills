/**
 * deploy/publish-guard.mjs — the publish guard of replica's extend pass, one copy for the two scripts that write
 * documents: deploy-batch.mjs (what it sends) and localize-links.mjs (what it rewrites). Library, no CLI.
 *
 *   publishGuard(content)  → null, or { file, allow } where `allow` is the Set of DA paths (`/visit/index`) listed in
 *                            <content>/.deploy-allow (`extend-roster.mjs publish` writes it). A caller touches only
 *                            the documents `allow` lists.
 *
 * It fails closed: when the run ledger beside the content tree (<content>/../stardust/status.jsonl) shows an extend
 * pass that is open (a replica `extend start` with a track and no `extend end`) and the guard file is missing, it
 * throws. No guard file and no open pass: null, and the caller behaves as it always did.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The track of an open extend pass in a run ledger (JSON lines), or null. A line that is not JSON is skipped. Pure. */
export function openExtendPass(ledgerText) {
  const open = new Set();
  for (const raw of String(ledgerText).split('\n')) {
    let l;
    try { l = JSON.parse(raw); } catch { continue; }
    if (!l || l.skill !== 'stardust:replica' || l.phase !== 'extend' || !l.track) continue;
    if (l.event === 'start') open.add(l.track);
    if (l.event === 'end') open.delete(l.track);
  }
  return [...open][0] || null;
}

export function publishGuard(content) {
  const file = join(content, '.deploy-allow');
  if (existsSync(file)) return { file, allow: new Set(readFileSync(file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) };
  const ledger = join(dirname(resolve(content)), 'stardust', 'status.jsonl');
  const track = existsSync(ledger) ? openExtendPass(readFileSync(ledger, 'utf8')) : null;
  if (track) throw new Error(`extend pass ${track} is open (${ledger}) and ${file} is missing — nothing was sent or written; run extend-roster.mjs publish --pass stardust/replica/extend/${track} first`);
  return null;
}
