/**
 * qa/checks/chrome.mjs — the header's behaviour after launch (browser). Re-explores the live header at the
 * contract's widths (diff's chrome-explore.mjs) and compares it with `stardust/chrome/header-contract.json`
 * (chrome-compare.mjs; profile from state.json `flow`: replica → replica, otherwise functional). Each
 * comparer finding is one qa finding under its own id (state-missing, panel-content, keyboard, close-path,
 * scroll-lock, motion, panel-visual, scroll-state, control-missing, …); a site-owner decision in
 * `stardust/chrome/header-decisions.json` turns its error into info. Findings:
 *   - header-contract-missing  info   no contract — nothing to compare (extract --prep records it)
 *   - header-explore-failed    error  the explorer did not finish on the live home page
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { finding } from '../lib.mjs';

const CONTRACT = 'stardust/chrome/header-contract.json';

export async function run(ctx) {
  const { base, opts } = ctx;
  const file = opts.headerContract || CONTRACT;
  if (!existsSync(file)) return [finding('chrome', 'header-contract-missing', 'info', '/', `no header contract at ${file} — the header's behaviour is not checked (extract --prep records it)`)];
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = [join(here, '..', '..', '..', 'diff', 'scripts'), join(here, '..', '..', 'diff')].find((d) => existsSync(join(d, 'chrome-compare.mjs')));
  if (!dir) throw new Error('chrome-compare.mjs not found (../../../diff/scripts/ or ../../diff/): copy the diff skill\'s scripts next to these');
  const contract = JSON.parse(readFileSync(file, 'utf8'));
  const out = join(opts.outDir || 'stardust/qa', 'chrome', 'header-live.json');
  const r = spawnSync(process.execPath, [join(dir, 'chrome-explore.mjs'), `${base.replace(/\/$/, '')}/`, out, '--width', Object.keys(contract.widths || {}).join(',') || '1440,390', '--shots', join(dirname(out), 'shots')], { encoding: 'utf8', timeout: 30 * 60 * 1000 });
  if (r.status !== 0) return [finding('chrome', 'header-explore-failed', 'error', '/', `chrome-explore exited ${r.status}: ${(r.stderr || '').trim().split('\n').pop()}`)];
  const { applyDecisions, compareDocs, findingKey, visualFindings } = await import(pathToFileURL(join(dir, 'chrome-compare.mjs')).href);
  const flow = (() => { try { return JSON.parse(readFileSync('stardust/state.json', 'utf8')).flow; } catch { return null; } })();
  const live = JSON.parse(readFileSync(out, 'utf8'));
  const { findings, visual } = compareDocs(contract, live, { profile: flow === 'replica' ? 'replica' : 'functional' });
  findings.push(...await visualFindings(visual, { srcDir: contract.shots || '.', buildDir: live.shots, bar: 0.02 }));
  const df = 'stardust/chrome/header-decisions.json';
  const all = applyDecisions(findings, existsSync(df) ? (JSON.parse(readFileSync(df, 'utf8')).decisions || []) : []);
  return all.map((f) => finding('chrome', f.id, f.decided ? 'info' : f.severity, '/', `${findingKey(f)} — ${f.detail}${f.decided ? ` (decided by ${f.decided.by}: ${f.decided.decision})` : ''}`));
}
