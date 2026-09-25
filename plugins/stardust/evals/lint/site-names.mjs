// Guard: the stardust plugin source names no site.
//
// Skill text, scripts, tests, fixtures, evals, CHANGELOG and notes are site-agnostic: field evidence
// is anonymised ("a commerce home page"), hostnames and site-identifying selectors become
// placeholders (`<site>`, `main > div.<cms-list>`). A named site leaks a customer, dates the rule to
// one migration, and tempts the next run to pattern-match on the wrong thing.
//
// What it does: every tracked text file under plugins/stardust (git ls-files; a plain walk when git
// is unavailable) is scanned for domain-like tokens — `host.tld` with a real TLD. In Markdown the
// scan skips fenced code blocks (they hold variable access such as `opts.page` and per-site
// examples the surrounding prose already anonymises) and reads prose and inline code; in code files
// (.mjs/.js/.sh) only `http(s)://` URLs count (property access is not a hostname). A token passes
// when it matches the allowlist below — say why on the line when you add one. Anything else is a
// finding: `<file>:<line>: <host>`.
//
// Usage: node plugins/stardust/evals/lint/site-names.mjs  (exit 1 on findings)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(HERE, '..', '..');
const REPO = resolve(PLUGIN, '..', '..');

// Hosts that are not a site under migration. Suffix match: `x.example.com` passes with `example.com`.
const ALLOW = [
  // placeholders and reserved names used in examples
  'example.com', 'example.org', 'example.net', 'example.co', 'brand.com', 'store.com', 'vendor.com', 'site.com',
  // delivery and authoring infrastructure the skills drive
  'adobe.com', 'aem.live', 'aem.page', 'hlx.live', 'hlx.page', 'da.live', 'adobeaemcloud.com',
  // source hosting, packages, CDNs, specs
  'github.com', 'githubusercontent.com', 'github.io', 'npmjs.org', 'npmjs.com', 'jsdelivr.net', 'unpkg.com',
  'schema.org', 'json-schema.org', 'sitemaps.org', 'w3.org', 'googleapis.com', 'gstatic.com', 'fontsource.org',
  'opencollective.com', 'claude.com', 'anthropic.com', 'coolors.co', 'refero.design',
  // the plugin's own schema $id namespace, and a state.json field path (`site.da.org`) that reads like a host
  'stardust.dev', 'da.org',
  // crawler user-agent patterns the AI-readability gate replays
  'openai.com', 'perplexity.ai',
  // platforms and embeds named as DETECTION PATTERNS (dynamics / schema docs), not as sites
  'youtube.com', 'youtu.be', 'vimeo.com', 'x.com', 'twitter.com', 'linkedin.com', 'facebook.com', 'instagram.com',
  'google.com', 'shopify.com', 'linear.app', 'datawrapper.de', 'cloudflarestream.com', 'edgesuite.net',
  'akamaized.net', 'cloudfront.net', 'wp.com', 'hubspot.com', 'typeform.com', 'calendly.com',
];
// Synthetic or runner-pinned eval sites — allowed under evals/ only.
const EVAL_ALLOW = ['ledgerline.com', 'stripe.com'];

const TLDS = 'com|net|org|io|dev|co|uk|de|fr|it|es|nl|be|eu|app|ai|live|page|tv|me|us|info|biz|shop|store|ca|au|ch|at|jp|cn|in|br';
const HOST = new RegExp(`(?<![\\w.@$-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS}))(?![\\w-])`, 'gi');
const URL_HOST = new RegExp(`https?://((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS}))(?![\\w-])`, 'gi');
const TEXT_EXT = /\.(md|mjs|js|sh|json|yaml|yml|html|txt|csv|tsv)$/i;

function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', 'plugins/stardust'], { cwd: REPO, encoding: 'utf8' });
    const files = out.split('\0').filter(Boolean).map((f) => resolve(REPO, f));
    if (files.length) return files;
  } catch { /* no git: walk */ }
  const acc = [];
  const walk = (d) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n.startsWith('.')) continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else acc.push(p); } };
  walk(PLUGIN);
  return acc;
}

const allowed = (host, file) => {
  const h = host.toLowerCase();
  const list = file.includes(`${PLUGIN}/evals/`) ? [...ALLOW, ...EVAL_ALLOW] : ALLOW;
  return list.some((a) => h === a || h.endsWith(`.${a}`));
};

const findings = [];
let scanned = 0;
for (const file of trackedFiles()) {
  if (!TEXT_EXT.test(file) || file === fileURLToPath(import.meta.url)) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  scanned += 1;
  const md = /\.md$/i.test(file);
  const code = /\.(mjs|js|sh)$/i.test(file);
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (md && /^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
    if (md && fenced) return;
    const re = code ? URL_HOST : HOST;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const host = m[1];
      if (/^\d+(\.\d+)+$/.test(host)) continue; // a version number such as 1.2.3.co is not a host (rare, but free)
      if (allowed(host, file)) continue;
      findings.push(`${relative(REPO, file)}:${i + 1}: ${host}`);
    }
  });
}

if (findings.length) {
  for (const f of findings) console.log(f);
  console.log(`site-names lint: ${findings.length} finding(s) in ${scanned} files — anonymise (a placeholder or a role name), or allowlist with a reason if it is infrastructure or a detection pattern`);
  process.exit(1);
}
console.log(`site-names lint: ${scanned} files, no site named`);
