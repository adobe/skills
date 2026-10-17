#!/usr/bin/env node
// skills/reskin/scripts/deployed-gate.mjs — checks of a deployed reskin page on its aem.page branch preview. One CLI,
// steps in ./deployed/, the Figma helpers it shares with figma-gate.mjs in ./figma/:
//   preview  A0: the branch preview of the page: the project can have one, its authored form (.plain.html) and
//            delivered page answer 200, and the page keeps to its namespace in a shared repo (its path, and the
//            nav and footer metas of its head). Writes preview.json.
//   content  A1: the preview's text and images against the live source (dom-equality) and the content model slot by
//            slot (slot-coverage), with the page's declared deltas. Blocking unless the delta file says otherwise.
//   tokens   A2: the donor tokens asserted on the EDS DOM of the preview, through donor-probe.mjs. Blocking.
// Writes go only under <dir>/.work/reskin/gates/<slug>/deployed/.
// --help answers before any helper import, so it works even from a partial copy of the scripts.
// Exit codes: 0 pass, advisory or skipped · 1 a blocking check failed · 2 usage or setup · 3 bot challenge or token
// halt · 124 no verdict (re-run once, never a fix iteration).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

export const HELP = `Usage:
  node deployed-gate.mjs preview --page <slug> --org <o> --repo <r> --branch <b> --path </ns/slug>
                         (--namespace <ns> | --sandbox) [--auth-header <value> | --token-env <NAME>]
                         [--max-wait 120] [--dir stardust]
  node deployed-gate.mjs content --page <slug> [--auth-header <value> | --token-env <NAME>] [--dir stardust]
  node deployed-gate.mjs tokens --page <slug> [--auth-header <value> | --token-env <NAME>] [--dir stardust]

Checks of a deployed reskin page on its aem.page branch preview.

preview  A0. Finds the preview and refuses a page that touches shared documents.
         Runs only in an aem-boilerplate project: stardust/runtime-contract.json (deploy's runtime probe),
         head.html and scripts/aem.js at the project root, the parent of --dir. Otherwise it prints
         "SKIPPED deployed leg: <reason>", records that and exits 0.
         Polls https://<branch>--<repo>--<org>.aem.page<path>.plain.html (a host label over 63 characters
         is a setup error: shorten the branch) every second until it answers 200, then the delivered page
         <path> the same way, at most --max-wait seconds in all (default 120; each request is cut off at the
         time left): no 200 is "ERROR (exit 124) preview: <path>[.plain.html] not 200 after <n> s".
         Then, in a shared repo, the path must be a plain path (no %, \\, ., .. or empty segment) starting
         with /<ns>/, and the head of the delivered page must carry <meta name="nav"> and <meta name="footer">
         naming /<ns>/nav and /<ns>/footer (a full URL on the preview origin is the same path; EDS strips the
         metadata block from the authored form and emits head metas): "FAIL preview: <problem>" per finding, exit 1.
         --sandbox (a repo of one's own) waives both and is recorded; give --namespace or --sandbox, not both.
         Prints "PASS preview <url>". Writes <dir>/.work/reskin/gates/<slug>/deployed/preview.json:
           { skipped?, reason?, url, origin, path, plain, namespace, sandbox, auth, checkedAt, problems? }
content  A1. Checks the preview's content against the live source, through two gates run one after the other, each with the
         decoration settled first (--wait-eds): dom-equality (the text and images of the preview's main against the
         source page, <_provenance.url> and <_provenance.scope> of the content model, normalized by
         <dir>/reskin/normalize/<slug>.mjs when that file exists) and slot-coverage (the content model slot by slot,
         with the metadata). Reads preview.json (no record, or one with problems, is exit 2; a skipped leg prints
         "not run: skipped", exit 0), <dir>/reskin/content-model/<slug>/content-model.json (missing is exit 2) and,
         when it exists, the page's declared differences <dir>/reskin/deltas/<slug>.json, handed to both gates as
         --deltas. Without that file nothing is allowed for and a failed check blocks; with it, "blocking": false
         makes a failed check advisory and the key left out means true. Prints "PASS content", "ADVISORY content:
         <gate> …" (exit 0: a check failed, deltas.blocking is false) or "FAIL content: <gate> …" (exit 1) for each
         gate that failed, with the report and its findings, then one "WARNING unused delta <id>" per declared
         entry that matched nothing in either gate. Writes content-dom-equality.md, content-slot-coverage.md and
         content.json ({ verdict, domEquality: { exit, report }, slotCoverage: { exit, report }, unusedDeltas })
         beside preview.json. A gate that cannot run is exit 2 (a stalled decoration, an unreachable or protected
         page, an invalid delta file), 3 (a bot challenge) or 124 (no verdict). The token reaches the gates by
         environment, never argv.
tokens   A2. Asserts the donor tokens on the EDS DOM of the preview, through donor-probe.mjs (the decoration
         settled first, no overflow sanity): palette and type on body, main h1 and main h2, the primary button
         on main a.button.primary (the runtime contract's buttonClasses must name .button.primary), then each
         :root token of the block the reskin renders from the sheet, verbatim. Reads preview.json (no record, or
         one with problems, is exit 2; a skipped leg prints "not run: skipped", exit 0), the donor token sheet
         <dir>/reskin/donor-tokens.json and the runtime contract stardust/runtime-contract.json at the project
         root (missing either is exit 2). layout.containerMaxWidth (measured by parity's cap-probe) and
         layout.sectionPaddingY (EDS section rhythm, measured in the real run) are not asserted: each prints
         a SKIP line. Prints "PASS tokens n/n" or "FAIL tokens k/n" (k of the n assertions failing) plus one
         indented line per failing assertion (exit 1). Writes tokens-spec.json, tokens-probe.md,
         tokens-probe.json and tokens.json ({ verdict, exit, report, json, skipped }) beside preview.json. The
         token reaches donor-probe by environment, never argv. A probe that cannot run is exit 2 (a stalled
         decoration, an unreachable or protected page), 3 (a bot challenge) or 124 (no verdict).
--path         the page's delivered path, without .html (/ns/home)
--auth-header  Authorization header value for a protected preview, or --token-env <NAME>, the environment
               variable (or .env entry) that holds the token; neither may be empty. Sent to the preview origin
               only, never printed or recorded (preview.json says only auth: true). tokens hands it to
               donor-probe, content to dom-equality and slot-coverage, as the variable DEPLOYED_GATE_SITE_TOKEN,
               which puts "token " in front of a value that starts with neither "token " nor "bearer ".
--dir <d>      the stardust directory (default stardust).
DEPLOY_VERIFY_ORIGIN (environment) replaces the preview origin: a test hook.

Exit codes: 0 pass, advisory or skipped · 1 a blocking check failed · 2 usage or setup · 3 bot challenge or
            token halt · 124 no verdict: the preview never answered; re-run once, the same 124 twice is a
            residual (needs-owner), never a fix iteration.`;

const SPEC = {
  preview: {
    values: ['--page', '--org', '--repo', '--branch', '--path', '--namespace', '--auth-header', '--token-env', '--max-wait', '--dir'],
    bools: ['--sandbox'],
    positional: [],
  },
  content: {
    values: ['--page', '--auth-header', '--token-env', '--dir'],
    bools: [],
    positional: [],
  },
  tokens: {
    values: ['--page', '--auth-header', '--token-env', '--dir'],
    bools: [],
    positional: [],
  },
};

const AUTH_FLAGS = new Set(['auth-header', 'token-env']);

export function parseArgs(argv, UsageError) {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new UsageError(`no command\n${HELP}`);
  const spec = SPEC[cmd];
  if (!spec) throw new UsageError(`unknown command "${cmd}"\n${HELP}`);
  const opts = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (spec.values.includes(a)) {
      const val = rest[i + 1];
      // A blank secret never falls back to $SITE_TOKEN or a .env: it is a missing value.
      if (val === undefined || val.startsWith('--') || (AUTH_FLAGS.has(a.slice(2)) && !val.trim())) throw new UsageError(`${a} needs a value`);
      opts[a.slice(2)] = val;
      i += 1;
    } else if (spec.bools.includes(a)) opts[a.slice(2)] = true;
    else if (a.startsWith('--')) throw new UsageError(`unknown flag ${a} for ${cmd}`);
    else positional.push(a);
  }
  if (positional.length < spec.positional.length) throw new UsageError(`${cmd} needs ${spec.positional.join(' ')}`);
  if (positional.length > spec.positional.length) throw new UsageError(`unexpected argument "${positional[spec.positional.length]}"`);
  return { cmd, positional, opts };
}

// A partial copy of the scripts is a setup error with the fix, not a module stack trace.
async function helper(name, sub = 'deployed') {
  try { return await import(`./${sub}/${name}.mjs`); } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !String(e.message).includes(`${sub}/${name}.mjs`)) throw e;
    const err = new Error(`the ${sub}/ helpers are missing beside deployed-gate.mjs: copy the reskin scripts recursively (cp -R <plugin>/skills/reskin/scripts/. stardust/scripts/reskin/)`);
    err.code = 2;
    throw err;
  }
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// The site token the gate was given (--auth-header or --token-env), or null. `say` prints through redact and
// `scrub` takes the token out of an error text, so no line the gate prints can carry it.
async function siteToken(opts, log, UsageError) {
  if (opts['auth-header'] === undefined && opts['token-env'] === undefined) return { auth: null, say: log, scrub: (e) => e };
  const eds = await helper('eds');
  await eds.loadLiveSession();
  const auth = eds.siteAuth({ authHeader: opts['auth-header'], tokenEnv: opts['token-env'] });
  if (!auth?.trim()) throw new UsageError(`no site token: --token-env ${opts['token-env']} is not set in the environment or .env`);
  return {
    auth,
    say: (m) => log(eds.redact(m, auth)),
    scrub: (e) => { if (e?.message) e.message = eds.redact(e.message, auth); return e; },
  };
}

async function previewStep({ dir, opts, env, log, UsageError }) {
  for (const flag of ['page', 'org', 'repo', 'branch', 'path']) {
    if (!opts[flag]) throw new UsageError(`preview needs --${flag}`);
  }
  if (!NAME.test(opts.page)) throw new UsageError(`--page must be a slug (letters, digits, . _ -), got "${opts.page}"`);
  if (!opts.sandbox && !opts.namespace) throw new UsageError('preview needs --namespace <ns> or --sandbox: say whether the repo is shared');
  if (opts.sandbox && opts.namespace) throw new UsageError('--namespace and --sandbox exclude each other: --sandbox waives the namespace');
  if (opts.namespace && !NAME.test(opts.namespace)) throw new UsageError(`--namespace must be a single path segment, got "${opts.namespace}"`);
  if (!/^\/[^?#\s]*$/.test(opts.path)) throw new UsageError(`--path must start with / and hold no query or fragment, got "${opts.path}"`);
  if (/\.html$/.test(opts.path)) throw new UsageError(`--path is the delivered path without .html, got "${opts.path}"`);
  const maxWaitSec = opts['max-wait'] === undefined ? 120 : Number(opts['max-wait']);
  if (!Number.isInteger(maxWaitSec) || maxWaitSec < 1) throw new UsageError(`--max-wait needs a positive integer (seconds), got "${opts['max-wait']}"`);

  const { runPreview } = await helper('preview');
  const { auth, say, scrub } = await siteToken(opts, log, UsageError);
  try {
    const record = await runPreview({ dir, slug: opts.page, org: opts.org, repo: opts.repo, branch: opts.branch, path: opts.path, namespace: opts.namespace, sandbox: !!opts.sandbox, auth, maxWaitSec, env });
    if (record.skipped) { say(`SKIPPED deployed leg: ${record.reason}`); return 0; }
    if (record.problems) { for (const p of record.problems) say(`FAIL preview: ${p}`); return 1; }
    say(`PASS preview ${record.url}`);
    return 0;
  } catch (e) {
    if (e?.code === 124) {
      say(`ERROR (exit 124) preview: ${e.message}`);
      say(`  last response: ${e.last}`);
      return 124;
    }
    throw scrub(e);
  }
}

// The record of `deployed-gate preview` for --page, or null once the leg is skipped (`not run: skipped`). Every step after
// preview starts here.
async function pageRecord(step, { dir, opts, log, UsageError }) {
  if (!opts.page) throw new UsageError(`${step} needs --page <slug>`);
  if (!NAME.test(opts.page)) throw new UsageError(`--page must be a slug (letters, digits, . _ -), got "${opts.page}"`);
  const { readPreview } = await helper('io');
  const preview = readPreview(dir, opts.page);
  if (preview.skipped) { log('not run: skipped'); return null; }
  if (preview.problems?.length) throw new UsageError(`preview has problems: run deployed-gate preview again (${preview.problems.length} recorded in preview.json)`);
  return preview;
}

async function contentStep(ctx) {
  const { dir, opts, env, log, UsageError } = ctx;
  const preview = await pageRecord('content', ctx);
  if (!preview) return 0;
  const { runContent } = await helper('content');
  const { auth, say, scrub } = await siteToken(opts, log, UsageError);
  try {
    const result = await runContent({ dir, slug: opts.page, preview, auth, env });
    if (result.verdict === 'PASS') say('PASS content');
    for (const g of result.gates.filter((x) => x.exit === 1 || x.advisory)) {
      say(g.advisory ? `ADVISORY content: ${g.name} — report ${g.report} (deltas.blocking false: reported, not enforced)` : `FAIL content: ${g.name} — report ${g.report}`);
      for (const line of g.lines) say(`  ${line.trim()}`);
    }
    for (const id of result.unusedDeltas) say(`WARNING unused delta ${id}`);
    return result.verdict === 'FAIL' ? 1 : 0;
  } catch (e) {
    throw scrub(e);
  }
}

async function tokensStep(ctx) {
  const { dir, opts, env, log, UsageError } = ctx;
  const preview = await pageRecord('tokens', ctx);
  if (!preview) return 0;
  const { runTokens } = await helper('eds-spec');
  const { auth, say, scrub } = await siteToken(opts, log, UsageError);
  try {
    const result = await runTokens({ dir, slug: opts.page, preview, auth, env });
    say(result.verdict === 'PASS' ? `PASS tokens ${result.total}/${result.total}` : `FAIL tokens ${result.failures.length}/${result.total}`);
    for (const f of result.failures) say(`  ${f}`);
    for (const s of result.skipped) say(`SKIP ${s}`);
    return result.exit;
  } catch (e) {
    throw scrub(e);
  }
}

// steps lets a test replace a step function.
export async function main(argv, { env = process.env, log = console.log, warn = (m) => process.stderr.write(`${m}\n`), steps = {} } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) { log(HELP); return 0; }
  const { UsageError } = await helper('errors', 'figma');
  const { cmd, opts } = parseArgs(argv, UsageError);
  const dir = opts.dir || 'stardust';
  const table = { preview: previewStep, content: contentStep, tokens: tokensStep, ...steps };
  return table[cmd]({ dir, opts, env, log, warn, UsageError, steps: table });
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`deployed-gate: ${String(e?.message ?? e)}`);
    process.exitCode = e?.exitCode ?? (Number.isInteger(e?.code) ? e.code : 124);
  });
}
