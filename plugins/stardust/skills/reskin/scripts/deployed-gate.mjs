#!/usr/bin/env node
// skills/reskin/scripts/deployed-gate.mjs — checks of a deployed reskin page on its aem.page branch preview. One CLI,
// steps in ./deployed/, the Figma helpers it shares with figma-gate.mjs in ./figma/:
//   preview  A0: the branch preview of the page: the project can have one, its authored form (.plain.html) and
//            delivered page answer 200, and the page keeps to its namespace in a shared repo (its path, and the
//            nav and footer metas of its head). Writes preview.json.
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
--path         the page's delivered path, without .html (/ns/home)
--auth-header  Authorization header value for a protected preview, or --token-env <NAME>, the environment
               variable (or .env entry) that holds the token; neither may be empty. Sent to the preview origin
               only, never printed or recorded (preview.json says only auth: true).
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
  let auth = null;
  let eds = null;
  if (opts['auth-header'] !== undefined || opts['token-env'] !== undefined) {
    eds = await helper('eds');
    await eds.loadLiveSession();
    auth = eds.siteAuth({ authHeader: opts['auth-header'], tokenEnv: opts['token-env'] });
    if (!auth?.trim()) throw new UsageError(`no site token: --token-env ${opts['token-env']} is not set in the environment or .env`);
  }
  const say = (m) => log(auth ? eds.redact(m, auth) : m);
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
    if (auth && e?.message) e.message = eds.redact(e.message, auth);
    throw e;
  }
}

// steps lets a test replace a step function.
export async function main(argv, { env = process.env, log = console.log, warn = (m) => process.stderr.write(`${m}\n`), steps = {} } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) { log(HELP); return 0; }
  const { UsageError } = await helper('errors', 'figma');
  const { cmd, opts } = parseArgs(argv, UsageError);
  const dir = opts.dir || 'stardust';
  const table = { preview: previewStep, ...steps };
  return table[cmd]({ dir, opts, env, log, warn, UsageError, steps: table });
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`deployed-gate: ${String(e?.message ?? e)}`);
    process.exitCode = e?.exitCode ?? (Number.isInteger(e?.code) ? e.code : 124);
  });
}
