#!/usr/bin/env node
/**
 * validate-page.mjs — offline schema gate over stardust/current/pages/*.json.
 *
 * Purpose: the per-page record contract (extract/reference/current-state-schema.md
 *   § Required vs optional · § Live-render evidence) is checked by code, not by
 *   reading. crawl.mjs runs the same check (validateRecord) on every record it
 *   writes; this CLI re-runs it over a directory so Phase 6 (state-update.mjs)
 *   and a reviewer see the same verdict. Offline: reads files, hits nothing.
 *
 * Usage:
 *   node validate-page.mjs [--dir stardust/current/pages | --file <record.json>]
 *                          [--legacy] [--json] [--quiet]
 *   node validate-page.mjs --help
 *
 *   --dir <d>    directory of <slug>.json records (default stardust/current/pages)
 *   --file <f>   one record instead of a directory (repeatable)
 *   --legacy     admit records written before schemaVersion 2 (pre-0.24 projects
 *                re-opened for a --refresh): absent schema-2 keys WARN instead of
 *                FAIL. Deliberately NO hatch for the provenance fields.
 *   --json       machine output: { ok, records: [{ slug, file, ok, fail[], warn[] }] }
 *   --quiet      print only FAIL lines and the summary
 *
 * Exit codes:
 *   0  every record passes (WARNs may be present — they never fail)
 *   1  at least one record FAILs (a required key or provenance field is absent,
 *      renderedBy is not "playwright", schemaVersion missing or newer than this
 *      validator) — the missing keys are listed per slug
 *   2  usage error / no records found
 *
 * Gate contract (SKILL.md § Phase 2): a FAIL blocks marking the page `extracted`
 *   in state.json; the record stays on disk (the DOM sidecar is still evidence)
 *   and crawl.mjs lists it in _crawl-log.json#crawl.failures as SchemaError.
 *   Hands-off: re-crawl the slug once (`--refresh <slug>`); a second FAIL is an
 *   instrument regression — append `event: "blocked"` naming the keys and stop
 *   that page; never mark it `extracted`. Nothing here can time out (no verdict
 *   on timeout is the live instruments' contract, not this one's).
 *
 * Imports validateRecord from ./crawl.mjs — copy the extract scripts into
 * stardust/scripts/ as a set (SKILL § Setup 1). Importing crawl.mjs runs nothing.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { validateRecord, SCHEMA_VERSION } from './crawl.mjs';

function parseArgs(argv) {
  const a = { dir: null, files: [], legacy: false, json: false, quiet: false, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    const val = () => { const v = argv[i + 1]; if (v === undefined || /^--/.test(v)) throw new Error(`${k} needs a value`); i += 1; return v; };
    if (k === '--help' || k === '-h') a.help = true;
    else if (k === '--dir') a.dir = val();
    else if (k === '--file') a.files.push(val());
    else if (k === '--legacy') a.legacy = true;
    else if (k === '--json') a.json = true;
    else if (k === '--quiet') a.quiet = true;
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!a.files.length && !a.dir) a.dir = 'stardust/current/pages';
  return a;
}

function printHelp() {
  const src = readFileSync(new URL(import.meta.url), 'utf8');
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  console.log(m ? m[1].split('\n').map((l) => l.replace(/^ \* ?/, '')).join('\n').trim() : 'validate-page.mjs');
}

/** validate a list of record files → { ok, records[] } (pure over the file contents) */
export function validateFiles(files, { legacy = false } = {}) {
  const records = files.map((file) => {
    let rec;
    try { rec = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { slug: basename(file, '.json'), file, ok: false, fail: [`unreadable: ${e.message}`], warn: [] }; }
    const r = validateRecord(rec, { legacy });
    return { slug: rec.slug || basename(file, '.json'), file, ok: r.ok, fail: r.fail, warn: r.warn };
  });
  return { ok: records.every((r) => r.ok), records };
}

function main() {
  let args;
  try { args = parseArgs(process.argv); } catch (e) { console.error(`validate-page: ${e.message}`); process.exit(2); }
  if (args.help) { printHelp(); return; }
  let files = [...args.files];
  if (args.dir) {
    if (!existsSync(args.dir) || !statSync(args.dir).isDirectory()) { console.error(`validate-page: ${args.dir} is not a directory`); process.exit(2); }
    files.push(...readdirSync(args.dir).filter((f) => f.endsWith('.json')).sort().map((f) => join(args.dir, f)));
  }
  files = [...new Set(files)];
  if (!files.length) { console.error(`validate-page: no records under ${args.dir || args.files.join(', ')}`); process.exit(2); }
  const out = validateFiles(files, { legacy: args.legacy });
  if (args.json) { console.log(JSON.stringify({ ok: out.ok, schemaVersion: SCHEMA_VERSION, legacy: args.legacy, records: out.records }, null, 2)); process.exit(out.ok ? 0 : 1); }
  for (const r of out.records) {
    if (!r.ok) console.log(`FAIL ${r.slug}  missing ${r.fail.join(', ')}`);
    else if (!args.quiet) console.log(`${r.warn.length ? 'WARN' : 'ok  '} ${r.slug}${r.warn.length ? `  ${r.warn.join('; ')}` : ''}`);
  }
  const failed = out.records.filter((r) => !r.ok).length;
  const warned = out.records.filter((r) => r.ok && r.warn.length).length;
  console.log(`validate-page: ${out.records.length} record(s), ${failed} FAIL, ${warned} WARN (schema ${SCHEMA_VERSION}${args.legacy ? ', --legacy' : ''})`);
  process.exit(out.ok ? 0 : 1);
}

if (process.argv[1] && /validate-page\.mjs$/.test(process.argv[1])) main();
