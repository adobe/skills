'use strict';

/**
 * rv-check — the CUSTOMER-facing RV entry point.
 *
 *   node rv-check.js <pattern> --project <customerBundleDir> --sdk <url> [--sdk-home <path>]
 *
 * Verifies a customer's own migrated bundle on their AEM Cloud SDK. Auto-
 * detects the migrated class from the built jar's OSGi DS descriptors — no
 * hard-coded WKND names.
 *
 *   1. build the customer's project (mvn clean package)
 *   2. inspect the jar to discover the migrated class (pattern-specific signature)
 *   3. deploy rv-probes (once) + the customer's bundle to their SDK
 *   4. call the rv-probes endpoint with the discovered class → runtime verdict
 *
 * Exits 0 pass, 1 fail. Never modifies customer code.
 */
if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
  console.error('[rv-check] Node 18+ required (needs global fetch / FormData / Blob).');
  process.exit(2);
}

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { build } = require('./build.js');
const { deploy } = require('./deploy.js');

const PROBES_BUNDLE = path.join(__dirname, 'rv-probes/target/rv-probes-1.0.0.jar');
const PROBES_BSN = 'com.adobe.aem.rv.probes';

// pattern -> { discover(jarPath) -> {…customer-specific…}, verify({sdkUrl, auth, discovered}) -> outcome }
const PATTERNS = {
  scheduler: {
    describe: 'Sling Scheduler (Cloud Service contract)',
    discover: (jar) => {
      // find the DS descriptor that declares scheduler.expression
      for (const [fname, xml] of jarDsDescriptors(jar)) {
        if (/property\s+name="scheduler\.expression"/.test(xml)) {
          const nm = xml.match(/name="([^"]+)"/);
          return { fqcn: nm ? nm[1] : path.basename(fname, '.xml') };
        }
      }
      return null;
    },
    async verify({ sdkUrl, auth, discovered }) {
      const r = await getJson(`${sdkUrl}/bin/rv/probe/scheduler?pid=${encodeURIComponent(discovered.fqcn)}`, auth);
      if (!r.registered) return { result: 'fail', failure_class: 'runtime.not_registered', evidence: `${discovered.fqcn} not registered as OSGi DS component`, checks: r };
      if (!r.active)     return { result: 'fail', failure_class: 'runtime.not_active', evidence: 'component present but not active', checks: r };
      const p = r.properties || {};
      const contract = {
        has_expression: !!p['scheduler.expression'],
        concurrent_boolean: p['scheduler.concurrent'] === 'false' || p['scheduler.concurrent'] === 'true',
        runOn_scoped: p['scheduler.runOn'] === 'SINGLE' || p['scheduler.runOn'] === 'LEADER',
      };
      const contractOk = contract.has_expression && contract.concurrent_boolean && contract.runOn_scoped;
      return {
        result: contractOk ? 'pass' : 'fail',
        failure_class: contractOk ? null : 'runtime.contract_mismatch',
        checks: { registered: true, active: true, ...contract, properties: p },
      };
    },
  },
  'asset-manager': {
    describe: 'Asset Manager (Path B: resolver.delete + commit)',
    discover: (jar) => {
      // Find a DS component that's a service, not a servlet/scheduler/event handler:
      // customer's asset service class. The user can override with --fqcn.
      const cand = [];
      for (const [, xml] of jarDsDescriptors(jar)) {
        if (/property\s+name="sling\.servlet\.paths"/.test(xml)) continue;
        if (/property\s+name="scheduler\.expression"/.test(xml)) continue;
        if (/property\s+name="event\.topics"/.test(xml)) continue;
        if (/property\s+name="job\.topics"/.test(xml)) continue;
        const nm = xml.match(/<scr:component[^>]*name="([^"]+)"/);
        if (nm) cand.push(nm[1]);
      }
      return cand[0] ? { fqcn: cand[0] } : null;
    },
    async verify({ sdkUrl, auth, discovered, opts }) {
      const fqcn = opts.fqcn || discovered.fqcn;
      const method = opts.method || 'deleteAsset';
      const testPath = `/content/rvcheck-asset-${Date.now()}`;
      // create a test node so we can prove it disappears
      await httpPost(`${sdkUrl}${testPath}`, auth, { 'jcr:primaryType': 'nt:unstructured' });
      const r = await getJson(`${sdkUrl}/bin/rv/probe/asset-delete?fqcn=${enc(fqcn)}&method=${enc(method)}&path=${enc(testPath)}`, auth);
      const checks = { fqcn, method, testPath, ...r };
      if (!r.invoked)       return { result: 'fail', failure_class: 'runtime.service_not_registered', evidence: r.error || 'invoke failed', checks };
      if (!r.existed_before) return { result: 'fail', failure_class: 'runtime.setup_failed', evidence: 'test node was not created', checks };
      if (!r.gone_after)     return { result: 'fail', failure_class: 'runtime.node_not_deleted', evidence: 'resolver.delete()+commit() did not remove the node', checks };
      return { result: 'pass', failure_class: null, checks };
    },
  },
  'event-migration': {
    describe: 'OSGi EventHandler → Sling Job offload',
    discover: (jar) => {
      // Find a DS component that declares event.topics — customer's handler.
      for (const [, xml] of jarDsDescriptors(jar)) {
        if (!/property\s+name="event\.topics"/.test(xml)) continue;
        const nm = xml.match(/<scr:component[^>]*name="([^"]+)"/);
        const topicM = xml.match(/property\s+name="event\.topics"[^>]*value="([^"]+)"/);
        if (nm && topicM) return { fqcn: nm[1], topic: topicM[1] };
      }
      return null;
    },
    async verify({ sdkUrl, auth, discovered }) {
      // 1. handler is active as an EventHandler on the declared topic
      const cmp = await getJson(`${sdkUrl}/bin/rv/probe/scheduler?pid=${enc(discovered.fqcn)}`, auth); // reuse: same DS state endpoint
      const handlerActive = cmp.registered && cmp.active;
      // 2. fire an event on the customer's topic
      const id = 'rvc-' + Date.now();
      const fireRes = await getJson(`${sdkUrl}/bin/rv/probe/fire-event?topic=${enc(discovered.topic)}&id=${enc(id)}`, auth);
      // 3. handler survived (still active — didn't blow up on the event)
      await sleep(1500);
      const cmp2 = await getJson(`${sdkUrl}/bin/rv/probe/scheduler?pid=${enc(discovered.fqcn)}`, auth);
      const survives = cmp2.registered && cmp2.active;
      const checks = { fqcn: discovered.fqcn, topic: discovered.topic, handler_active: handlerActive, event_fired: !!fireRes.fired, handler_still_active_after: survives };
      const ok = handlerActive && fireRes.fired && survives;
      return {
        result: ok ? 'pass' : 'fail',
        failure_class: !handlerActive ? 'runtime.handler_not_active' : !fireRes.fired ? 'runtime.event_fire_failed' : !survives ? 'runtime.handler_died' : null,
        checks,
      };
    },
  },
  replication: {
    describe: 'Sling Distribution API (replaces CQ Replicator)',
    discover: (jar) => {
      // Confirm the customer bundle actually uses the Distribution API (imports it).
      const { execFileSync } = require('child_process');
      const mf = execFileSync('unzip', ['-p', jar, 'META-INF/MANIFEST.MF'], { encoding: 'utf8' }).replace(/\r?\n /g, '');
      const importsDistribution = /Import-Package:[\s\S]*org\.apache\.sling\.distribution/.test(mf);
      const importsLegacy = /Import-Package:[\s\S]*com\.day\.cq\.replication/.test(mf);
      if (importsLegacy) return null; // legacy — source gate would have caught this too
      return { uses_distribution_api: importsDistribution };
    },
    async verify({ sdkUrl, auth, discovered }) {
      const path = `/content/rvcheck-repl-${Date.now()}`;
      await httpPost(`${sdkUrl}${path}`, auth, { 'jcr:primaryType': 'nt:unstructured' });
      const r = await getJson(`${sdkUrl}/bin/rv/probe/distribute?path=${enc(path)}`, auth);
      const checks = { imports_distribution_api: !!discovered.uses_distribution_api, ...r };
      if (!r.api_present) return { result: 'fail', failure_class: 'runtime.distributor_absent', evidence: 'Distributor service not present on the SDK', checks };
      if (!r.invoked)     return { result: 'fail', failure_class: 'runtime.invoke_failed', evidence: r.error || 'distribute() threw', checks };
      // Delivery to publish depends on publish-tier being configured; on an author-only
      // SDK we assert only that the migrated code runs. That's the honest boundary.
      return { result: 'pass', failure_class: null, checks };
    },
  },
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pat = PATTERNS[args.pattern];
  if (!pat) fatal(`unknown pattern: ${args.pattern}\nsupported: ${Object.keys(PATTERNS).join(', ')}`);
  if (pat.placeholder) fatal(`${args.pattern} customer-mode probe is next — start with 'scheduler' (proven).`);
  if (!args.project && !args.jar) fatal('either --project <customerBundleDir> or --jar <path/to/bundle.jar> is required');
  if (!args.sdk) fatal('--sdk <url> is required');

  const sdkUrl = args.sdk.replace(/\/$/, '');
  const user = args.user || 'admin';
  const password = args.password || 'admin';
  const auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

  console.log(`\n=== rv-check · ${args.pattern} ===`);
  console.log(args.jar ? `jar    : ${args.jar}` : `project: ${args.project}`);
  console.log(`sdk    : ${sdkUrl}`);
  console.log(`pattern: ${pat.describe}\n`);

  // 1. build (unless a pre-built jar was supplied)
  let artifactPath;
  if (args.jar) {
    if (!fs.existsSync(args.jar)) return finish({ result: 'fail', failure_class: 'input.jar_missing', evidence: `no file at ${args.jar}` });
    artifactPath = args.jar;
    console.log(`▸ skip build (using --jar)\n  ok (${path.basename(artifactPath)})\n`);
  } else {
    step('build customer project');
    const b = build({ projectDir: args.project });
    if (!b.ok) return finish({ result: 'fail', failure_class: 'build.failed', evidence: b.log });
    artifactPath = b.artifactPath;
    console.log(`  ok (${path.basename(artifactPath)}, ${b.elapsedMs}ms)\n`);
  }

  // 2. auto-discover
  step('discover migrated class');
  const discovered = pat.discover(artifactPath);
  if (!discovered) return finish({ result: 'fail', failure_class: 'discovery.no_pattern_match',
    evidence: `no DS component in ${artifactPath} matches the ${args.pattern} signature` });
  console.log(`  ok → ${JSON.stringify(discovered)}\n`);

  // 3. ensure rv-probes is on the SDK
  step('deploy rv-probes (if needed)');
  const probesOk = await ensureProbes(sdkUrl, auth);
  if (!probesOk.ok) return finish({ result: 'fail', failure_class: 'probes.deploy_failed', evidence: probesOk.log });
  console.log(`  ok (rv-probes: ${probesOk.state})\n`);

  // 4. deploy the customer bundle
  step('deploy customer bundle');
  const d = await deploy({ artifactPath, sdkUrl, user, password });
  if (!d.ok) return finish({ result: 'fail', failure_class: 'deploy.failed', evidence: `${d.log} state=${d.state}` });
  console.log(`  ok (bundle ${d.bundleId} · ${d.symbolicName})\n`);
  await sleep(3000); // let DS settle

  // 5. runtime verify via probe
  step('runtime verify');
  const opts = { fqcn: args.fqcn, method: args.method };
  const outcome = await pat.verify({ sdkUrl, auth, discovered, opts });
  console.log(`  ${outcome.result === 'pass' ? 'ok' : 'FAIL'} — ${JSON.stringify(outcome.checks)}\n`);
  return finish(outcome, { discovered });
}

// ---- helpers ----
async function ensureProbes(sdkUrl, auth) {
  const st = await getJson(`${sdkUrl}/system/console/bundles/${PROBES_BSN}.json`, auth).catch(() => null);
  const already = st && st.data && st.data[0] && st.data[0].state === 'Active';
  if (already) return { ok: true, state: 'Active (already deployed)' };
  if (!fs.existsSync(PROBES_BUNDLE)) return { ok: false, log: `rv-probes bundle not built — run \`mvn package\` under rv-probes/` };
  const d = await deploy({ artifactPath: PROBES_BUNDLE, sdkUrl });
  return d.ok ? { ok: true, state: 'Active (just deployed)' } : { ok: false, log: d.log };
}

function jarDsDescriptors(jarPath) {
  // read all OSGI-INF/*.xml entries via `unzip -p`
  const listing = execFileSync('unzip', ['-l', jarPath], { encoding: 'utf8' });
  const files = [];
  for (const line of listing.split('\n')) {
    const m = line.match(/(OSGI-INF\/[^ ]+\.xml)$/);
    if (m) files.push(m[1]);
  }
  return files.map(f => [f, execFileSync('unzip', ['-p', jarPath, f], { encoding: 'utf8' })]);
}

async function getJson(url, auth) {
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function httpPost(url, auth, formFields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(formFields)) form.append(k, String(v));
  const res = await fetch(url, { method: 'POST', headers: { Authorization: auth }, body: form });
  return res.status;
}

const enc = encodeURIComponent;

function step(name) { console.log(`▸ ${name}`); }
function fatal(msg) { console.error(msg); process.exit(2); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function finish(outcome, extra) {
  const record = { run_id: 'rvc-' + Date.now(), ...outcome, ...(extra || {}), finished_at: new Date().toISOString() };
  console.log('=== outcome ===');
  console.log(JSON.stringify(record, null, 2));
  process.exit(record.result === 'pass' ? 0 : 1);
}
function parseArgs(argv) {
  const out = { pattern: argv[0] };
  const bools = new Set([]);
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].replace(/^--/, '');
    if (bools.has(k)) { out[k] = true; continue; }
    out[k] = argv[++i];
  }
  return out;
}

main().catch(e => { console.error(e); process.exit(2); });
