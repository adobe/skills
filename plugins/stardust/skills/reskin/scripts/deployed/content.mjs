// skills/reskin/scripts/deployed/content.mjs — A1 of the deployed leg, `content`: the preview's content against the
// live source and the page's content model, through dom-equality.mjs and slot-coverage.mjs (each a child process, run
// one after the other, both with --wait-eds so the EDS decoration has settled).
//   runContent({ dir, slug, preview, auth, env, run })  writes content.json and returns { verdict, domEquality: { exit,
//        report }, slotCoverage: { exit, report }, unusedDeltas, gates }. A gate that cannot give a verdict throws: a
//        UsageError (exit 2: a setup problem, a stalled decoration), an error with code 3 (bot challenge) or code 124.
//        `run(command, args, { env })` starts a gate and answers { status, signal, stdout, stderr } (a promise or not,
//        as spawnSync's result is shaped); the default is async, so a server in this process can answer a gate.
// A Figma-sourced model (_provenance.source.kind "figma", a Figma-only site: no live source) runs figma-text-gate.mjs
// in place of dom-equality (the frame's text, re-read from the cached Figma nodes, against the preview's main) and
// records figmaText: { exit, report } instead of domEquality.
// Inputs: <dir>/reskin/content-model/<slug>/content-model.json (required: its _provenance.url is the live source and
// _provenance.scope the source scope, unless the model is Figma-sourced), <dir>/reskin/normalize/<slug>.mjs (optional: the source-side ledger the capture
// used) and <dir>/reskin/deltas/<slug>.json (optional: the declared differences, handed to both gates as --deltas;
// without one no difference is allowed for and a failed check blocks).
// The verdict is read from the exits alone, except that "advisory" is the gate's own ADVISORY line on stdout
// (deployed/deltas.mjs ADVISORY, printed with exit 0 when a check failed and the delta file says "blocking": false):
//   both gates exit 0 and neither printed ADVISORY → PASS · both exit 0, either printed it → ADVISORY · either exit 1 → FAIL
// unusedDeltas is the union of the ids the gates warned of, read from their stdout "WARNING unused delta <id>: …" lines
// (one line per entry, the format both print through deltas.mjs warningLines; the reports hold the same entries but in
// Markdown for people): an allow id, or `metadata.ignore "<key>"` from slot-coverage.
// The site token reaches the gates by environment (--token-env DEPLOYED_GATE_SITE_TOKEN), never argv, and never appears
// in a message, report or record.
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { writeJson } from '../figma/io.mjs';
import { authHint, childEnv, coded, outputOf, runChild, setupError, tokenFlags } from './child.mjs';
import { ADVISORY, loadDeltas } from './deltas.mjs';
import { redact } from './eds.mjs';
import { deployedDir, readInput } from './io.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Both gates sit beside deployed-gate.mjs in both layouts (plugin tree and project copy).
const DOM_EQUALITY = resolve(HERE, '..', 'dom-equality.mjs');
const SLOT_COVERAGE = resolve(HERE, '..', 'slot-coverage.mjs');
const FIGMA_TEXT = resolve(HERE, '..', 'figma-text-gate.mjs');
const UNUSED = /^\s*WARNING unused delta (.+)$/;
const IGNORE_KEY = /^(metadata\.ignore "(?:[^"\\]|\\.)*"): /;
// What a failed gate says on stdout or stderr about the failure itself, for the CLI to quote.
const FINDING = /^\s*(FAIL |text diverges |(missing|order|case|duplicate|extra|placeholder missing|placeholder extra): )/;
const MAX_FINDINGS = 15;

// The ids in a gate's stdout WARNING lines. An allow id may hold ": ", so the declared ids are matched first.
function unusedIds(stdout, deltas) {
  const known = (deltas?.text.allow ?? []).map((a) => a.id).sort((a, b) => b.length - a.length);
  const ids = [];
  for (const line of stdout.split('\n')) {
    const rest = line.match(UNUSED)?.[1];
    if (rest === undefined) continue;
    const id = known.find((k) => rest.startsWith(`${k}: `)) ?? rest.match(IGNORE_KEY)?.[1] ?? rest.split(': ')[0];
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// preview is the record of `deployed-gate preview`; auth the Authorization header value, or null.
export async function runContent({ dir, slug, preview, auth = null, env = process.env, run = runChild }) {
  const out = deployedDir(dir, slug);
  const files = { record: join(out, 'content.json'), domEquality: join(out, 'content-dom-equality.md'), figmaText: join(out, 'content-figma-text.json'), slotCoverage: join(out, 'content-slot-coverage.md') };
  for (const f of Object.values(files)) rmSync(f, { force: true });

  if (typeof preview?.url !== 'string' || !preview.url) throw new UsageError(`${join(out, 'preview.json')} has no url: run deployed-gate preview --page ${slug} again`);
  // Before the live source is crawled: a protected preview cannot be read without the token, and a gate that finds out
  // only after the capture has spent its hits on the source.
  if (preview.auth && !auth) throw new UsageError(`content needs the site token to read a protected preview${authHint(preview, auth)}`);
  const modelPath = join(dir, 'reskin', 'content-model', slug, 'content-model.json');
  const provenance = readInput(modelPath, 'the content model the reskin captures from the live source')?._provenance;
  const figma = provenance?.source?.kind === 'figma';
  if (!figma && (typeof provenance?.url !== 'string' || !provenance.url.trim())) throw new UsageError(`${modelPath} has no _provenance.url: the live source this page is compared with`);
  const normalizePath = join(dir, 'reskin', 'normalize', `${slug}.mjs`);
  const deltasPath = join(dir, 'reskin', 'deltas', `${slug}.json`);
  const deltas = existsSync(deltasPath) ? loadDeltas(deltasPath) : null;
  const optional = (flag, path, present) => (present ? [flag, path] : []);
  const scope = typeof provenance.scope === 'string' && provenance.scope.trim() ? provenance.scope : null;

  const gates = [
    figma ? {
      name: 'figma-text-gate',
      report: files.figmaText,
      args: [FIGMA_TEXT, '--model', modelPath, '--rendered', preview.url, '--dir', dir, '--wait-eds', '--report', files.figmaText],
    } : {
      name: 'dom-equality',
      report: files.domEquality,
      args: [DOM_EQUALITY, '--source', provenance.url, ...(scope ? ['--source-scope', scope] : []), ...optional('--normalize', normalizePath, existsSync(normalizePath)),
        '--rendered', preview.url, '--rendered-scope', 'main', ...optional('--deltas', deltasPath, deltas), '--wait-eds', '--report', files.domEquality],
    },
    {
      name: 'slot-coverage',
      report: files.slotCoverage,
      args: [SLOT_COVERAGE, '--model', modelPath, '--rendered', preview.url, ...optional('--deltas', deltasPath, deltas), '--wait-eds', '--report', files.slotCoverage],
    },
  ];

  const results = [];
  for (const { name, report, args } of gates) {
    let r;
    try { r = await run(process.execPath, [...args, ...tokenFlags(auth)], { env: childEnv(env, auth), encoding: 'utf8' }); } catch (e) { throw coded(124, redact(`${name} did not start: ${e.message}`, auth)); }
    const stop = setupError(r, { name, auth });
    if (stop) throw stop;
    if ((r.status !== 0 && r.status !== 1) || !existsSync(report)) throw coded(124, `${name} did not give a verdict (exit ${r.status ?? r.signal}): ${outputOf(r, auth)}`);
    const stdout = redact(r.stdout ?? '', auth);
    results.push({
      name,
      exit: r.status,
      report,
      advisory: r.status === 0 && stdout.includes(ADVISORY),
      lines: redact(`${r.stderr ?? ''}\n${stdout}`, auth).split('\n').filter((l) => FINDING.test(l)).slice(0, MAX_FINDINGS),
      unused: unusedIds(stdout, deltas),
    });
  }

  const [dom, slot] = results;
  const record = {
    verdict: results.some((g) => g.exit === 1) ? 'FAIL' : results.some((g) => g.advisory) ? 'ADVISORY' : 'PASS',
    [figma ? 'figmaText' : 'domEquality']: { exit: dom.exit, report: dom.report },
    slotCoverage: { exit: slot.exit, report: slot.report },
    unusedDeltas: [...new Set(results.flatMap((g) => g.unused))],
  };
  writeJson(files.record, record);
  return { ...record, gates: results.map(({ name, exit, report, advisory, lines }) => ({ name, exit, report, advisory, lines })) };
}
