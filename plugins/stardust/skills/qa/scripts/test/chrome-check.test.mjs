#!/usr/bin/env node
// skills/qa/scripts/test/chrome-check.test.mjs — the qa `chrome` check: without a header contract it reports one info
// finding and launches nothing; with one, the comparer and its decisions are diff's (chrome-compare.test.mjs, and
// chrome-explore.test.mjs for the browser run). The explorer's argv is checked in a sandbox project copy
// (qa/checks/chrome.mjs copied, diff/chrome-compare.mjs re-exporting the real one, diff/chrome-explore.mjs a stub that
// logs its argv and writes the contract's widths back, recording its --hide list): a contract `hide` list reaches the
// explorer, so the live record carries it too.
// Run: node plugins/stardust/skills/qa/scripts/test/chrome-check.test.mjs
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../checks/chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const QA = join(here, '..');
const DIFF = [join(here, '..', '..', '..', 'diff', 'scripts'), join(here, '..', '..', 'diff')].find((d) => existsSync(join(d, 'chrome-compare.mjs')));

let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failed += 1; console.log(`✗ ${name}\n  ${e.message.split('\n').join('\n  ')}`); } };

await check('no contract: one header-contract-missing info finding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-chrome-'));
  const f = await run({ base: 'https://example.com', opts: { headerContract: join(dir, 'none.json'), outDir: dir } });
  assert.deepEqual(f.map((x) => [x.check, x.id, x.severity]), [['chrome', 'header-contract-missing', 'info']]);
  rmSync(dir, { recursive: true });
});

const EXPLORE_STUB = `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const argv = process.argv.slice(2); const out = argv[1]; const at = argv.indexOf('--hide');
const contract = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'header-contract.json'), 'utf8'));
const doc = { widths: contract.widths, shots: join(dirname(out), 'shots') };
if (at >= 0) doc.hide = { list: argv[at + 1].split(','), presence: null, perWidth: {} };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc));
writeFileSync(out + '.argv.json', JSON.stringify(argv));
`;
const reexport = (file) => `export * from ${JSON.stringify(pathToFileURL(file).href)};\n`;
const sandboxRun = async (contract) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qa-chrome-')));
  mkdirSync(join(root, 'qa', 'checks'), { recursive: true }); mkdirSync(join(root, 'diff'));
  copyFileSync(join(QA, 'checks', 'chrome.mjs'), join(root, 'qa', 'checks', 'chrome.mjs'));
  writeFileSync(join(root, 'qa', 'lib.mjs'), reexport(join(QA, 'lib.mjs')));
  writeFileSync(join(root, 'diff', 'chrome-compare.mjs'), reexport(join(DIFF, 'chrome-compare.mjs')));
  writeFileSync(join(root, 'diff', 'chrome-explore.mjs'), EXPLORE_STUB);
  writeFileSync(join(root, 'header-contract.json'), JSON.stringify(contract));
  const { run: sandboxed } = await import(pathToFileURL(join(root, 'qa', 'checks', 'chrome.mjs')).href);
  const outDir = join(root, 'out');
  const findings = await sandboxed({ base: 'https://example.com/', opts: { headerContract: join(root, 'header-contract.json'), outDir } });
  const out = join(outDir, 'chrome', 'header-live.json');
  const argv = existsSync(`${out}.argv.json`) ? JSON.parse(readFileSync(`${out}.argv.json`, 'utf8')) : null;
  rmSync(root, { recursive: true });
  return { findings, argv, out, shots: join(outDir, 'chrome', 'shots') };
};
const widths = { 390: { root: { sel: 'header' }, controls: [] }, 1440: { root: { sel: 'header' }, controls: [] } };

await check('contract hide [.geo-bar]: the explorer gets --hide .geo-bar, no hide-mismatch results', async () => {
  const { findings, argv, out, shots } = await sandboxRun({ widths, hide: { list: ['.geo-bar'], presence: null, perWidth: {} } });
  assert.deepEqual(argv, ['https://example.com/', out, '--width', '390,1440', '--shots', shots, '--hide', '.geo-bar']);
  assert.deepEqual(findings.map((f) => f.id), [], findings.map((f) => f.detail).join('\n'));
});

await check('contract without hide: the explorer argv is unchanged (no --hide)', async () => {
  const { findings, argv, out, shots } = await sandboxRun({ widths });
  assert.deepEqual(argv, ['https://example.com/', out, '--width', '390,1440', '--shots', shots]);
  assert.deepEqual(findings, []);
});
process.exit(failed ? 1 : 0);
