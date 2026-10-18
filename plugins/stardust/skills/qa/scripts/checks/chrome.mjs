/**
 * qa/checks/chrome.mjs — the header's behaviour after launch (browser). Re-explores the live header at the
 * contract's widths (diff's chrome-explore.mjs, with `--hide` set to the contract's `hide` list when it records one)
 * and compares it with `stardust/chrome/header-contract.json` (chrome-compare.mjs; profile from state.json
 * `flow`: replica → replica, otherwise functional). Each comparer finding is one qa finding under its own id
 * (state-missing, panel-content, keyboard, close-path, scroll-lock, motion, panel-visual, scroll-state,
 * control-missing, …). A decision in `stardust/chrome/header-decisions.json` turns its error into info under diff's
 * one rule (chrome-compare.mjs --help): a site owner's in any run; an agent's (reason ≥ 40 characters) only when
 * state.json says `handsOff: true`, named in the message as the agent's, for the owner's review. Invalid entries are
 * `decision-invalid` warnings.
 * Findings:
 *   - header-contract-missing  info   no contract — nothing to compare (extract --prep records it)
 *   - header-explore-failed    error  the explorer did not finish on the live home page
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finding } from '../lib.mjs';

const CONTRACT = 'stardust/chrome/header-contract.json';
const DECISIONS = 'stardust/chrome/header-decisions.json';
const STATE = 'stardust/state.json';

export async function run(ctx) {
  const { base, opts } = ctx;
  const file = opts.headerContract || CONTRACT;
  if (!existsSync(file)) return [finding('chrome', 'header-contract-missing', 'info', '/', `no header contract at ${file} — the header's behaviour is not checked (extract --prep records it)`)];
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = [join(here, '..', '..', '..', 'diff', 'scripts'), join(here, '..', '..', 'diff')].find((d) => existsSync(join(d, 'chrome-compare.mjs')));
  if (!dir) throw new Error('chrome-compare.mjs not found (../../../diff/scripts/ or ../../diff/): copy the diff skill\'s scripts next to these');
  const contract = JSON.parse(readFileSync(file, 'utf8'));
  const out = join(opts.outDir || 'stardust/qa', 'chrome', 'header-live.json');
  const hide = (contract.hide && contract.hide.list) || [];
  const r = spawnSync(process.execPath, [join(dir, 'chrome-explore.mjs'), `${base.replace(/\/$/, '')}/`, out, '--width', Object.keys(contract.widths || {}).join(',') || '1440,390', '--shots', join(dirname(out), 'shots'), ...(hide.length ? ['--hide', hide.join(',')] : [])], { encoding: 'utf8', timeout: 30 * 60 * 1000 });
  if (r.status !== 0) return [finding('chrome', 'header-explore-failed', 'error', '/', `chrome-explore exited ${r.status}: ${(r.stderr || '').trim().split('\n').pop()}`)];
  const { applyDecisions, compareDocs, findingKey, handsOffOf, readDecisions, visualFindings } = await import(pathToFileURL(join(dir, 'chrome-compare.mjs')).href);
  const stateFile = opts.state || STATE;
  const flow = (() => { try { return JSON.parse(readFileSync(stateFile, 'utf8')).flow; } catch { return null; } })();
  const live = JSON.parse(readFileSync(out, 'utf8'));
  const { findings, visual } = compareDocs(contract, live, { profile: flow === 'replica' ? 'replica' : 'functional' });
  findings.push(...await visualFindings(visual, { srcDir: contract.shots || '.', buildDir: live.shots, bar: 0.02 }));
  const all = applyDecisions(findings, readDecisions(opts.headerDecisions || DECISIONS), { handsOff: handsOffOf(stateFile) });
  const by = (d) => (d.agent ? `decided by the agent: ${d.decision} — ${d.reason}; for the owner's review` : `decided by ${d.by}: ${d.decision}`);
  return all.map((f) => finding('chrome', f.id, f.decided ? 'info' : f.severity, '/', `${findingKey(f)} — ${f.detail}${f.decided ? ` (${by(f.decided)})` : ''}`));
}
