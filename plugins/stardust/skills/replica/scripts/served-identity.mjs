#!/usr/bin/env node
/**
 * skills/replica/scripts/served-identity.mjs — "is this localhost URL ours?"
 *
 * The one identity check every gate that consumes a localhost URL runs BEFORE
 * measuring (gate.sh has its own curl form; browser gates — deploy's qa-gate,
 * section-schema URL mode — import this). Order:
 *   1. `<origin>/.stardust-marker.txt`             — serve.mjs (synthetic)
 *   2. `<origin>/stardust/.work/harness/marker.txt` — a harness served statically by the dev server
 *   3. the page body contains the marker (case-insensitive)
 *   4. the page body contains one of `fallbackNames` (the schema's block names)
 * Anything else is a mismatch: code 4 — NO VERDICT, never a FAIL (the same
 * class as gate.sh's exit 4 and run-capped's 124): the server on that port is
 * another project's, or nothing answers. There is no flag that turns a
 * mismatch into a pass.
 *
 * Usage:
 *   node skills/replica/scripts/served-identity.mjs <url> --marker <s> [--names a,b,…] [--timeout <ms>] [--json]
 * Exit codes: 0 identity confirmed (prints how), 4 mismatch / no answer — no verdict, 1 usage error.
 *
 * Importable: assertServedIdentity(url, marker, { fallbackNames, timeoutMs }) → { via, origin }
 *   throws Error with .code = 4 on mismatch.
 */
/* eslint-disable no-restricted-syntax, brace-style, object-curly-newline, max-len, no-plusplus */
import { realpathSync } from 'fs';
import { pathToFileURL } from 'url';

export const MARKER_PATHS = ['/.stardust-marker.txt', '/stardust/.work/harness/marker.txt'];

const HELP = `served-identity — assert the localhost URL serves THIS project's page before any gate reads it

Usage: node served-identity.mjs <url> --marker <s> [--names a,b] [--timeout <ms>] [--json]
Exit codes: 0 confirmed, 4 mismatch or no answer (no verdict), 1 usage error.`;

async function fetchText(url, timeoutMs) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try { const r = await fetch(url, { signal: ctl.signal, redirect: 'follow' }); return { status: r.status, body: r.ok ? await r.text() : '' }; }
  catch (e) { return { status: 0, body: '', error: String(e.message || e).split('\n')[0] }; }
  finally { clearTimeout(t); }
}

export async function assertServedIdentity(url, marker, { fallbackNames = [], timeoutMs = 10000 } = {}) {
  if (!url || !marker) throw Object.assign(new Error('assertServedIdentity needs a url and a marker'), { code: 1 });
  const origin = new URL(url).origin;
  const want = String(marker).trim().toLowerCase();
  for (const p of MARKER_PATHS) {
    const r = await fetchText(origin + p, timeoutMs);
    if (r.status === 200 && r.body.trim()) {
      if (r.body.trim().toLowerCase() === want) return { via: `marker-file ${p}`, origin };
      throw Object.assign(new Error(`identity — ${origin}${p} answers "${r.body.trim().slice(0, 60)}", expected "${marker}": another project's server on this port — not scoring (no verdict). Never kill it: port.mjs allocates the next slot`), { code: 4, origin, served: r.body.trim().slice(0, 60) });
    }
  }
  const page = await fetchText(url, timeoutMs);
  if (page.status === 0 || page.status >= 400) throw Object.assign(new Error(`identity — ${url} did not answer (${page.error || `HTTP ${page.status}`}): nothing to score (no verdict)`), { code: 4, origin });
  const body = page.body.toLowerCase();
  if (body.includes(want)) return { via: 'page-body', origin };
  const hit = fallbackNames.find((n) => n && body.includes(String(n).toLowerCase()));
  if (hit) return { via: `block-name "${hit}"`, origin };
  throw Object.assign(new Error(`identity — ${url} serves a page without "${marker}"${fallbackNames.length ? ` or any of ${fallbackNames.slice(0, 5).join(', ')}` : ''}: another project's server on this port — not scoring (no verdict). Never kill it: port.mjs allocates the next slot`), { code: 4, origin });
}

async function main() {
  const rest = process.argv.slice(2);
  if (!rest.length || rest.includes('--help') || rest.includes('-h')) { console.log(HELP); process.exit(rest.length ? 0 : 1); }
  const o = { url: null, marker: null, names: [], timeoutMs: 10000, json: false };
  const need = (flag, i) => { if (rest[i] === undefined || rest[i].startsWith('--')) { console.error(`${flag} needs a value\n\n${HELP}`); process.exit(1); } return rest[i]; };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--marker') o.marker = need(a, ++i);
    else if (a === '--names') o.names = need(a, ++i).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--timeout') o.timeoutMs = Number(need(a, ++i)) || 10000;
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--')) { console.error(`unknown flag ${a}\n\n${HELP}`); process.exit(1); }
    else o.url = a;
  }
  if (!o.url || !o.marker) { console.error(`need <url> and --marker <s>\n\n${HELP}`); process.exit(1); }
  try {
    const r = await assertServedIdentity(o.url, o.marker, { fallbackNames: o.names, timeoutMs: o.timeoutMs });
    if (o.json) console.log(JSON.stringify({ ok: true, ...r })); else console.log(`served-identity: ${o.url} is ours (via ${r.via})`);
  } catch (e) {
    if (o.json) console.log(JSON.stringify({ ok: false, code: e.code || 1, error: e.message }));
    console.error(`served-identity: ${e.message}`);
    process.exit(e.code || 1);
  }
}

const isMain = (() => { try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; } })();
if (isMain) main();
