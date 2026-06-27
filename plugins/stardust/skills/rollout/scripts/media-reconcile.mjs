#!/usr/bin/env node
/**
 * rollout/media-reconcile.mjs — per-image reconciliation for migrations.
 *
 * Imagery is the #1 fidelity risk at scale. This systematizes the decision the
 * delivery gates make ad-hoc: for every authored image URL, classify origin,
 * RESOLVE it on the network, apply known repairs, and emit a decision:
 *   optimize  — same-origin (Content Bus) asset; safe to run createOptimizedPicture
 *   keep      — external, resolves 200; reference as-is but skip block optimization
 *   rewrite   — repairable break (missing ?-delimiter, wrong host) → suggested URL
 *   omit      — unresolvable; drop the <img> (render gracefully), never ship about:error
 *
 * Reference: skills/migrate/reference/media-reconciliation.md and
 * skills/rollout/reference/delivery-gates.md § Gate 2.
 *
 * Usage:
 *   node skills/rollout/scripts/media-reconcile.mjs --file <html>
 *        --deploy-host <host> [--host-rewrite badhost=goodhost] [--json] [--apply]
 *   --apply rewrites the file in place (rewrite → suggested URL, omit → remove <img>).
 */
import { readFileSync, writeFileSync } from 'node:fs';

function arg(name, fb) { const i = process.argv.indexOf(`--${name}`); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fb; }
const FILE = arg('file', null);
const DEPLOY_HOST = arg('deploy-host', null);
const JSON_OUT = process.argv.includes('--json');
const APPLY = process.argv.includes('--apply');
const rewrites = process.argv.filter((a, i) => process.argv[i - 1] === '--host-rewrite').map((s) => s.split('='));
if (!FILE) { console.error('media-reconcile: need --file <html>'); process.exit(2); }
let html = readFileSync(FILE, 'utf8');

/* collect image URLs: <img src>, srcset, inline style url(), <style> url() */
function collect(h) {
  const urls = new Set();
  for (const m of h.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) urls.add(m[1]);
  for (const m of h.matchAll(/\bsrcset="([^"]+)"/gi)) m[1].split(',').forEach((part) => { const u = part.trim().split(/\s+/)[0]; if (u) urls.add(u); });
  for (const m of h.matchAll(/url\((['"]?)(https?:\/\/[^)'"]+)\1\)/gi)) urls.add(m[2]);
  return [...urls].filter((u) => u && !u.startsWith('data:'));
}

function repairUrl(u) {
  // missing query delimiter: …/<id>&wid=… → …/<id>?wid=…
  if (!u.includes('?') && u.includes('&')) return u.replace('&', '?');
  // host rewrite (e.g. cdn.shopify.com → www.store.com)
  for (const [bad, good] of rewrites) { if (u.includes(bad)) return u.replace(bad, good); }
  return null;
}

async function resolve(u) {
  try {
    const r = await fetch(u, { method: 'GET', headers: { 'user-agent': 'stardust-media-reconcile' } });
    return r.status;
  } catch (e) { return 0; }
}

function originOf(u) { try { return new URL(u).host; } catch { return null; } }

const results = [];
for (const u of collect(html)) {
  const host = originOf(u);
  const sameOrigin = DEPLOY_HOST && host && host === DEPLOY_HOST;
  let decision; let suggested = null; let status = null;
  if (sameOrigin) {
    decision = 'optimize';
  } else {
    status = await resolve(u);
    if (status === 200) {
      decision = 'keep';
    } else {
      const fixed = repairUrl(u);
      if (fixed) {
        const fstatus = await resolve(fixed);
        if (fstatus === 200) { decision = 'rewrite'; suggested = fixed; status = fstatus; } else { decision = 'omit'; }
      } else {
        decision = 'omit';
      }
    }
  }
  results.push({ url: u, host, status, decision, suggested });
}

/* optionally apply rewrites/omits */
if (APPLY) {
  for (const r of results) {
    if (r.decision === 'rewrite' && r.suggested) {
      html = html.split(r.url).join(r.suggested);
    } else if (r.decision === 'omit') {
      // remove the whole <img …src="url"…> (and an empty wrapping <picture>)
      const imgRe = new RegExp(`<img\\b[^>]*\\bsrc="${r.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`, 'gi');
      html = html.replace(imgRe, '');
      html = html.replace(/<picture>\s*<\/picture>/gi, '');
    }
  }
  writeFileSync(FILE, html);
}

const counts = results.reduce((a, r) => { a[r.decision] = (a[r.decision] || 0) + 1; return a; }, {});
const broken = results.filter((r) => r.decision === 'omit');
if (JSON_OUT) {
  console.log(JSON.stringify({ file: FILE, deployHost: DEPLOY_HOST, applied: APPLY, counts, results }, null, 2));
} else {
  console.log(`media-reconcile ${FILE}${APPLY ? ' (APPLIED)' : ''}`);
  console.log('='.repeat(60));
  for (const r of results) {
    const tag = { optimize: '✓ optimize', keep: '✓ keep    ', rewrite: '→ rewrite ', omit: '✗ omit    ' }[r.decision];
    console.log(`  ${tag} ${r.status ? `[${r.status}] ` : ''}${r.url.slice(0, 70)}${r.suggested ? `\n              → ${r.suggested.slice(0, 70)}` : ''}`);
  }
  console.log(`\n${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
}
process.exit(broken.length ? 1 : 0);
