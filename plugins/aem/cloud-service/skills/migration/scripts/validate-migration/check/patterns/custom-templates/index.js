'use strict';

const { execFileSync } = require('child_process');
const { FAILURE_CLASSES } = require('../../../failure-classes.js');
const { verifyTemplateEvidence } = require('./evidence.js');
const { verifyComponentMapping } = require('./mapping.js');
const { discoverTemplates } = require('./discover.js');

module.exports = {
  describe: 'Editable templates (offline source check of the built content package)',
  mode: 'source-only',
  discover: (pkg, task) => {
    const templates = discoverTemplates(pkg, task.template);
    const changed = task.files?.map((f) => f.match(/(?:^|\/)conf\/[^/]+\/settings\/wcm\/templates\/[^/]+/))
      .filter(Boolean).map((m) => '/' + m[0].replace(/^\//, ''));
    const scoped = changed && !task.template ? templates.filter((t) => changed.includes(t)) : templates;
    return scoped.length ? { templates: scoped } : null;
  },
  async verify({ artifactPath, discovered, requireRuntime = false, runtimeEvidencePath, runStartedAt, projectDir, staticTemplate, baselineRef }) {
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
    const mapping = verifyComponentMapping({ artifactPath, template: t, projectDir, staticTemplate, baselineRef });
    checks.component_mapping = mapping.verified ? mapping.ok : 'not_verified';
    if (mapping.verified && !mapping.ok) {
      return { result: 'fail', failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH, bundle_state: null, component_state: null,
        evidence: `${t}: static template ${mapping.staticPath} components missing from editable template: ${mapping.missing.join(', ')}`, checks };
    }
    if (!mapping.verified && requireRuntime) {
      return { result: 'fail', failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH, bundle_state: null, component_state: null,
        evidence: `${t}: ${mapping.reason}; pass --static-template and --baseline-ref`, checks };
    }
    if (requireRuntime || runtimeEvidencePath) {
      const comparison = verifyTemplateEvidence({ artifactPath, template: t, evidencePath: runtimeEvidencePath, runStartedAt });
      return { ...comparison, checks: { ...checks, ...comparison.checks } };
    }
    return { result: 'pass', bundle_state: null, component_state: null, checks,
      ...(!mapping.verified ? { restricted: true, restricted_reason: `component mapping not verified: ${mapping.reason}` } : {}) };
  },
};
