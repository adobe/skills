// skills/reskin/scripts/deployed/inherited.mjs — A5 of the deployed leg, `inherited`: the gates deploy runs on a delivered
// page, run on the preview. The rows, in order:
//   .plain.html         the authored form (preview.json's `plain`) fetched directly: 200, exactly one <h1>, no about:error,
//                       no src that starts with /img/ (a repo-relative image the ingester could not take) and a top-level
//                       <div> (the sections EDS delivers)
//   ai-readability      deploy's ai-readability.mjs on the preview's origin and path, --min 98: the page's code score, read
//                       from the --json report
//   qa-gate             deploy's qa-gate.mjs on the preview with the page's section schema (<dir>/eds-schema/<slug>.json,
//                       deploy Step 2b) and the sizing model parity's cap-probe captured (<deployed>/design.json)
//   by deploy           localize-links --check, davids-model-lint and block-roundtrip --ew run in deploy's own loop before the
//                       push; recorded, never PASS or FAIL, never part of the verdict
// A protected preview (preview.json says auth: true) needs the site token: the .plain.html request carries it to the
// preview origin and to no other, ai-readability gets the bare token by environment (--token-env: it puts "token " in front
// itself, so only a "token …" header reaches it), qa-gate carries no site auth ("n/a: protected preview"). A token the
// preview does not need is not sent. The token never travels in argv and never appears in a row, a line or a record.
//   plainAsserts(html)  the problems of an authored form, as strings; none is a pass
//   runInherited({ dir, slug, preview, auth, tools, env })  writes inherited.json ({ verdict, rows }) and returns
//        { verdict: 'PASS' | 'FAIL' | 'ERROR', exit, rows }. A row is { check, value, bar, status: 'PASS' | 'FAIL' |
//        'ERROR' | 'n/a' | 'by deploy', detail? }. A check that gave no verdict (no answer from the preview, an instrument
//        exiting other than 0 or 1, no score in the report, no QA GATE line) is "ERROR (exit N)", the verdict ERROR and the
//        exit 124; a bot challenge throws an error with code 3. A setup problem throws a UsageError: a record without its
//        url, a missing instrument, a protected preview and no token (or one it does not accept). `tools` maps readability
//        and qa to script paths (default: deployTools()), for tests.
//   deployTools(from)   the two instruments in either layout of the scripts, or a UsageError naming what is missing
//   inheritedLines(result)  the lines the CLI prints
// Evidence: <deployed>/inherited/ (ai-readability.json, qa-gate.txt) and <deployed>/inherited.json.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { writeJson } from '../figma/io.mjs';
import { authHint, callTool as call, childEnv, exitOf, firstLine, outputOf, parseJson, tokenFlags } from './child.mjs';
import { redact } from './eds.mjs';
import { fetchOnce } from './fetch.mjs';
import { deployedDir } from './io.mjs';
import { EXIT, listed, stepLines, verdictOf } from './rows.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Two layouts, one level deeper than the top-level scripts: the plugin tree (skills/reskin/scripts/deployed ↔
// skills/deploy/scripts) and the project copy (stardust/scripts/reskin/deployed ↔ stardust/scripts/deploy).
const DEPLOY = ['../../../deploy/scripts', '../../deploy'];
const TOOL_FILES = { readability: 'ai-readability.mjs', qa: 'qa-gate.mjs' };

const MIN_READABILITY = 98;
const REQUEST_MS = 30000;
const MAX_BLOCKS = 3;
const MAX_SRCS = 3;
const BY_DEPLOY = ['localize-links --check', 'davids-model-lint', 'block-roundtrip --ew'];
const BAR_OF = {
  '.plain.html': '200, one <h1>, no about:error, no /img/ src',
  'ai-readability': `≥ ${MIN_READABILITY}`,
  'qa-gate': '0 fail',
  ...Object.fromEntries(BY_DEPLOY.map((check) => [check, 'run by deploy before the DA push'])),
};

function missingTools(names) {
  return new UsageError(`${names.join(', ')} not found (looked in ../../../deploy/scripts/ and ../../deploy/): copy the deploy skill's scripts beside the reskin scripts (stardust/scripts/deploy/)`);
}

// The two instruments by role, from `from` (the directory of this file) in whichever layout holds them.
export function deployTools(from = HERE) {
  const dirs = DEPLOY.map((p) => resolve(from, p));
  const tools = {};
  const missing = [];
  for (const [role, file] of Object.entries(TOOL_FILES)) {
    const dir = dirs.find((d) => existsSync(join(d, file)));
    if (dir) tools[role] = join(dir, file); else missing.push(file);
  }
  if (missing.length) throw missingTools(missing);
  return tools;
}

function checkTools(tools) {
  const missing = Object.entries(TOOL_FILES).filter(([role]) => !tools[role] || !existsSync(tools[role])).map(([, file]) => file);
  if (missing.length) throw missingTools(missing);
  return tools;
}

// ---- the authored form ---------------------------------------------------------------------------------------------

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const WRAPPERS = new Set(['html', 'head', 'body', 'main']);
const TAG = /<(\/?)([a-z][a-z0-9-]*)\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;
const SRC = /(?<![\w-])src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

// Whether a <div> sits directly in the document, <body> or <main>: how EDS delivers the sections of a page.
function hasTopLevelDiv(html) {
  const open = [];
  for (const [tag, closing, name] of html.matchAll(TAG)) {
    const el = name.toLowerCase();
    if (closing) {
      const at = open.lastIndexOf(el);
      if (at >= 0) open.length = at;
    } else {
      if (el === 'div' && open.every((n) => WRAPPERS.has(n))) return true;
      if (!VOID.has(el) && !tag.endsWith('/>')) open.push(el);
    }
  }
  return false;
}

// The problems of a `.plain.html` body, [] when it is as deploy delivers a page. Comments, scripts and styles, which hold
// tag-like text, are not read for tags or sources.
export function plainAsserts(html) {
  const text = String(html ?? '');
  const markup = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
  const problems = [];
  const h1 = (markup.match(/<h1(?=[\s>/])/gi) ?? []).length;
  if (h1 !== 1) problems.push(`${h1} <h1>`);
  if (text.includes('about:error')) problems.push('about:error');
  const imgs = [...markup.matchAll(SRC)].map((m) => m[1] ?? m[2] ?? m[3]).filter((src) => src.startsWith('/img/'));
  if (imgs.length) problems.push(`${imgs.length} /img/ src${imgs.length === 1 ? '' : 's'}: ${imgs.slice(0, MAX_SRCS).join(', ')}${imgs.length > MAX_SRCS ? ', …' : ''}`);
  if (!hasTopLevelDiv(markup)) problems.push('no top-level <div>');
  return problems;
}

// ---- rows ----------------------------------------------------------------------------------------------------------

const row = (check, status, value, detail = null) => ({ check, value, bar: BAR_OF[check], status, ...(detail ? { detail } : {}) });
const naRow = (check, reason) => row(check, 'n/a', `n/a: ${reason}`);
const errorRow = (check, code, detail) => row(check, 'ERROR', `ERROR (exit ${code})`, detail);
const counted = (r) => r.status === 0 || r.status === 1;
const readJsonFile = (file) => { try { return parseJson(readFileSync(file, 'utf8')); } catch { return null; } };

async function plainRow({ preview, token }) {
  const got = await fetchOnce(preview.plain, token, REQUEST_MS);
  if (got.status === 0) return errorRow('.plain.html', EXIT.ERROR, got.last);
  if (got.status === 401 || got.status === 403) {
    throw new UsageError(`${preview.plain} answered HTTP ${got.status}: ${token ? 'the site token was not accepted' : 'the preview is protected: run deployed-gate preview again with --auth-header or --token-env'}`);
  }
  if (got.status !== 200) return row('.plain.html', 'FAIL', `HTTP ${got.status}`);
  const problems = plainAsserts(got.body);
  return problems.length ? row('.plain.html', 'FAIL', problems.join('; ')) : row('.plain.html', 'PASS', '200, 1 <h1>');
}

// The blocks a crawler that does not run scripts reads least of, by the words the served HTML lacks.
function gapDetail(page) {
  const lines = [];
  if (Number.isFinite(page.strict?.score)) lines.push(`strict ${page.strict.score}%`);
  const blocks = (Array.isArray(page.blocks) ? page.blocks : []).filter((b) => b.servedGap > 0).sort((a, b) => b.servedGap - a.servedGap).slice(0, MAX_BLOCKS);
  for (const b of blocks) lines.push(`${b.block}: ${b.servedGap} of ${b.words} words not in the served HTML`);
  return lines.join('\n') || null;
}

// ai-readability's --token-env sends "token <value>": it takes the bare token of a "token …" header and cannot carry
// another scheme.
const bareToken = (header) => (/^token /i.test(header) ? header.replace(/^token /i, '') : null);

async function readabilityRow({ preview, token, out, tools, env }) {
  const bare = token ? bareToken(token) : null;
  if (token && !bare) return naRow('ai-readability', 'the site token is not a "token" scheme, the only one ai-readability sends');
  const file = join(out, 'ai-readability.json');
  const r = await call('ai-readability', tools.readability, ['--origin', preview.origin, preview.path, '--min', String(MIN_READABILITY), ...tokenFlags(bare), '--json', file], childEnv(env, bare));
  const page = counted(r) ? readJsonFile(file)?.pages?.[0] : null;
  const score = page?.code?.score;
  if (!Number.isFinite(score)) {
    const said = page?.error ? `${page.path}: ${page.error}` : firstLine(outputOf(r, token));
    return errorRow('ai-readability', exitOf(r), redact(said || `ai-readability exited ${exitOf(r)} without a score`, token));
  }
  return score < MIN_READABILITY ? row('ai-readability', 'FAIL', String(score), gapDetail(page)) : row('ai-readability', 'PASS', String(score));
}

async function qaRow({ preview, schema, design, out, tools, env }) {
  if (preview.auth) return naRow('qa-gate', 'protected preview');
  if (!existsSync(schema)) return naRow('qa-gate', 'run deploy Step 2b');
  if (!existsSync(design)) return naRow('qa-gate', 'run deployed-gate parity first (design.json)');
  const r = await call('qa-gate', tools.qa, [preview.url, '--schema', schema, '--design', design], childEnv(env, null));
  writeFileSync(join(out, 'qa-gate.txt'), r.stdout);
  const summary = r.stdout.match(/^QA GATE: (?:PASS|FAIL) — (.+)$/m)?.[1];
  if (!counted(r) || !summary) return errorRow('qa-gate', exitOf(r), firstLine(outputOf(r, null)) || `qa-gate exited ${exitOf(r)} without a QA GATE line`);
  if (r.status === 0) return row('qa-gate', 'PASS', summary);
  const fails = r.stdout.split('\n').filter((l) => /^\s*✗ /.test(l)).map((l) => l.replace(/^\s*✗ /, '').trim());
  return row('qa-gate', 'FAIL', summary, listed(fails));
}

// preview is the record of `deployed-gate preview`; auth the Authorization header value, or null.
export async function runInherited({ dir, slug, preview, auth = null, tools = null, env = process.env }) {
  const deployed = deployedDir(dir, slug);
  const out = join(deployed, 'inherited');
  const record = join(deployed, 'inherited.json');
  for (const stale of [record, out]) rmSync(stale, { recursive: true, force: true });

  for (const key of ['url', 'origin', 'path', 'plain']) {
    if (typeof preview?.[key] !== 'string' || !preview[key]) throw new UsageError(`${join(deployed, 'preview.json')} has no ${key}: run deployed-gate preview --page ${slug} again`);
  }
  if (preview.auth && !auth) throw new UsageError(`inherited needs the site token to read a protected preview${authHint(preview, auth)}`);
  const instruments = tools ? checkTools(tools) : deployTools();
  mkdirSync(out, { recursive: true });

  const token = preview.auth ? auth : null;
  const run = {
    preview,
    token,
    out,
    tools: instruments,
    env,
    schema: join(dir, 'eds-schema', `${slug}.json`),
    design: join(deployed, 'design.json'),
  };
  const rows = [await plainRow(run), await readabilityRow(run), await qaRow(run), ...BY_DEPLOY.map((check) => row(check, 'by deploy', 'by deploy'))];
  const verdict = verdictOf(rows);
  writeJson(record, { verdict, rows });
  return { verdict, exit: EXIT[verdict], rows };
}

// What a failing row says: ai-readability's score against its bar, any other row its value.
const failure = (r) => (r.check === 'ai-readability' ? `ai-readability ${r.value} < ${MIN_READABILITY}` : `${r.check}: ${r.value}`);

// The lines the CLI prints: a line for the checks that gave no verdict, the verdict line, one indented line per failing
// row (its findings below), and one line per distinct reason a row was not run (n/a) and for deploy's own gates.
export const inheritedLines = (result) => stepLines('inherited', result, { failure, unrun: ['n/a', 'by deploy'] });
