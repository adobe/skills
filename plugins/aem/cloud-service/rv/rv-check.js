#!/usr/bin/env node
'use strict';

/**
 * rv-check — verify one migrated pattern on the customer's local Cloud SDK.
 *
 *   rv-check <pattern>                       (all flags auto-resolved)
 *   rv-check <pattern> --finding <id> --project-id <pid> --project <dir>
 *
 * Auto-resolves from state on disk:
 *   ~/.rv/setup.json          — sdkUrl, user, password (written by `rv init`)
 *   <cwd>/.rv/context.json    — projectId, pendingFindings (written by analyze)
 *   <cwd>/pom.xml             — used as project root when --project omitted
 *
 * Pipeline: build → discover class → deploy → verify → emit outcome via MCP.
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
const { FAILURE_CLASSES } = require('./failure-classes.js');

// Each pattern entry defines how to find its migrated class in a built jar
// (`discover`) and how to check the runtime contract on the SDK (`verify`).
const PATTERNS = {
  scheduler: {
    describe: 'Sling Scheduler (Cloud Service contract)',
    discover: (jar, args) => {
      // If the caller pinned a class, take it verbatim.
      if (args && args.fqcn) return { fqcn: args.fqcn };
      // Otherwise match any DS descriptor with scheduler.expression. Prefer the
      // one that ALSO declares scheduler.runOn (the migrated one).
      const candidates = [];
      for (const [fname, xml] of jarDsDescriptors(jar)) {
        if (!/property\s+name="scheduler\.expression"/.test(xml)) continue;
        const nm = xml.match(/<scr:component[^>]*name="([^"]+)"/) || xml.match(/name="([^"]+)"/);
        const hasRunOn = /property\s+name="scheduler\.runOn"/.test(xml);
        candidates.push({ fqcn: nm ? nm[1] : path.basename(fname, '.xml'), hasRunOn });
      }
      if (candidates.length === 0) return null;
      const migrated = candidates.find((c) => c.hasRunOn);
      if (!migrated && candidates.length > 1) {
        console.log(`  note: ${candidates.length} scheduler classes in jar, none declare scheduler.runOn; picking ${candidates[0].fqcn} — pass --fqcn to override`);
      }
      return { fqcn: (migrated || candidates[0]).fqcn };
    },
    async verify({ sdkUrl, auth, bundleBSN, discovered }) {
      const fqcn = discovered.fqcn;

      // 1. bundle state
      const bundleJson = await getJson(`${sdkUrl}/system/console/bundles/${enc(bundleBSN)}.json`, auth).catch(() => null);
      const bundle = bundleJson && bundleJson.data && bundleJson.data[0];
      const bundle_state = bundle ? bundle.state : 'Unknown';
      if (!bundle) {
        return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_INSTALLED, bundle_state, component_state: 'Unknown', evidence: `bundle ${bundleBSN} not found on SDK` };
      }
      if (bundle_state !== 'Active') {
        return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_ACTIVE, bundle_state, component_state: 'Unknown', evidence: `bundle state=${bundle_state}` };
      }

      // 2. component state + properties
      const compJson = await getJson(`${sdkUrl}/system/console/components/${enc(fqcn)}.json`, auth).catch(() => null);
      const comp = compJson && compJson.data && compJson.data[0];
      if (!comp) {
        return { result: 'fail', failure_class: FAILURE_CLASSES.COMPONENT_UNSATISFIED, bundle_state, component_state: 'Unknown', evidence: `component ${fqcn} not registered as OSGi DS` };
      }
      const component_state = String(comp.state || 'Unknown').toLowerCase();
      const unsatisfied = (comp.unsatisfiedReferences || []).map((r) => r.name || r);

      if (component_state !== 'active') {
        const failure_class = unsatisfied.length > 0 ? FAILURE_CLASSES.COMPONENT_UNSATISFIED : FAILURE_CLASSES.ACTIVATION_ERROR;
        return {
          result: 'fail',
          failure_class,
          bundle_state,
          component_state: capitalize(component_state),
          unsatisfied_references: unsatisfied,
          activation_error: comp.error || comp.activationException || null,
          evidence: `component_state=${component_state}${unsatisfied.length ? ' refs=' + unsatisfied.join(',') : ''}`,
        };
      }

      // 3. Cloud Service contract on properties
      const props = extractProps(comp);
      const contract = {
        has_expression: !!props['scheduler.expression'],
        concurrent_boolean: props['scheduler.concurrent'] === 'false' || props['scheduler.concurrent'] === 'true' || props['scheduler.concurrent'] === false || props['scheduler.concurrent'] === true,
        runOn_scoped: props['scheduler.runOn'] === 'SINGLE' || props['scheduler.runOn'] === 'LEADER',
      };
      const contractOk = contract.has_expression && contract.concurrent_boolean && contract.runOn_scoped;

      if (!contractOk) {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
          bundle_state,
          component_state: 'Active',
          checks: { ...contract, properties: props },
          evidence: `contract mismatch: ${JSON.stringify(contract)}`,
        };
      }

      return {
        result: 'pass',
        bundle_state,
        component_state: 'Active',
        checks: { ...contract, properties: props },
      };
    },
  },

  'asset-manager': {
    describe: 'AssetManager → ResourceResolver (Cloud Service asset ops)',
    discover: (jar, args) => {
      // Legacy code imports com.day.cq.dam.api.AssetManager. Migrated code
      // uses ResourceResolver.delete/adaptTo(Asset.class) via the resolver
      // factory. Discovery = the bundle-level manifest check + any DS
      // component with `sling.resource.type` or a service that references
      // ResourceResolverFactory. If the caller pinned a class, take it.
      if (args && args.fqcn) return { fqcn: args.fqcn };
      for (const [fname, xml] of jarDsDescriptors(jar)) {
        if (!/reference\s+[^>]*interface="org\.apache\.sling\.api\.resource\.ResourceResolverFactory"/.test(xml)) continue;
        const nm = xml.match(/<scr:component[^>]*name="([^"]+)"/) || xml.match(/name="([^"]+)"/);
        if (nm) return { fqcn: nm[1] };
      }
      return null;
    },
    async verify({ sdkUrl, auth, bundleBSN, discovered }) {
      const bundleJson = await getJson(`${sdkUrl}/system/console/bundles/${enc(bundleBSN)}.json`, auth).catch(() => null);
      const bundle = bundleJson && bundleJson.data && bundleJson.data[0];
      if (!bundle) return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_INSTALLED, bundle_state: 'Unknown', component_state: 'Unknown', evidence: `bundle ${bundleBSN} not on SDK` };
      if (bundle.state !== 'Active') return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_ACTIVE, bundle_state: bundle.state, component_state: 'Unknown', evidence: `bundle state=${bundle.state}` };

      // Legacy DAM API imports would show in Import-Package on the manifest.
      // Felix's bundle detail includes the manifest headers.
      const imports = String(bundle.props?.find?.((p) => p?.key === 'Imported Packages')?.value || bundleJson?.data?.[0]?.props?.find?.((p) => p?.key === 'Imported Packages')?.value || '');
      const importsLegacyDam = /com\.day\.cq\.dam\.api\.AssetManager/.test(imports);

      const compJson = await getJson(`${sdkUrl}/system/console/components/${enc(discovered.fqcn)}.json`, auth).catch(() => null);
      const comp = compJson && compJson.data && compJson.data[0];
      const compState = comp ? String(comp.state || 'Unknown').toLowerCase() : 'unknown';
      const unsatisfied = comp ? (comp.unsatisfiedReferences || []).map((r) => r.name || r) : [];

      if (!comp) return { result: 'fail', failure_class: FAILURE_CLASSES.COMPONENT_UNSATISFIED, bundle_state: 'Active', component_state: 'Unknown', evidence: `component ${discovered.fqcn} not registered as OSGi DS` };
      if (compState !== 'active') {
        return {
          result: 'fail',
          failure_class: unsatisfied.length ? FAILURE_CLASSES.COMPONENT_UNSATISFIED : FAILURE_CLASSES.ACTIVATION_ERROR,
          bundle_state: 'Active', component_state: capitalize(compState),
          unsatisfied_references: unsatisfied,
          activation_error: comp.error || comp.activationException || null,
          evidence: `component_state=${compState}`,
        };
      }

      if (importsLegacyDam) {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
          bundle_state: 'Active', component_state: 'Active',
          evidence: 'bundle still imports com.day.cq.dam.api.AssetManager — migration incomplete',
        };
      }

      return { result: 'pass', bundle_state: 'Active', component_state: 'Active', checks: { imports_legacy_dam: false } };
    },
  },

  'event-migration': {
    describe: 'OSGi EventHandler → Sling JobConsumer',
    discover: (jar, args) => {
      // Migrated code declares a JobConsumer with job.topics property.
      if (args && args.fqcn) return { fqcn: args.fqcn };
      for (const [fname, xml] of jarDsDescriptors(jar)) {
        if (!/property\s+name="job\.topics"/.test(xml)) continue;
        const nm = xml.match(/<scr:component[^>]*name="([^"]+)"/) || xml.match(/name="([^"]+)"/);
        const topic = (xml.match(/property\s+name="job\.topics"[^>]*value="([^"]+)"/) || [])[1];
        if (nm) return { fqcn: nm[1], topic: topic || null };
      }
      return null;
    },
    async verify({ sdkUrl, auth, bundleBSN, discovered }) {
      const bundleJson = await getJson(`${sdkUrl}/system/console/bundles/${enc(bundleBSN)}.json`, auth).catch(() => null);
      const bundle = bundleJson && bundleJson.data && bundleJson.data[0];
      if (!bundle) return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_INSTALLED, bundle_state: 'Unknown', component_state: 'Unknown', evidence: `bundle ${bundleBSN} not on SDK` };
      if (bundle.state !== 'Active') return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_ACTIVE, bundle_state: bundle.state, component_state: 'Unknown', evidence: `bundle state=${bundle.state}` };

      const compJson = await getJson(`${sdkUrl}/system/console/components/${enc(discovered.fqcn)}.json`, auth).catch(() => null);
      const comp = compJson && compJson.data && compJson.data[0];
      if (!comp) return { result: 'fail', failure_class: FAILURE_CLASSES.COMPONENT_UNSATISFIED, bundle_state: 'Active', component_state: 'Unknown', evidence: `component ${discovered.fqcn} not registered as OSGi DS` };
      const compState = String(comp.state || 'Unknown').toLowerCase();
      const unsatisfied = (comp.unsatisfiedReferences || []).map((r) => r.name || r);
      if (compState !== 'active') {
        return {
          result: 'fail',
          failure_class: unsatisfied.length ? FAILURE_CLASSES.COMPONENT_UNSATISFIED : FAILURE_CLASSES.ACTIVATION_ERROR,
          bundle_state: 'Active', component_state: capitalize(compState),
          unsatisfied_references: unsatisfied,
          activation_error: comp.error || comp.activationException || null,
          evidence: `component_state=${compState}`,
        };
      }

      const props = extractProps(comp);
      const topic = props['job.topics'];
      if (!topic) {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
          bundle_state: 'Active', component_state: 'Active',
          evidence: 'JobConsumer contract missing job.topics property',
        };
      }
      return { result: 'pass', bundle_state: 'Active', component_state: 'Active', checks: { topic } };
    },
  },

  replication: {
    describe: 'CQ Replicator / Sling Replicator → Sling Distribution API',
    discover: (jar, args) => {
      // Discovery on manifest: bundle imports org.apache.sling.distribution
      // (migrated) and NOT com.day.cq.replication (legacy). Class detection
      // is optional; we can verify at the bundle level.
      if (args && args.fqcn) return { fqcn: args.fqcn };
      const manifest = readJarManifest(jar);
      const importsDistribution = /Import-Package:[\s\S]*org\.apache\.sling\.distribution/.test(manifest);
      const importsLegacy = /Import-Package:[\s\S]*com\.day\.cq\.replication/.test(manifest);
      return { importsDistribution, importsLegacy, fqcn: null };
    },
    async verify({ sdkUrl, auth, bundleBSN, discovered }) {
      const bundleJson = await getJson(`${sdkUrl}/system/console/bundles/${enc(bundleBSN)}.json`, auth).catch(() => null);
      const bundle = bundleJson && bundleJson.data && bundleJson.data[0];
      if (!bundle) return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_INSTALLED, bundle_state: 'Unknown', component_state: 'Unknown', evidence: `bundle ${bundleBSN} not on SDK` };
      if (bundle.state !== 'Active') return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_ACTIVE, bundle_state: bundle.state, component_state: 'Unknown', evidence: `bundle state=${bundle.state}` };

      if (discovered.importsLegacy) {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
          bundle_state: 'Active', component_state: 'Active',
          evidence: 'bundle still imports com.day.cq.replication — migration incomplete',
        };
      }
      if (!discovered.importsDistribution) {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
          bundle_state: 'Active', component_state: 'Active',
          evidence: 'bundle does not import org.apache.sling.distribution — migration incomplete',
        };
      }

      // Confirm Distributor is available on the SDK (comes from AEM SDK itself,
      // not the customer bundle — but if missing, the migrated code can't run).
      const services = await getJson(`${sdkUrl}/system/console/services.json`, auth).catch(() => null);
      const list = services?.data || [];
      const hasDistributor = list.some((s) => /org\.apache\.sling\.distribution\.Distributor/.test(String(s.types || s.interfaces || '')));
      if (!hasDistributor) {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
          bundle_state: 'Active', component_state: 'Active',
          evidence: 'org.apache.sling.distribution.Distributor service not present on SDK',
        };
      }

      return { result: 'pass', bundle_state: 'Active', component_state: 'Active', checks: { imports_distribution: true, imports_legacy: false, distributor_present: true } };
    },
  },

  'legacy-ui': {
    describe: 'Classic UI / Coral 2 dialogs → Coral 3 (offline source check)',
    mode: 'source-only',
    discover: (jar) => {
      // Content packages (.zip via maven-bundle-plugin) put dialog XMLs under
      // /jcr_root/apps/**/cq:dialog/.content.xml. Bundles that embed content
      // also carry them at the same path or under jcr_root/.
      const listing = execFileSync('unzip', ['-l', jar], { encoding: 'utf8' });
      const dialogs = [];
      for (const line of listing.split('\n')) {
        const m = line.match(/(jcr_root\/.*?\/(_cq_dialog|cq:dialog)\/\.content\.xml)$/);
        if (m) dialogs.push(m[1]);
      }
      return dialogs.length ? { dialogs } : null;
    },
    async verify({ artifactPath, discovered }) {
      const classic = [];
      const coral2 = [];
      const coral3 = [];
      for (const p of discovered.dialogs) {
        const xml = execFileSync('unzip', ['-p', artifactPath, p], { encoding: 'utf8' });
        if (/\bxtype\s*=\s*"/.test(xml)) classic.push(p);
        else if (/sling:resourceType\s*=\s*"cq\/gui\/components\/authoring\/dialog/.test(xml)) coral2.push(p);
        else if (/sling:resourceType\s*=\s*"granite\/ui\/components\/coral\/foundation/.test(xml)) coral3.push(p);
      }
      const bad = classic.length + coral2.length;
      if (bad > 0) {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH,
          bundle_state: null, component_state: null,
          evidence: `${classic.length} Classic UI + ${coral2.length} Coral 2 dialogs remain (Coral 3 ok: ${coral3.length})`,
          checks: { dialogs_total: discovered.dialogs.length, classic: classic.length, coral2: coral2.length, coral3: coral3.length },
        };
      }
      return {
        result: 'pass',
        bundle_state: null, component_state: null,
        checks: { dialogs_total: discovered.dialogs.length, coral3: coral3.length },
      };
    },
  },
};

// Wall-clock start of this run, captured in main(), used for started_at on
// every outcome so run duration is honest.
let RUN_STARTED_AT = null;

async function main() {
  RUN_STARTED_AT = new Date().toISOString();
  const args = parseArgs(process.argv.slice(2));
  const pat = PATTERNS[args.pattern];
  if (!pat) fatal(`unknown pattern: ${args.pattern}\nsupported: ${Object.keys(PATTERNS).join(', ')}`);

  const setup = readSetup();
  const context = readContext();

  // Auto-resolve project-id from analyze context if not given. --finding is
  // accepted for backward-compat but no longer required (Option C outcome
  // schema uses run_id as parent identity; per-class detail lives in classes[]).
  if (!args['project-id']) {
    if (context.projectId) { args['project-id'] = context.projectId; console.log(`(auto) project-id = ${args['project-id']}`); }
    else fatal('--project-id not provided and no projectId in .rv/context.json — run analyze first, or pass --project-id <id>');
  }
  // Default --project to CWD if it looks like a Maven project.
  if (!args.project && !args.jar) {
    if (fs.existsSync(path.join(process.cwd(), 'pom.xml'))) {
      args.project = process.cwd();
      console.log(`(auto) project    = ${args.project}`);
    } else {
      fatal('no --project or --jar and current directory has no pom.xml — cd into your project or pass --project <dir>');
    }
  }

  if (!args.sdk && !setup.sdkUrl) fatal('no SDK — run `rv-init` first, or pass --sdk <url>');

  const sdkUrl = (args.sdk || setup.sdkUrl).replace(/\/$/, '');
  const user = args.user || setup.user || 'admin';
  const password = args.password || setup.password || 'admin';
  const auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

  console.log(`\n=== rv-check · ${args.pattern} ===`);
  console.log(args.jar ? `jar    : ${args.jar}` : `project: ${args.project}`);
  console.log(`sdk    : ${sdkUrl}`);
  console.log(`pattern: ${pat.describe}\n`);

  // 1. build (unless a pre-built jar was supplied)
  let artifactPath;
  if (args.jar) {
    if (!fs.existsSync(args.jar)) return finish({ result: 'fail', failure_class: FAILURE_CLASSES.INPUT_JAR_MISSING, verification_level: 'source-only', evidence: `no file at ${args.jar}` }, null, args);
    artifactPath = args.jar;
    console.log(`▸ skip build (using --jar)\n  ok (${path.basename(artifactPath)})\n`);
  } else {
    step('build customer project');
    const b = build({ projectDir: args.project });
    if (!b.ok) return finish({ result: 'fail', failure_class: FAILURE_CLASSES.BUILD_FAILED, verification_level: 'source-only', evidence: b.log }, null, args);
    artifactPath = b.artifactPath;
    console.log(`  ok (${path.basename(artifactPath)}, ${b.elapsedMs}ms)\n`);
  }

  // 2. auto-discover
  step('discover migrated class');
  const discovered = pat.discover(artifactPath, args);
  if (!discovered) return finish({ result: 'fail', failure_class: FAILURE_CLASSES.DISCOVERY_NO_MATCH, verification_level: 'source-only',
    evidence: `no DS component in ${artifactPath} matches the ${args.pattern} signature` }, null, args);
  console.log(`  ok → ${JSON.stringify(discovered)}\n`);

  // Source-only patterns (e.g. legacy-ui): skip deploy + runtime — verify
  // straight off the built artifact.
  if (pat.mode === 'source-only') {
    step('source verify');
    const outcome = await pat.verify({ artifactPath, discovered });
    outcome.verification_level = 'source-only';
    console.log(`  ${outcome.result === 'pass' ? 'ok' : 'FAIL'}${outcome.evidence ? ' — ' + outcome.evidence : ''}\n`);
    return finish(outcome, { discovered }, args);
  }

  // 3. deploy the customer bundle (— anything from here on touched the SDK, so verification_level = runtime)
  step('deploy customer bundle');
  const d = await deploy({ artifactPath, sdkUrl, user, password });
  if (!d.ok) {
    const bundle = d.symbolicName ? { symbolic_name: d.symbolicName, state: normalizeBundleState(d.state) } : null;
    return finish({ result: 'fail', failure_class: FAILURE_CLASSES.DEPLOY_FAILED, verification_level: 'runtime', evidence: `${d.log} state=${d.state}` }, bundle ? { bundle } : null, args);
  }
  console.log(`  ok (bundle ${d.bundleId} · ${d.symbolicName})\n`);
  await sleep(3000); // let DS settle

  // 4. runtime verify (bundle_state + component_state + contract)
  step('runtime verify');
  const outcome = await pat.verify({ sdkUrl, auth, bundleBSN: d.symbolicName, discovered });
  outcome.verification_level = 'runtime';
  console.log(`  ${outcome.result === 'pass' ? 'ok' : 'FAIL'} — bundle=${outcome.bundle_state} component=${outcome.component_state}${outcome.evidence ? '  ' + outcome.evidence : ''}\n`);

  return finish(outcome, {
    discovered,
    bundle: { symbolic_name: d.symbolicName, state: normalizeBundleState(outcome.bundle_state || d.state) },
  }, args);
}

// ---- helpers ----
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

// Read META-INF/MANIFEST.MF from a jar, unfolding continuation lines.
function readJarManifest(jarPath) {
  try {
    const mf = execFileSync('unzip', ['-p', jarPath, 'META-INF/MANIFEST.MF'], { encoding: 'utf8' });
    return mf.replace(/\r?\n /g, '');
  } catch { return ''; }
}

async function getJson(url, auth) {
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

const enc = encodeURIComponent;

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// Felix components.json returns props as [{key, value}, ...] with a nested
// "Properties" entry whose value is an array of "k = v" strings — that's where
// the OSGi DS component properties actually live.
function extractProps(component) {
  const props = component.props || component.properties || [];
  const propsEntry = Array.isArray(props) ? props.find((p) => p && p.key === 'Properties') : null;
  const rawList = propsEntry && Array.isArray(propsEntry.value) ? propsEntry.value : [];
  const out = {};
  for (const line of rawList) {
    if (typeof line !== 'string') continue;
    const eq = line.indexOf(' = ');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 3).trim();
  }
  return out;
}

function step(name) { console.log(`▸ ${name}`); }
function fatal(msg) { console.error(msg); process.exit(2); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function finish(outcome, extra, args) {
  const record = {
    run_id: outcome.run_id || 'rvc-' + Date.now(),
    started_at: outcome.started_at || RUN_STARTED_AT || new Date().toISOString(),
    ...outcome,
    ...(extra || {}),
    finished_at: outcome.finished_at || new Date().toISOString(),
  };
  console.log('=== outcome ===');
  console.log(JSON.stringify(record, null, 2));

  // Emit the MCP payload as a delimited block. The calling agent (skill) reads
  // this block and invokes the `report-rv-outcome` MCP tool with it — rv-check
  // does not speak MCP itself.
  if (args && args['project-id']) {
    const payload = buildMcpPayload(record, args);
    console.log('\n=== report-rv-outcome payload ===');
    console.log(JSON.stringify(payload));
    console.log('=== end payload ===');
  }

  process.exit(record.result === 'pass' ? 0 : 1);
}

// ---- setup.json (from rv-init) — machine-global at ~/.rv/, falls back to CWD ----
function readSetup() {
  const candidates = [
    path.join(process.env.HOME || '', '.rv', 'setup.json'),
    path.join(process.cwd(), '.rv', 'setup.json'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* try next */ }
    }
  }
  return {};
}

// ---- context.json (written by the analyze / migration skill) ----
// Shape: { projectId: string, pendingFindings: [{ id, pattern }] }
function readContext() {
  const ctxPath = path.join(process.cwd(), '.rv', 'context.json');
  if (!fs.existsSync(ctxPath)) return {};
  try { return JSON.parse(fs.readFileSync(ctxPath, 'utf8')); } catch { return {}; }
}

// ---- MCP telemetry ----
const EVIDENCE_MAX = 2048;
const BUNDLE_STATE_ENUM = new Set(['Installed', 'Resolved', 'Active', 'Fragment', 'Unknown']);

function normalizeBundleState(s) {
  if (!s) return 'Unknown';
  const v = String(s);
  return BUNDLE_STATE_ENUM.has(v) ? v : 'Unknown';
}

// Zod expects checks as Record<string, string|number|boolean>. verify() may
// stash nested objects (e.g. `properties`) — flatten one level, drop
// non-scalar values, and replace `.` with `_` in keys (MongoDB rejects
// dots in map keys).
function flattenChecks(checks) {
  if (!checks || typeof checks !== 'object') return undefined;
  const safeKey = (k) => String(k).replace(/\./g, '_');
  const out = {};
  for (const [k, v] of Object.entries(checks)) {
    if (['string', 'number', 'boolean'].includes(typeof v)) out[safeKey(k)] = v;
    else if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v)) {
        if (['string', 'number', 'boolean'].includes(typeof v2)) out[`${safeKey(k)}_${safeKey(k2)}`] = v2;
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function buildMcpPayload(outcome, args) {
  const className = (outcome.discovered && outcome.discovered.fqcn) || '(unknown)';
  const cls = { class_name: className, result: outcome.result };

  if (outcome.result === 'fail') {
    cls.failure_class = outcome.failure_class || FAILURE_CLASSES.UNKNOWN;
    if (outcome.bundle_state) cls.bundle_state = outcome.bundle_state;
    if (outcome.component_state) cls.component_state = outcome.component_state;
    if (outcome.unsatisfied_references && outcome.unsatisfied_references.length) cls.unsatisfied_references = outcome.unsatisfied_references;
    if (outcome.activation_error) cls.activation_error = outcome.activation_error;
    if (outcome.evidence) cls.evidence = truncate(outcome.evidence, EVIDENCE_MAX);
  } else {
    if (outcome.bundle_state) cls.bundle_state = outcome.bundle_state;
    if (outcome.component_state) cls.component_state = outcome.component_state;
    const checks = flattenChecks(outcome.checks);
    if (checks) cls.checks = checks;
  }

  const payload = {
    run_id: outcome.run_id,
    project_id: args['project-id'],
    skill_pattern: args.pattern,
    skill_version: args['skill-version'] || '1.0',
    result: outcome.result,
    verification_level: outcome.verification_level,
    started_at: outcome.started_at,
    finished_at: outcome.finished_at,
    summary: {
      classes_total: 1,
      classes_pass: outcome.result === 'pass' ? 1 : 0,
      classes_fail: outcome.result === 'fail' ? 1 : 0,
    },
    classes: [stripEmpty(cls)],
  };
  if (outcome.bundle) payload.bundle = outcome.bundle;
  if (outcome.skill_decisions) payload.skill_decisions = outcome.skill_decisions;
  return stripEmpty(payload);
}

function truncate(s, max) {
  if (typeof s !== 'string' || s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// Strip both undefined and null so optional Zod string fields stay unset
// rather than being sent as null (which Zod's .optional() rejects).
function stripEmpty(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}

function parseArgs(argv) {
  const out = { pattern: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].replace(/^--/, '');
    out[k] = argv[++i];
  }
  return out;
}

main().catch(e => { console.error(e); process.exit(2); });
