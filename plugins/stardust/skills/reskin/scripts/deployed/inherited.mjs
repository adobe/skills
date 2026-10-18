// skills/reskin/scripts/deployed/inherited.mjs — A5 of the deployed leg, `inherited`: the gates deploy runs on a delivered
// page, run on the preview. The rows, in order:
//   .plain.html         the authored form (preview.json's `plain`) fetched directly: 200, exactly one <h1>, no about:error,
//                       no src, srcset candidate or poster that starts with /img/ (a repo-relative image the ingester could
//                       not take) and a top-level <div> (the sections EDS delivers). Tags and attribute values are read,
//                       never text that looks like them; a 5xx or 429 answer is no verdict, a 404 or other answer a FAIL
//   ai-readability      deploy's ai-readability.mjs on the preview's origin and path, --min 98: the page's code score, read
//                       from the --json report
//   qa-gate             deploy's qa-gate.mjs on the preview with the page's section schema (<dir>/eds-schema/<slug>.json,
//                       deploy Step 2b) and the sizing model parity's cap-probe captured (<deployed>/design.json); run on
//                       the inputs there are, and a missing one makes the row a FAIL ("incomplete: ..."), never a pass
//   by deploy           localize-links --check, davids-model-lint and block-roundtrip --ew run in deploy's own loop before the
//                       push; recorded, never PASS or FAIL, never part of the verdict
// A protected preview (preview.json says auth: true) needs the site token, `auth`, and without one is a setup error. It goes
// to the preview origin and to no other: the .plain.html request carries it, and ai-readability and qa-gate get it by
// environment and --token-env, aimed at that origin by --auth-origin (the token never travels in argv, and never appears in a
// row, a line or a record). A record whose plain URL is elsewhere is a setup error. A public preview is sent none, whatever
// token was given.
//   plainAsserts(html)  the problems of an authored form, as strings; none is a pass
//   runInherited({ dir, slug, preview, auth, tools, env })  writes inherited.json ({ verdict, rows }) and returns
//        { verdict: 'PASS' | 'FAIL' | 'ERROR', exit, rows }. A row is { check, value, bar, status: 'PASS' | 'FAIL' |
//        'ERROR' | 'by deploy', detail? }. A check that gave no verdict (no answer or a 5xx or 429 from the preview, an
//        instrument exiting other than 0 or 1, no score in the report, no QA GATE line) is "ERROR (exit N)", the verdict
//        ERROR and the exit 124; a bot challenge throws an error with code 3. A setup problem throws a UsageError: a record
//        without its url or with a plain URL off its origin, a missing instrument, a protected preview and no token (or one
//        it does not accept). `tools` maps readability and qa to script paths (default: deployTools()), for tests.
//   deployTools(from)   the two instruments in either layout of the scripts, or a UsageError naming what is missing
//   inheritedLines(result)  the lines the CLI prints
// Evidence: <deployed>/inherited/ (ai-readability.json, qa-gate.txt) and <deployed>/inherited.json.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from '../figma/errors.mjs';
import { writeJson } from '../figma/io.mjs';
import { callOnPreview, exitOf, firstLine, outputOf, parseJson, previewToken } from './child.mjs';
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
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
// Comments, scripts and styles, which hold tag-like text, in one pass: removed one kind at a time, the opening of one kind
// inside another ("<!--" in a script) would swallow the page.
const INERT = /<!--[\s\S]*?-->|<(script|style)(?=[\s/>])[\s\S]*?<\/\1\s*>/gi;

// The URLs of a srcset: each candidate is a URL (no whitespace) and its descriptors, up to the next comma.
function srcsetUrls(value) {
  const urls = [];
  let rest = value.replace(/^[\s,]+/, '');
  while (rest) {
    const url = rest.match(/^\S+/)[0];
    rest = rest.slice(url.length);
    if (url.endsWith(',')) urls.push(url.replace(/,+$/, ''));
    else {
      urls.push(url);
      rest = rest.replace(/^[^,]*,?/, '');
    }
    rest = rest.replace(/^[\s,]+/, '');
  }
  return urls;
}

// The image sources a tag's attributes name (src, poster, every srcset candidate): the attribute values, never text.
function sourcesOf(attrs) {
  const urls = [];
  for (const [, name, dq, sq, bare] of attrs.matchAll(ATTR)) {
    const value = (dq ?? sq ?? bare ?? '').trim();
    const key = name.toLowerCase();
    if (key === 'src' || key === 'poster') urls.push(value);
    else if (key === 'srcset') urls.push(...srcsetUrls(value));
  }
  return urls;
}

// What the tags of the markup say: how many <h1> open, the image sources they name, and whether a <div> sits directly in
// the document, <body> or <main>: how EDS delivers the sections of a page.
function scanTags(markup) {
  const open = [];
  const scan = { h1: 0, sources: [], topLevelDiv: false };
  for (const [tag, closing, name] of markup.matchAll(TAG)) {
    const el = name.toLowerCase();
    if (closing) {
      const at = open.lastIndexOf(el);
      if (at >= 0) open.length = at;
      continue;
    }
    if (el === 'h1') scan.h1 += 1;
    scan.sources.push(...sourcesOf(tag.slice(name.length + 1)));
    if (el === 'div' && open.every((n) => WRAPPERS.has(n))) scan.topLevelDiv = true;
    if (!VOID.has(el) && !tag.endsWith('/>')) open.push(el);
  }
  return scan;
}

// The problems of a `.plain.html` body, [] when it is as deploy delivers a page. Tags and their attributes are read from
// the markup left once comments, scripts and styles are out; text that looks like a tag or an attribute is not one.
export function plainAsserts(html) {
  const text = String(html ?? '');
  const { h1, sources, topLevelDiv } = scanTags(text.replace(INERT, ''));
  const problems = [];
  if (h1 !== 1) problems.push(`${h1} <h1>`);
  if (text.includes('about:error')) problems.push('about:error');
  const imgs = sources.filter((src) => src.startsWith('/img/'));
  if (imgs.length) problems.push(`${imgs.length} /img/ src${imgs.length === 1 ? '' : 's'}: ${imgs.slice(0, MAX_SRCS).join(', ')}${imgs.length > MAX_SRCS ? ', …' : ''}`);
  if (!topLevelDiv) problems.push('no top-level <div>');
  return problems;
}

// ---- rows ----------------------------------------------------------------------------------------------------------

const row = (check, status, value, detail = null) => ({ check, value, bar: BAR_OF[check], status, ...(detail ? { detail } : {}) });
const errorRow = (check, code, detail) => row(check, 'ERROR', `ERROR (exit ${code})`, detail);
const counted = (r) => r.status === 0 || r.status === 1;
const readJsonFile = (file) => { try { return parseJson(readFileSync(file, 'utf8')); } catch { return null; } };
const sameOrigin = (url, origin) => { try { return new URL(url).origin === new URL(origin).origin; } catch { return false; } };

async function plainRow({ preview, token }) {
  const got = await fetchOnce(preview.plain, token, REQUEST_MS);
  if (got.status === 0 || got.status === 429 || got.status >= 500) return errorRow('.plain.html', EXIT.ERROR, got.last);
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

async function readabilityRow({ preview, token, out, tools, env }) {
  const file = join(out, 'ai-readability.json');
  const r = await callOnPreview('ai-readability', tools.readability, ['--origin', preview.origin, preview.path, '--min', String(MIN_READABILITY), '--json', file], env, { token, url: preview.url });
  const page = counted(r) ? readJsonFile(file)?.pages?.[0] : null;
  const score = page?.code?.score;
  if (!Number.isFinite(score)) {
    const said = page?.error ? redact(`${page.path}: ${page.error}`, token) : firstLine(outputOf(r, null));
    return errorRow('ai-readability', exitOf(r), said || `ai-readability exited ${exitOf(r)} without a score`);
  }
  return score < MIN_READABILITY ? row('ai-readability', 'FAIL', String(score), gapDetail(page)) : row('ai-readability', 'PASS', String(score));
}

// qa-gate runs on whatever inputs there are (its schema-free checks need neither). An input it is meant to read that is missing
// makes the row a FAIL naming the step that writes it: the preview is not accepted on a partial run, and the fix is a step to run.
async function qaRow({ preview, token, schema, design, out, tools, env }) {
  const missing = [];
  const flags = [];
  if (existsSync(schema)) flags.push('--schema', schema); else missing.push(`no eds-schema/${basename(schema)} (run deploy Step 2b)`);
  if (existsSync(design)) flags.push('--design', design); else missing.push('no design.json (run deployed-gate parity first)');
  const incomplete = missing.length ? `incomplete: ${missing.join('; ')}` : null;
  const r = await callOnPreview('qa-gate', tools.qa, [preview.url, ...flags], env, { token, url: preview.url });
  writeFileSync(join(out, 'qa-gate.txt'), r.stdout);
  const summary = r.stdout.match(/^QA GATE: (?:PASS|FAIL) — (.+)$/m)?.[1];
  if (!counted(r) || !summary) {
    const said = firstLine(outputOf(r, null)) || `qa-gate exited ${exitOf(r)} without a QA GATE line`;
    return errorRow('qa-gate', exitOf(r), incomplete ? `${said}\n${incomplete}` : said);
  }
  const fails = r.stdout.split('\n').filter((l) => /^\s*✗ /.test(l)).map((l) => l.replace(/^\s*✗ /, '').trim());
  if (incomplete) return row('qa-gate', 'FAIL', incomplete, listed([`what it measured: ${summary}`, ...fails]));
  if (r.status === 0) return row('qa-gate', 'PASS', summary);
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
  if (!sameOrigin(preview.plain, preview.origin)) {
    throw new UsageError(`preview.json plain URL is not on the preview origin (${preview.plain}, origin ${preview.origin}): the site token goes to the preview origin only; run deployed-gate preview --page ${slug} again`);
  }
  const token = previewToken('inherited', preview, auth);
  const instruments = tools ? checkTools(tools) : deployTools();
  mkdirSync(out, { recursive: true });

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
// row (its findings below), and one line for deploy's own gates.
export const inheritedLines = (result) => stepLines('inherited', result, { failure, unrun: ['by deploy'] });
