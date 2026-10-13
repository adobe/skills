#!/usr/bin/env node
'use strict';

/**
 * validate-migration check — verify one or more migrated patterns on the customer's local Cloud SDK.
 *
 *   validate-migration check                                 (auto: diff branch vs main, verify what changed)
 *   validate-migration check <pattern>                       (manual: verify one pattern, flags auto-resolved)
 *   validate-migration check <pattern> --finding <id> --project-id <pid> --project <dir>
 *
 * Auto mode diffs the current branch against `main`/`origin/main` (see plan.js),
 * classifies changed files into supported patterns, and runs each as its own
 * build → deploy → verify task — each task produces its own outcome and MCP payload.
 *
 * Config, all optional (never persisted to disk):
 *   AEM_SDK_URL      SDK base URL (default http://localhost:4502)
 *   --sdk            CLI override
 *
 * The skill holds no SDK credentials and never calls the SDK console: deploy
 * runs the project's own auto-install Maven profile, and runtime state comes
 * from the AEM Quickstart MCP `diagnose-osgi-bundle` tool.
 *
 * Reads the CAM project (if any) from the nearest migration-runbook.json written by the
 * analyze / migration skill, and <cwd>/pom.xml as the default project root.
 *
 * Pipeline (per task): build → discover class → deploy → verify → emit outcome via MCP.
 * Exits 0 validated and recorded, 1 validation failed, 2 usage/error,
 * 3 incomplete (awaiting MCP diagnosis or reporting acknowledgement).
 * Never modifies customer code.
 */
if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
  console.error('[validate-migration] Node 18+ required (needs global fetch / FormData / Blob).');
  process.exit(2);
}

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { build } = require('./build.js');
const { deploy } = require('./deploy.js');
const { FAILURE_CLASSES } = require('./failure-classes.js');
const { computeValidationPlan } = require('./plan.js');
const { writeLocalReport, renderLocalReport, finalizeReporting, resolveSdkUrl, camReportingNote, normalizeBundleState, buildMcpPayload, validationChecks, toClassEntry, truncate, stripEmpty } = require('./reporting.js');

// Each pattern entry defines how to find its migrated class in a built jar
// (`discover`) and how to check the runtime contract on the SDK (`verify`).
const PATTERNS = {
  'custom-templates': {
    describe: 'Editable templates (offline source check of the built content package)',
    mode: 'source-only',
    discover: (pkg, task) => {
      const templates = discoverTemplates(pkg, task.template);
      const changed = task.files?.map((f) => f.match(/(?:^|\/)conf\/[^/]+\/settings\/wcm\/templates\/[^/]+/))
        .filter(Boolean).map((m) => '/' + m[0].replace(/^\//, ''));
      const scoped = changed && !task.template ? templates.filter((t) => changed.includes(t)) : templates;
      return scoped.length ? { templates: scoped } : null;
    },
    async verify({ artifactPath, discovered }) {
      const entries = execFileSync('unzip', ['-Z1', artifactPath], { encoding: 'utf8' }).split('\n');
      const find = (p) => entries.find((e) => e.replace(/^jcr_root\//, '') === p);
      const node = (t, child) => find(`${t.slice(1)}/${child}/.content.xml`) || find(`${t.slice(1)}/${child}.xml`);
      const t = discovered.template;
      const definition = find(`${t.slice(1)}/.content.xml`);
      const isTemplate = !!definition
        && /jcr:primaryType\s*=\s*"cq:Template"/.test(execFileSync('unzip', ['-p', artifactPath, definition], { encoding: 'utf8' }));
      const checks = { template_definition: isTemplate, structure: !!node(t, 'structure'), initial: !!node(t, 'initial'), policies: !!node(t, 'policies') };
      const missing = ['template_definition', 'structure', 'initial'].filter((k) => !checks[k]);
      if (missing.length) {
        return { result: 'fail', failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH, bundle_state: null, component_state: null,
          evidence: `${t}: missing ${missing.join(', ')} in built content package`, checks };
      }
      return { result: 'pass', bundle_state: null, component_state: null, checks };
    },
  },
  scheduler: {
    describe: 'Sling Scheduler (Cloud Service contract)',
    discover: (jar, args) => {
      // If the caller pinned a class, take it verbatim.
      if (args && args.fqcn) return { fqcn: args.fqcn, contract: componentContractFromDescriptor(dsDescriptorFor(jar, args.fqcn), 'scheduler') };
      // Otherwise match any DS descriptor with scheduler.expression. Prefer the
      // one that ALSO declares scheduler.runOn (the migrated one).
      const candidates = [];
      for (const [fname, xml] of jarDsDescriptors(jar)) {
        if (!descriptorProperty(xml, 'scheduler.expression').present) continue;
        const nm = xml.match(/<scr:component[^>]*name="([^"]+)"/) || xml.match(/name="([^"]+)"/);
        const hasRunOn = descriptorProperty(xml, 'scheduler.runOn').present;
        candidates.push({ fqcn: nm ? nm[1] : path.basename(fname, '.xml'), hasRunOn });
      }
      if (candidates.length === 0) return null;
      const migrated = candidates.find((c) => c.hasRunOn);
      if (!migrated && candidates.length > 1) {
        console.log(`  note: ${candidates.length} scheduler classes in jar, none declare scheduler.runOn; picking ${candidates[0].fqcn} — pass --fqcn to override`);
      }
      const fqcn = (migrated || candidates[0]).fqcn;
      return { fqcn, contract: componentContractFromDescriptor(dsDescriptorFor(jar, fqcn), 'scheduler') };
    },
    async verify({ bundleBSN, discovered, args }) {
      const fqcn = discovered.fqcn;
      const contractFailure = sourceContractFailure(discovered);
      if (contractFailure) return contractFailure;

      // 1. bundle + component state — both from the MCP diagnose-osgi-bundle tool
      const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
      if (!diagnosis.available) return mcpUnavailableOutcome(bundleBSN);
      if (!diagnosis.found) {
        return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_INSTALLED, bundle_state: diagnosis.bundle_state, component_state: 'Unknown', evidence: `bundle ${bundleBSN} not found on SDK` };
      }
      if (diagnosis.bundle_state !== 'Active') {
        return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_ACTIVE, bundle_state: diagnosis.bundle_state, component_state: 'Unknown', evidence: `bundle state=${diagnosis.bundle_state}` };
      }
      const bundle_state = diagnosis.bundle_state;

      const compFromMcp = diagnosis.components.get(discovered.contract?.componentName || fqcn);
      if (!compFromMcp) {
        return { result: 'fail', failure_class: FAILURE_CLASSES.COMPONENT_UNSATISFIED, bundle_state, component_state: 'Unknown', evidence: `component ${fqcn} not present in MCP diagnose-osgi-bundle report` };
      }
      const component_state = compFromMcp.state || 'Unknown';

      if (component_state !== 'Active') {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.ACTIVATION_ERROR,
          bundle_state,
          component_state,
          evidence: `component_state=${component_state}`,
        };
      }

      // Contract properties (scheduler.expression, scheduler.runOn, etc.) are
      // not exposed by diagnose-osgi-bundle today. Report as restricted so the
      // agent knows the bundle+component check passed but the DS-property
      // contract could not be verified. Track as an MCP feature request.
      return {
        result: 'pass',
        bundle_state,
        component_state: 'Active',
        checks: { ...discovered.contract?.checks, migration_contract: 'pass', business_behavior: 'not_tested' },
        restricted: true,
        restricted_reason: 'effective scheduler DS properties not exposed by diagnose-osgi-bundle; scheduled execution and cluster behavior not verified',
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
      // Legacy AssetManager usage is a class-level reference in the bytecode,
      // not a manifest import (Import-Package only lists the package), so scan
      // the compiled classes for it independently of the DS component.
      const usesLegacyAssetManager = jarReferencesClass(jar, LEGACY_ASSET_MANAGER);
      if (args && args.fqcn) return { fqcn: args.fqcn, usesLegacyAssetManager };
      for (const [fname, xml] of jarDsDescriptors(jar)) {
        if (!/reference\s+[^>]*interface="org\.apache\.sling\.api\.resource\.ResourceResolverFactory"/.test(xml)) continue;
        const nm = xml.match(/<scr:component[^>]*name="([^"]+)"/) || xml.match(/name="([^"]+)"/);
        if (nm) return { fqcn: nm[1], usesLegacyAssetManager };
      }
      return { fqcn: null, usesLegacyAssetManager };
    },
    async verify({ bundleBSN, discovered, args }) {
      // 1. bundle + component state from MCP diagnose-osgi-bundle
      const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
      if (!diagnosis.available) return mcpUnavailableOutcome(bundleBSN);
      if (!diagnosis.found) return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_INSTALLED, bundle_state: diagnosis.bundle_state, component_state: 'Unknown', evidence: `bundle ${bundleBSN} not on SDK` };
      if (diagnosis.bundle_state !== 'Active') return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_ACTIVE, bundle_state: diagnosis.bundle_state, component_state: 'Unknown', evidence: `bundle state=${diagnosis.bundle_state}` };

      // Class references are read offline from the built artifact — not from
      // the SDK — so this stays MCP-independent.
      if (discovered.usesLegacyAssetManager) {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
          bundle_state: 'Active', component_state: 'Active',
          evidence: 'bundle still references com.day.cq.dam.api.AssetManager — migration incomplete',
        };
      }

      const compFromMcp = discovered.fqcn ? diagnosis.components.get(discovered.fqcn) : null;
      if (discovered.fqcn && !compFromMcp) return { result: 'fail', failure_class: FAILURE_CLASSES.COMPONENT_UNSATISFIED, bundle_state: 'Active', component_state: 'Unknown', evidence: `component ${discovered.fqcn} not present in MCP diagnose-osgi-bundle report` };
      const compState = (compFromMcp && compFromMcp.state) || 'Unknown';

      // Satisfied is fine for a service-only component that nothing has activated yet.
      if (compFromMcp && compState !== 'Active' && compState !== 'Satisfied') {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.ACTIVATION_ERROR,
          bundle_state: 'Active', component_state: compState,
          evidence: `component_state=${compState}`,
        };
      }

      return { result: 'pass', bundle_state: 'Active', component_state: compFromMcp ? compState : 'Active', checks: { uses_legacy_asset_manager: false } };
    },
  },

  'event-migration': {
    describe: 'OSGi EventHandler → Sling JobConsumer',
    discover: (jar, args) => {
      // Migrated code declares a JobConsumer with job.topics property.
      // When the caller pins a class, read that component's descriptor so the
      // topic check still runs instead of being silently skipped.
      if (args && args.fqcn) {
        const xml = dsDescriptorFor(jar, args.fqcn);
        return { fqcn: args.fqcn, topic: topicFromDescriptor(xml), contract: componentContractFromDescriptor(xml, 'event-migration') };
      }
      for (const [fname, xml] of jarDsDescriptors(jar)) {
        if (!descriptorProperty(xml, 'job.topics').present) continue;
        const nm = xml.match(/<scr:component[^>]*name="([^"]+)"/) || xml.match(/name="([^"]+)"/);
        if (nm) return { fqcn: nm[1], topic: topicFromDescriptor(xml), contract: componentContractFromDescriptor(xml, 'event-migration') };
      }
      return null;
    },
    async verify({ bundleBSN, discovered, args }) {
      const contractFailure = sourceContractFailure(discovered);
      if (contractFailure) return contractFailure;
      // 1. bundle + component state from MCP diagnose-osgi-bundle
      const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
      if (!diagnosis.available) return mcpUnavailableOutcome(bundleBSN);
      if (!diagnosis.found) return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_INSTALLED, bundle_state: diagnosis.bundle_state, component_state: 'Unknown', evidence: `bundle ${bundleBSN} not on SDK` };
      if (diagnosis.bundle_state !== 'Active') return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_ACTIVE, bundle_state: diagnosis.bundle_state, component_state: 'Unknown', evidence: `bundle state=${diagnosis.bundle_state}` };

      const compFromMcp = diagnosis.components.get(discovered.contract?.componentName || discovered.fqcn);
      if (!compFromMcp) return { result: 'fail', failure_class: FAILURE_CLASSES.COMPONENT_UNSATISFIED, bundle_state: 'Active', component_state: 'Unknown', evidence: `component ${discovered.fqcn} not present in MCP diagnose-osgi-bundle report` };
      const compState = compFromMcp.state || 'Unknown';
      if (compState !== 'Active') {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.ACTIVATION_ERROR,
          bundle_state: 'Active', component_state: compState,
          evidence: `component_state=${compState}`,
        };
      }

      // job.topics is read at discovery time from the built DS descriptor
      // (offline), so no Felix property lookup is needed.
      if (!discovered.topic) {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
          bundle_state: 'Active', component_state: 'Active',
          evidence: 'JobConsumer contract missing job.topics property in DS descriptor',
        };
      }
      return {
        result: 'pass', bundle_state: 'Active', component_state: 'Active',
        checks: { ...discovered.contract?.checks, topic: discovered.topic },
        restricted: true,
        restricted_reason: 'effective JobConsumer properties not exposed by diagnose-osgi-bundle; job processing and business effects not tested',
      };
    },
  },

  'resource-change-listener': {
    describe: 'JCR EventListener / resource EventHandler → Sling ResourceChangeListener',
    discover: (jar, args) => {
      // Migrated code registers a ResourceChangeListener DS
      // service with resource.paths + resource.change.types properties.
      // When the caller pins a class, read that component's descriptor so the
      // contract check still runs instead of being silently skipped.
      if (args && args.fqcn) {
        const xml = dsDescriptorFor(jar, args.fqcn);
        const flags = rclFlagsFromDescriptor(xml);
        return { fqcn: args.fqcn, hasPaths: flags.hasPaths, hasChangeTypes: flags.hasChangeTypes, contract: componentContractFromDescriptor(xml, 'resource-change-listener') };
      }
      for (const [fname, xml] of jarDsDescriptors(jar)) {
        const providesRcl = /provide\s+interface="org\.apache\.sling\.api\.resource\.observation\.(External)?ResourceChangeListener"/.test(xml);
        const flags = rclFlagsFromDescriptor(xml);
        if (!providesRcl && !(flags.hasPaths && flags.hasChangeTypes)) continue;
        const nm = xml.match(/<scr:component[^>]*name="([^"]+)"/) || xml.match(/name="([^"]+)"/);
        if (nm) return { fqcn: nm[1], hasPaths: flags.hasPaths, hasChangeTypes: flags.hasChangeTypes, contract: componentContractFromDescriptor(xml, 'resource-change-listener') };
      }
      return null;
    },
    async verify({ bundleBSN, discovered, args }) {
      const contractFailure = sourceContractFailure(discovered);
      if (contractFailure) return contractFailure;
      // 1. bundle + component state from MCP diagnose-osgi-bundle
      const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
      if (!diagnosis.available) return mcpUnavailableOutcome(bundleBSN);
      if (!diagnosis.found) return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_INSTALLED, bundle_state: diagnosis.bundle_state, component_state: 'Unknown', evidence: `bundle ${bundleBSN} not on SDK` };
      if (diagnosis.bundle_state !== 'Active') return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_ACTIVE, bundle_state: diagnosis.bundle_state, component_state: 'Unknown', evidence: `bundle state=${diagnosis.bundle_state}` };

      const compFromMcp = diagnosis.components.get(discovered.contract?.componentName || discovered.fqcn);
      if (!compFromMcp) return { result: 'fail', failure_class: FAILURE_CLASSES.COMPONENT_UNSATISFIED, bundle_state: 'Active', component_state: 'Unknown', evidence: `component ${discovered.fqcn} not present in MCP diagnose-osgi-bundle report` };
      const compState = compFromMcp.state || 'Unknown';
      if (compState !== 'Active') {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.ACTIVATION_ERROR,
          bundle_state: 'Active', component_state: compState,
          evidence: `component_state=${compState}`,
        };
      }

      // resource.paths + resource.change.types are read from the built DS descriptor,
      // not the effective properties of the running component.
      if (!discovered.hasPaths || !discovered.hasChangeTypes) {
        const missing = [!discovered.hasPaths && 'resource.paths', !discovered.hasChangeTypes && 'resource.change.types'].filter(Boolean).join(' + ');
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.CONTRACT_MISMATCH,
          bundle_state: 'Active', component_state: 'Active',
          evidence: `ResourceChangeListener contract incomplete: ${missing} missing in DS descriptor`,
        };
      }
      return {
        result: 'pass', bundle_state: 'Active', component_state: 'Active',
        checks: { ...discovered.contract?.checks, resource_paths: true, resource_change_types: true },
        restricted: true,
        restricted_reason: 'effective ResourceChangeListener properties not exposed by diagnose-osgi-bundle; listener callbacks and business effects not tested',
      };
    },
  },

  replication: {
    describe: 'CQ Replicator / Sling Replicator → Sling Distribution API',
    discover: (jar, args) => {
      // Discovery on manifest: bundle imports org.apache.sling.distribution
      // (migrated) and NOT com.day.cq.replication (legacy). Class detection
      // is optional; we verify at the bundle level.
      const manifest = readJarManifest(jar);
      const importsDistribution = manifestImportsPackage(manifest, 'org.apache.sling.distribution');
      const importsLegacy = manifestImportsPackage(manifest, 'com.day.cq.replication');
      return { importsDistribution, importsLegacy, fqcn: (args && args.fqcn) || null };
    },
    async verify({ bundleBSN, discovered, args }) {
      // Bundle state via MCP. Manifest headers are inspected offline from the
      // built artifact (see discover); the Distributor service list is not
      // exposed by diagnose-osgi-bundle today — tracked as a restricted check.
      const diagnosis = await getBundleDiagnosis({ bundleBSN, args });
      if (!diagnosis.available) return mcpUnavailableOutcome(bundleBSN);
      if (!diagnosis.found) return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_INSTALLED, bundle_state: diagnosis.bundle_state, component_state: 'Unknown', evidence: `bundle ${bundleBSN} not on SDK` };
      if (diagnosis.bundle_state !== 'Active') return { result: 'fail', failure_class: FAILURE_CLASSES.BUNDLE_NOT_ACTIVE, bundle_state: diagnosis.bundle_state, component_state: 'Unknown', evidence: `bundle state=${diagnosis.bundle_state}` };

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

      return {
        result: 'pass',
        bundle_state: 'Active', component_state: 'Active',
        restricted: true,
        restricted_reason: 'Distributor service registration not exposed by diagnose-osgi-bundle',
        checks: { imports_distribution: true, imports_legacy: false },
      };
    },
  },

  'legacy-ui': {
    describe: 'Classic UI / Coral 2 dialogs → Coral 3 (offline source check)',
    mode: 'source-only',
    discover: (jar, task) => {
      // Classic + Touch UI dialogs, folder or single-file serialization:
      // _cq_dialog/.content.xml, _cq_dialog.xml, dialog.xml, design_dialog, etc.
      const listing = execFileSync('unzip', ['-l', jar], { encoding: 'utf8' });
      let dialogs = [];
      for (const line of listing.split('\n')) {
        const m = line.match(/(jcr_root\/.*\/(?:_cq_dialog|cq:dialog|_cq_design_dialog|design_dialog|dialog)(?:\/\.content\.xml|\.xml))$/);
        if (m) dialogs.push(m[1]);
      }
      // Auto mode: verify only dialogs the branch changed, so a partial migration
      // or a kept Classic backup elsewhere doesn't fail the run. Explicit
      // --pattern (no task.files) scans the whole package.
      dialogs = scopeToChangedFiles(dialogs, task);
      return dialogs.length ? { dialogs } : null;
    },
    async verify({ artifactPath, discovered }) {
      const classic = [];
      const coral2 = [];
      const coral3 = [];
      for (const p of discovered.dialogs) {
        const xml = execFileSync('unzip', ['-p', artifactPath, p], { encoding: 'utf8' });
        const kind = classifyDialog(xml);
        if (kind === 'classic') classic.push(p);
        else if (kind === 'coral2') coral2.push(p);
        else if (kind === 'coral3') coral3.push(p);
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

  // Custom Classic Widget removal. Overlaps legacy-ui at the file level (both
  // live in dialog XMLs), but asserts the CDW-specific contract: no
  // `cq:Widget` nodes and no custom `xtype=` remain. Invoke explicitly
  // (`check.js cdw`) — at branch-diff time it is path-indistinguishable from
  // legacy-ui, so plan.js auto-classifies shared dialog changes as legacy-ui
  // (which already flags remaining xtypes).
  cdw: {
    describe: 'Custom Classic Widgets (ExtJS xtypes) → Coral 3 (offline source check)',
    mode: 'source-only',
    discover: (jar, task) => {
      // Classic + Touch UI dialogs, folder or single-file serialization:
      // _cq_dialog/.content.xml, _cq_dialog.xml, dialog.xml, design_dialog, etc.
      const listing = execFileSync('unzip', ['-l', jar], { encoding: 'utf8' });
      let dialogs = [];
      for (const line of listing.split('\n')) {
        const m = line.match(/(jcr_root\/.*\/(?:_cq_dialog|cq:dialog|_cq_design_dialog|design_dialog|dialog)(?:\/\.content\.xml|\.xml))$/);
        if (m) dialogs.push(m[1]);
      }
      dialogs = scopeToChangedFiles(dialogs, task);
      return dialogs.length ? { dialogs } : null;
    },
    async verify({ artifactPath, discovered }) {
      const widgetDialogs = [];
      const xtypeDialogs = [];
      for (const p of discovered.dialogs) {
        const xml = execFileSync('unzip', ['-p', artifactPath, p], { encoding: 'utf8' });
        if (/jcr:primaryType\s*=\s*"cq:Widget"/.test(xml)) widgetDialogs.push(p);
        if (/\bxtype\s*=\s*"/.test(xml)) xtypeDialogs.push(p);
      }
      const remaining = new Set([...widgetDialogs, ...xtypeDialogs]).size;
      if (remaining > 0) {
        return {
          result: 'fail',
          failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH,
          bundle_state: null, component_state: null,
          evidence: `${widgetDialogs.length} dialog(s) still declare cq:Widget nodes, ${xtypeDialogs.length} still carry xtype= — custom widgets not fully migrated to Coral 3`,
          checks: { dialogs_total: discovered.dialogs.length, cq_widget_dialogs: widgetDialogs.length, xtype_dialogs: xtypeDialogs.length },
        };
      }
      return {
        result: 'pass',
        bundle_state: null, component_state: null,
        checks: { dialogs_total: discovered.dialogs.length, cq_widget_dialogs: 0, xtype_dialogs: 0 },
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
  if (args.pattern && !PATTERNS[args.pattern]) fatal(`unknown pattern: ${args.pattern}\nsupported: ${Object.keys(PATTERNS).join(', ')}`);

  const stage = args.stage || 'all';
  if (!['prepare', 'verify', 'all', 'finalize'].includes(stage)) {
    fatal(`unknown --stage: ${stage}. Use one of: prepare, verify, all, finalize.`);
  }

  if (stage === 'finalize') {
    if (!args.report || !args.receipt) fatal('--stage finalize requires --report <json> and --receipt <json>');
    const record = JSON.parse(fs.readFileSync(args.report, 'utf8'));
    const receipt = JSON.parse(fs.readFileSync(args.receipt, 'utf8'));
    const finalized = finalizeReporting(record, receipt);
    const report = writeLocalReport(finalized, args.project || process.cwd());
    console.log(`reporting: ${finalized.reporting.status}\nlocal report: ${report.mdPath}`);
    process.exit(finalized.reporting.status !== 'recorded' ? 3 : finalized.result === 'pass' ? 0 : 1);
  }

  const context = readContext(args);

  // Local validation does not require a CAM project-id. When one is available
  // (either --project-id or auto-loaded from the nearest migration-runbook.json),
  // we emit the submit-migration-validation-result payload; otherwise we skip that reporting
  // step and just print the local outcome.
  const explicitProject = args['project-id'] || args['project-name'];
  if (!explicitProject && context.projectId) {
    args['project-id'] = context.projectId;
    console.log(`(auto) project-id = ${args['project-id']}`);
  }
  if (!explicitProject && context.projectName) {
    args['project-name'] = context.projectName;
  }

  const cwd = args.project || process.cwd();
  const statePath = path.join(cwd, '.validate-migration', 'state.json');

  // ---- stage: verify (consume persisted state + agent-supplied MCP diagnosis) ----
  if (stage === 'verify') {
    if (!fs.existsSync(statePath)) {
      fatal(`no ${path.relative(cwd, statePath)} found. Run --stage prepare first.`);
    }
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    RUN_STARTED_AT = state.started_at || RUN_STARTED_AT;
    const records = [];
    for (const t of state.prepared) {
      records.push(await verifyPreparedTask(t, args));
    }
    return finishAll(records, args);
  }

  // ---- stage: prepare | all ----
  // A fresh prepare rebuilds + redeploys, so any diagnosis map from a prior run
  // is stale. Clear the default map so verify can't read stale bundle state
  // (an explicit --diagnosis-map is left as-is — it may be a fixture).
  if (!args['diagnosis-map']) {
    clearDiagnosisMap(cwd);
  }

  // Resolve tasks: either the pattern the caller pinned, or an auto-detected
  // set from diffing the branch against main (plan.js).
  let tasks;
  if (args.pattern) {
    if (!args.project && !args.jar) {
      if (fs.existsSync(path.join(process.cwd(), 'pom.xml'))) {
        args.project = process.cwd();
        console.log(`(auto) project    = ${args.project}`);
      } else {
        fatal('no --project or --jar and current directory has no pom.xml — cd into your project or pass --project <dir>');
      }
    }
    tasks = [{ module: args.project, jar: args.jar, pattern: args.pattern, fqcn: args.fqcn, template: args.template }];
  } else {
    const plan = computeValidationPlan({ cwd, baseRef: args.base });
    if (plan.error) fatal(`could not auto-detect what to verify: ${plan.error} — pass --pattern <name> to run one pattern manually`);
    if (plan.tasks.length === 0) {
      console.log(`[validate-migration] no validate-migration-relevant changes vs ${plan.baseRef} — nothing to verify.`);
      process.exit(0);
    }
    console.log(`[validate-migration] auto-detected ${plan.tasks.length} task(s) from diff vs ${plan.baseRef}:`);
    for (const t of plan.tasks) console.log(`  • ${t.pattern} — ${path.relative(cwd, t.module) || '.'} (${t.files.length} file(s) changed)`);
    tasks = plan.tasks;
  }

  const anyNeedsSdk = tasks.some((t) => PATTERNS[t.pattern].mode !== 'source-only');
  const sdkUrl = anyNeedsSdk ? await resolveSdkUrl(args) : null;
  if (anyNeedsSdk && !sdkUrl) {
    fatal('no running SDK found on ports 4502 / 4602 / 4503 and none could be started from the workspace. Download the AEM SDK, or set AEM_SDK_URL / pass --sdk <url> (--search <dir> to locate the Quickstart jar).');
  }
  const prepared = [];
  for (const task of tasks) {
    const p = await prepareTask(task, { sdkUrl });
    if (p.pattern === 'custom-templates' && p.discovered?.templates) {
      for (const template of p.discovered.templates) {
        prepared.push({ ...p, discovered: { template } });
      }
    } else prepared.push(p);
  }

  // Persist prepared state so `--stage verify` (potentially re-invoked after
  // the agent gathers MCP diagnosis) doesn't have to rebuild + redeploy.
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ started_at: RUN_STARTED_AT, prepared }, null, 2));

  // Bundle-runtime patterns need the agent to gather MCP diagnosis BETWEEN
  // prepare and verify. `--stage all` gives no such window, so when bundle
  // tasks are present (and no explicit map was supplied) we stop after prepare
  // with guidance instead of running — and failing — verify.
  const bundleTasks = prepared.filter((p) => p.mode === 'bundle-runtime' && !p.failure);

  // Give DS components time to settle after deploy before the agent diagnoses.
  const settleMs = Number(args['settle-ms'] ?? 5000);
  if (bundleTasks.length && !args['diagnosis-map'] && settleMs > 0) {
    step(`settle ${settleMs}ms for DS activation`);
    await sleep(settleMs);
  }

  const { stop: stopAfterPrepare, exitCode: prepareExitCode } = prepareStopDecision(stage, bundleTasks.length, !!args['diagnosis-map']);

  if (stopAfterPrepare) {
    console.log(`\n[validate-migration] prepare complete. ${prepared.length} task(s) staged.`);
    const bsns = [...new Set(prepared.map((p) => p.symbolicName).filter(Boolean))];
    if (bsns.length) {
      console.log('Have the coding assistant call the AEM Quickstart MCP tool `diagnose-osgi-bundle` (argument `bundleSymbolicName`) for each of these bundles:');
      for (const b of bsns) console.log(`  - ${b}`);
      console.log(`then write the raw tool outputs to ${path.relative(cwd, path.join(cwd, '.validate-migration', 'diagnosis-map.json'))} as a { "<BSN>": "<raw text>" } map,`);
      console.log(`and finally re-run:  node ${__filename} --stage verify`);
    }
    if (stage === 'all' && bundleTasks.length) {
      console.warn(`[validate-migration] --stage all can't verify ${bundleTasks.length} bundle-runtime pattern(s) in one shot — stopped after prepare. Gather MCP diagnosis, then re-run --stage verify.`);
    }
    process.exit(prepareExitCode);
  }

  // Only source-only tasks (or an explicit --diagnosis-map): verify now.
  const records = [];
  for (const t of prepared) {
    records.push(await verifyPreparedTask(t, args));
  }
  return finishAll(records, args);
}

// prepareTask: build → discover → (source-only verify | deploy). Returns a
// serializable record persisted to .validate-migration/state.json and later
// consumed by verifyPreparedTask.
async function prepareTask(task, { sdkUrl }) {
  const pat = PATTERNS[task.pattern];
  console.log(`\n=== validate-migration prepare · ${task.pattern} ===`);
  console.log(task.jar ? `jar    : ${task.jar}` : `project: ${task.module}`);
  if (pat.mode !== 'source-only') console.log(`sdk    : ${sdkUrl}`);
  console.log(`pattern: ${pat.describe}\n`);

  // 1. build (unless a pre-built jar was supplied)
  let artifactPath;
  if (task.jar) {
    if (!fs.existsSync(task.jar)) {
      return { pattern: task.pattern, module: task.module, jar: task.jar,
        failure: { result: 'fail', failure_class: FAILURE_CLASSES.INPUT_JAR_MISSING, verification_level: 'source-only', evidence: `no file at ${task.jar}` } };
    }
    artifactPath = task.jar;
    console.log(`▸ skip build (using --jar)\n  ok (${path.basename(artifactPath)})\n`);
  } else {
    step('build customer project');
    const b = build({ projectDir: task.module, artifact: pat.mode === 'source-only' ? 'content-package' : 'bundle' });
    if (!b.ok) {
      return { pattern: task.pattern, module: task.module,
        failure: { result: 'fail', failure_class: FAILURE_CLASSES.BUILD_FAILED, verification_level: 'source-only', evidence: b.log } };
    }
    artifactPath = b.artifactPath;
    console.log(`  ok (${path.basename(artifactPath)}, ${b.elapsedMs}ms)\n`);
  }

  // 2. auto-discover
  step('discover migrated class');
  const discovered = pat.discover(artifactPath, task);
  if (!discovered) {
    return { pattern: task.pattern, module: task.module, artifactPath,
      failure: { result: 'fail', failure_class: FAILURE_CLASSES.DISCOVERY_NO_MATCH, verification_level: 'source-only', evidence: `no DS component in ${artifactPath} matches the ${task.pattern} signature` } };
  }
  console.log(`  ok → ${JSON.stringify(discovered)}\n`);

  // Source-only patterns: no deploy; verify runs off the artifact only.
  if (pat.mode === 'source-only') {
    return { pattern: task.pattern, module: task.module, artifactPath, discovered, mode: 'source-only' };
  }

  // 3. deploy the customer bundle
  step('deploy customer bundle');
  const d = await deploy({ projectDir: task.module, artifactPath, sdkUrl });
  if (!d.ok) {
    return { pattern: task.pattern, module: task.module, artifactPath, discovered, mode: 'bundle-runtime',
      symbolicName: d.symbolicName || null,
      failure: { result: 'fail', failure_class: FAILURE_CLASSES.DEPLOY_FAILED, verification_level: 'runtime', evidence: d.log,
        ...(d.symbolicName ? { bundle: { symbolic_name: d.symbolicName, state: normalizeBundleState() } } : {}) } };
  }
  console.log(`  ok (bundle ${d.symbolicName}${d.mode ? ' via ' + d.mode : ''})\n`);
  return { pattern: task.pattern, module: task.module, artifactPath, discovered, mode: 'bundle-runtime', symbolicName: d.symbolicName, deployMode: d.mode };
}

// verifyPreparedTask: source-only patterns verify off the artifact; runtime
// patterns require the agent-supplied MCP diagnosis-map.
async function verifyPreparedTask(prepared, args) {
  if (prepared.failure) {
    return { pattern: prepared.pattern, ...prepared.failure, discovered: prepared.discovered };
  }
  const pat = PATTERNS[prepared.pattern];
  if (prepared.mode === 'source-only') {
    step(`source verify · ${prepared.pattern}`);
    const outcome = await pat.verify({ artifactPath: prepared.artifactPath, discovered: prepared.discovered });
    console.log(`  ${outcome.result === 'pass' ? 'ok' : 'FAIL'}${outcome.evidence ? ' — ' + outcome.evidence : ''}\n`);
    return { pattern: prepared.pattern, ...outcome, verification_level: 'source-only', discovered: prepared.discovered };
  }

  step(`runtime verify · ${prepared.pattern}`);
  const outcome = await pat.verify({ bundleBSN: prepared.symbolicName, discovered: prepared.discovered, args });
  console.log(`  ${outcome.result === 'pass' ? 'ok' : 'FAIL'} — bundle=${outcome.bundle_state} component=${outcome.component_state}${outcome.evidence ? '  ' + outcome.evidence : ''}\n`);

  return {
    pattern: prepared.pattern,
    ...outcome,
    verification_level: outcome.verification_level || 'runtime',
    discovered: prepared.discovered,
    bundle: { symbolic_name: prepared.symbolicName, state: normalizeBundleState(outcome.bundle_state) },
  };
}

// ---- helpers ----

const TEMPLATE_PREFIX = /^\/conf\/[a-zA-Z0-9_-]+\/settings\/wcm\/templates\/[a-zA-Z0-9_-]+$/;

// Lists editable template roots in a built content package, optionally narrowed to one path.
function discoverTemplates(artifactPath, selected) {
  const entries = execFileSync('unzip', ['-Z1', artifactPath], { encoding: 'utf8' });
  const templates = [...new Set([...entries.matchAll(/(?:^|\n)(?:jcr_root\/)?(conf\/[^/\s]+\/settings\/wcm\/templates\/[^/\s]+)\/\.content\.xml(?=\n|$)/g)]
    .map((m) => '/' + m[1]))].sort();
  if (selected && !TEMPLATE_PREFIX.test(selected)) throw new Error('Invalid --template: expected /conf/<site>/settings/wcm/templates/<name>');
  return selected ? templates.filter((p) => p === selected) : templates;
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

// Read META-INF/MANIFEST.MF from a jar, unfolding continuation lines.
function readJarManifest(jarPath) {
  try {
    const mf = execFileSync('unzip', ['-p', jarPath, 'META-INF/MANIFEST.MF'], { encoding: 'utf8' });
    return mf.replace(/\r?\n /g, '');
  } catch { return ''; }
}

// Legacy DAM API class that migrated bundles must no longer reference.
const LEGACY_ASSET_MANAGER = 'com.day.cq.dam.api.AssetManager';

// True when a jar's compiled classes reference `fqcn`. OSGi Import-Package is
// package-granular (it lists `com.day.cq.dam.api`, not the class), so class
// usage is detected from the constant-pool internal name in the bytecode.
function jarReferencesClass(jarPath, fqcn) {
  try {
    const buf = execFileSync('unzip', ['-p', jarPath, '*.class'], { maxBuffer: 128 * 1024 * 1024 });
    return referencesClassName(buf, fqcn);
  } catch { return false; }
}

function referencesClassName(buf, fqcn) {
  const needle = fqcn.replace(/\./g, '/');
  return Buffer.isBuffer(buf) ? buf.includes(needle) : String(buf).includes(needle);
}

// True when `pkg` (or a sub-package of it) appears in the manifest's
// Import-Package header only — never bleeding into Export-Package or other
// headers, and never matching a sibling package by prefix.
function manifestImportsPackage(manifest, pkg) {
  const header = (manifest.match(/^Import-Package:[ \t]*(.*)$/m) || [])[1] || '';
  const escaped = pkg.replace(/[.]/g, '\\.');
  return new RegExp(`(^|,)\\s*${escaped}(\\.[A-Za-z0-9_$.]+)?\\s*(;|,|$)`).test(header);
}

// Extract the job.topics value from a single DS component descriptor.
function topicFromDescriptor(xml) {
  const property = descriptorProperty(xml, 'job.topics');
  return property.values.length ? property.values.join(', ') : null;
}

function descriptorAttributes(text) {
  const attributes = {};
  for (const match of text.matchAll(/([\w.:-]+)\s*=\s*(["'])(.*?)\2/g)) attributes[match[1]] = match[3];
  return attributes;
}

function descriptorProperty(xml, name) {
  const properties = /<(?:[\w.-]+:)?property\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?property\s*>)/g;
  for (const match of xml.matchAll(properties)) {
    const attributes = descriptorAttributes(match[1]);
    if (attributes.name !== name) continue;
    const values = attributes.value === undefined ? (match[2] || '').split(/\r?\n/) : [attributes.value];
    return { present: true, array: attributes.value === undefined, type: attributes.type || 'String', values: values.map((value) => value.trim()).filter(Boolean) };
  }
  return { present: false, array: false, type: 'String', values: [] };
}

function descriptorProvides(xml, service) {
  return [...xml.matchAll(/<(?:[\w.-]+:)?provide\b([^>]*)>/g)].some((match) => descriptorAttributes(match[1]).interface === service);
}

function componentContractFromDescriptor(xml, pattern) {
  const errors = [];
  const checks = {};
  const componentName = descriptorAttributes((xml.match(/<(?:[\w.-]+:)?component\b([^>]*)>/) || [])[1] || '').name;
  const services = {
    scheduler: ['java.lang.Runnable'],
    'event-migration': ['org.apache.sling.event.jobs.consumer.JobConsumer'],
    'resource-change-listener': ['org.apache.sling.api.resource.observation.ResourceChangeListener'],
  }[pattern];
  if (!services.some((service) => descriptorProvides(xml, service))) errors.push(`component must provide ${services.join(' or ')}`);
  const required = {
    scheduler: ['scheduler.expression', 'scheduler.runOn'],
    'event-migration': ['job.topics'],
    'resource-change-listener': ['resource.paths', 'resource.change.types'],
  }[pattern];
  for (const name of required) {
    const property = descriptorProperty(xml, name);
    if (!property.values.length || property.type !== 'String') errors.push(`${name} must contain nonempty String values`);
    checks[name.replace(/\./g, '_')] = property.values.join(', ');
  }
  if (pattern === 'scheduler') {
    const expression = descriptorProperty(xml, 'scheduler.expression');
    const runOn = descriptorProperty(xml, 'scheduler.runOn');
    const concurrent = descriptorProperty(xml, 'scheduler.concurrent');
    if (expression.array || expression.values.length !== 1) errors.push('scheduler.expression must have one scalar value');
    if (runOn.array || runOn.values.length !== 1 || !['SINGLE', 'LEADER'].includes(runOn.values[0])) errors.push('scheduler.runOn must be scalar SINGLE or LEADER');
    if (concurrent.present && (concurrent.array || concurrent.type !== 'Boolean' || concurrent.values.length !== 1 || !['true', 'false'].includes(concurrent.values[0]))) errors.push('scheduler.concurrent must be a scalar Boolean true or false');
    checks.scheduler_concurrent = concurrent.present ? concurrent.values.join(', ') : 'default';
  }
  if (pattern === 'resource-change-listener') {
    const changeTypes = descriptorProperty(xml, 'resource.change.types').values;
    if (changeTypes.some((value) => !['ADDED', 'CHANGED', 'REMOVED', 'PROVIDER_ADDED', 'PROVIDER_REMOVED'].includes(value))) errors.push('resource.change.types contains an unsupported change type');
  }
  return { errors, checks, componentName };
}

function sourceContractFailure(discovered) {
  if (!discovered.contract) {
    return { result: 'fail', failure_class: FAILURE_CLASSES.UNKNOWN, verification_level: 'source-only', evidence: 'built DS contract evidence unavailable; rerun --stage prepare with the same pattern and class scope' };
  }
  if (!discovered.contract.errors.length) return null;
  return { result: 'fail', failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH, verification_level: 'source-only', evidence: discovered.contract.errors.join('; '), checks: discovered.contract.checks };
}

// Read the ResourceChangeListener contract flags from a DS component descriptor.
function rclFlagsFromDescriptor(xml) {
  return {
    hasPaths: descriptorProperty(xml, 'resource.paths').values.length > 0,
    hasChangeTypes: descriptorProperty(xml, 'resource.change.types').values.length > 0,
  };
}

// Return the DS descriptor xml whose component name === fqcn, or '' if none.
function dsDescriptorFor(jarPath, fqcn) {
  for (const [, xml] of jarDsDescriptors(jarPath)) {
    const nm = xml.match(/<scr:component[^>]*name="([^"]+)"/) || xml.match(/name="([^"]+)"/);
    const implementation = descriptorAttributes((xml.match(/<(?:[\w.-]+:)?implementation\b([^>]*)>/) || [])[1] || '').class;
    if ((nm && nm[1] === fqcn) || implementation === fqcn) return xml;
  }
  return '';
}

// ---- MCP-based diagnosis (AEM Quickstart MCP server, diagnose-osgi-bundle) ----
// The skill (agent) invokes the `diagnose-osgi-bundle` MCP tool on the
// agent-configured AEM Quickstart MCP server and writes a JSON map
//     { "<Bundle-SymbolicName>": "<raw tool text output>" }
// to `.validate-migration/diagnosis-map.json` (or a path passed via
// `--diagnosis-map <file>`). This script does not speak MCP itself — that is
// the coding-assistant's job.
//
// When a BSN is not in the map, verification for that task fails with
// `setup.mcp_unavailable` and the outcome carries setup guidance. There is no
// silent Felix Web Console fallback.
let diagnosisMap; // undefined = not yet loaded, {} = loaded (may be empty)
const diagnosisCache = new Map(); // BSN -> parsed diagnosis, per run

function loadDiagnosisMap(args) {
  if (diagnosisMap !== undefined) return diagnosisMap;
  const explicit = args && args['diagnosis-map'];
  const baseDir = (args && args.project) || process.cwd();
  const candidates = [
    explicit,
    path.join(baseDir, '.validate-migration', 'diagnosis-map.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (parsed && typeof parsed === 'object') { diagnosisMap = parsed; return diagnosisMap; }
    } catch { /* try next */ }
  }
  diagnosisMap = {};
  return diagnosisMap;
}

// Returns { bundle_state, found, components: Map<fqcn, {state}>, source, available }.
// `available: false` means the agent has not supplied MCP diagnosis for this
// BSN — callers must fail with SETUP_MCP_UNAVAILABLE + setup guidance.
async function getBundleDiagnosis({ bundleBSN, args }) {
  if (diagnosisCache.has(bundleBSN)) return diagnosisCache.get(bundleBSN);
  const map = loadDiagnosisMap(args);
  const raw = map[bundleBSN];
  if (raw == null) {
    const missing = { available: false };
    diagnosisCache.set(bundleBSN, missing);
    return missing;
  }
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const parsed = parseBundleDiagnosticReport(text);
  parsed.available = true;
  parsed.source = 'mcp';
  diagnosisCache.set(bundleBSN, parsed);
  return parsed;
}

function mcpUnavailableOutcome(bundleBSN) {
  return {
    result: 'fail',
    failure_class: FAILURE_CLASSES.SETUP_MCP_UNAVAILABLE,
    bundle_state: 'Unknown',
    component_state: 'Unknown',
    evidence: `no MCP diagnose-osgi-bundle output for ${bundleBSN}. `
      + `Have the coding assistant call the AEM Quickstart MCP tool `
      + `\`diagnose-osgi-bundle\` for this bundle and write the raw text output `
      + `into .validate-migration/diagnosis-map.json as { "${bundleBSN}": "..." }, `
      + `then re-run \`node ../../validate-migration/check.js --stage verify\`.`,
  };
}

// The diagnostic tool returns free text, not JSON. Unrecognized shapes map to
// 'Unknown' rather than a guessed 'Active', so a parse miss fails safe.
// State is normalized to title case ('Active', 'Installed', 'Resolved') because
// the OSGi runtime and Sling's diagnostic report both use upper case ('ACTIVE'),
// while Felix's JSON and the rest of validate-migration use title case.
function parseBundleDiagnosticReport(text) {
  const components = parseComponentsFromReport(text);
  // Bundle State: appears before the DS components section — scope the search
  // there so a component's own State: line isn't read as the bundle's, and so
  // "reference … not found" in an Active report isn't misread as not-installed.
  const dsIdx = text.indexOf('Declarative Services Components');
  const bundleText = dsIdx === -1 ? text : text.slice(0, dsIdx);
  const stateLine = bundleText.match(/State:\s*([A-Za-z]+)/);
  if (stateLine) return { bundle_state: normalizeState(stateLine[1]), found: true, components };
  if (/no such bundle|not found|not installed/i.test(bundleText)) return { bundle_state: 'Unknown', found: false, components };
  if (/INSTALLED but not RESOLVED/i.test(bundleText)) return { bundle_state: 'Installed', found: true, components };
  if (/\bACTIVE\b/i.test(bundleText) && !/not RESOLVED|not ACTIVE|unsatisfied/i.test(bundleText)) return { bundle_state: 'Active', found: true, components };
  return { bundle_state: 'Unknown', found: true, components };
}

// Parses the `--- Declarative Services Components ---` section of the report
// into a Map<fqcn, {state}>. Only states are exposed today; component
// properties are a documented MCP gap (tracked upstream).
function parseComponentsFromReport(text) {
  const out = new Map();
  const start = text.indexOf('Declarative Services Components');
  if (start === -1) return out;
  const body = text.slice(start);
  const re = /Component:\s*([^\r\n]+)\r?\n\s*State:\s*([A-Za-z]+)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.set(m[1].trim(), { state: normalizeState(m[2]) });
  }
  return out;
}

function normalizeState(s) {
  if (!s) return 'Unknown';
  const lc = String(s).toLowerCase();
  return lc.charAt(0).toUpperCase() + lc.slice(1);
}

function step(name) { console.log(`▸ ${name}`); }
function fatal(msg) { console.error(msg); process.exit(2); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Decide whether prepare stops before verify, and the exit code if it does.
// `--stage prepare` completing is success (0); an `all` run that stops early
// (bundle-runtime tasks, no diagnosis map) verified nothing → 3 (incomplete).
function prepareStopDecision(stage, bundleTaskCount, hasDiagnosisMap) {
  const stop = stage === 'prepare' || (bundleTaskCount > 0 && !hasDiagnosisMap);
  return { stop, exitCode: stage === 'prepare' ? 0 : 3 };
}

// Classify one dialog's XML. Coral 2 vs 3 differ by field type, not the shared
// dialog root: coral 2 = granite/ui/components/foundation/, coral 3 inserts /coral/.
function classifyDialog(xml) {
  if (/\bxtype\s*=\s*"/.test(xml)) return 'classic';
  if (/sling:resourceType\s*=\s*"granite\/ui\/components\/foundation\//.test(xml)) return 'coral2';
  if (/sling:resourceType\s*=\s*"granite\/ui\/components\/coral\/foundation/.test(xml)) return 'coral3';
  return 'other';
}

// Auto mode passes task.files (the branch diff); scope discovered dialogs to
// those. Explicit --pattern has no task.files → scan the whole package.
function scopeToChangedFiles(dialogs, task) {
  if (!task || !Array.isArray(task.files) || !task.files.length) return dialogs;
  const changed = task.files.map((f) => f.replace(/\\/g, '/'));
  return dialogs.filter((d) => changed.some((f) => f.endsWith(d)));
}

// Remove the default diagnosis map so a fresh prepare can't leave stale data.
function clearDiagnosisMap(baseDir) {
  fs.rmSync(path.join(baseDir, '.validate-migration', 'diagnosis-map.json'), { force: true });
}

// Aggregates every task's outcome record into one run, prints it, emits the
// MCP payload once for the whole run; passing runs await acknowledgement.
function finishAll(records, args) {
  // Each template is an independent run/receipt: a failed sibling cannot make
  // another template look passed or prevent its outcome from being submitted.
  if (records.length > 1 || records.some((r) => r.pattern === 'custom-templates')) {
    const finishedAt = new Date().toISOString();
    const runBase = Date.now() * 1000;
    for (const [index, outcome] of records.entries()) {
      const record = { run_id: `rvc-${runBase + index}`, started_at: RUN_STARTED_AT || finishedAt, finished_at: finishedAt,
        result: outcome.result, verification_level: outcome.verification_level || 'runtime',
        classes: [{ ...outcome, checks: validationChecks(outcome) }], reporting: { status: 'pending' } };
      const report = writeLocalReport(record, args.project || process.cwd());
      console.log(`\n${outcome.discovered?.template || outcome.pattern}: ${outcome.result}; local report: ${report.mdPath}`);
      if (args['project-id'] || args['project-name']) {
        console.log('\n=== submit-migration-validation-result payload ===');
        console.log(JSON.stringify(buildMcpPayload(record, args)));
        console.log('=== end payload ===');
      } else console.log(camReportingNote(args));
    }
    process.exit(records.some((r) => r.result === 'fail') ? 1 : 3);
  }
  const finishedAt = new Date().toISOString();
  const record = {
    run_id: 'rvc-' + Date.now(),
    started_at: RUN_STARTED_AT || finishedAt,
    finished_at: finishedAt,
    result: records.some((r) => r.result === 'fail') ? 'fail' : 'pass',
    verification_level: records.some((r) => r.verification_level === 'runtime') ? 'runtime' : 'source-only',
    classes: records.map((outcome) => ({ ...outcome, checks: validationChecks(outcome) })),
    reporting: { status: 'pending' },
  };
  console.log('=== outcome ===');
  console.log(JSON.stringify(record, null, 2));

  // Always leave a local record next to the code, even when no CAM project is linked.
  const cwd = (args && args.project) || process.cwd();
  const report = writeLocalReport(record, cwd);
  console.log(`\nlocal report: ${report.mdPath}`);

  // Emit the submit-migration-validation-result payload when a CAM project (id or name) is available.
  // The agent submits this block through MCP and finalizes with its receipt.
  if (args && (args['project-id'] || args['project-name'])) {
    const payload = buildMcpPayload(record, args);
    console.log('\n=== submit-migration-validation-result payload ===');
    console.log(JSON.stringify(payload));
    console.log('=== end payload ===');
  } else {
    console.log(`\n${camReportingNote(args)}`);
  }

  console.log('\ncompletion: incomplete — save the MCP acknowledgement and run --stage finalize');
  process.exit(record.result === 'pass' ? 3 : 1);
}

// Human- and machine-readable record written to <project>/.validate-migration/<run_id>.{md,json}.

function parseArgs(argv) {
  const out = {};
  if (argv[0] && !argv[0].startsWith('--')) out.pattern = argv[0];
  const rest = out.pattern ? argv.slice(1) : argv;
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const k = rest[i].replace(/^--/, '');
    out[k] = rest[++i];
  }
  return out;
}

// ---- CAM project link (from migration-runbook.json written by the analyze / migration skill) ----
// Shape in that file: { project: { id: string, name?: string }, ... }
// Nearest migration-runbook.json wins, searching up from the project so a module (core/) finds the repo-root one.
function readContext(args) {
  let dir = path.resolve((args && args.project) || process.cwd());
  for (let i = 0; i < 6; i++) {
    const runbookPath = path.join(dir, 'migration-runbook.json');
    if (fs.existsSync(runbookPath)) {
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(runbookPath, 'utf8')); } catch { return {}; }
      const project = parsed && parsed.project;
      if (!project || !project.id) return {};
      return { projectId: project.id, projectName: project.name || undefined };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}


if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(2); });
}

module.exports = {
  PATTERNS,
  readContext,
  camReportingNote,
  classifyDialog,
  clearDiagnosisMap,
  prepareStopDecision,
  parseBundleDiagnosticReport,
  parseComponentsFromReport,
  normalizeState,
  mcpUnavailableOutcome,
  buildMcpPayload,
  renderLocalReport,
  writeLocalReport,
  finalizeReporting,
  toClassEntry,
  stripEmpty,
  truncate,
  parseArgs,
  manifestImportsPackage,
  referencesClassName,
  topicFromDescriptor,
  rclFlagsFromDescriptor,
  discoverTemplates,
};
