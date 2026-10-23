'use strict';

const { execFileSync } = require('child_process');
const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { discoverDialogs, dialogLabel } = require('../lib/dialogs.js');

const SCAFFOLD = /^jcr_root\/apps\/[^/]+\/components\/granite\/form\/[^/]+\/\.content\.xml$/;
const FIELD_SUPERTYPE = /sling:resourceSuperType="granite\/ui\/components\/coral\/foundation\/form\/field"/;

// Custom Classic Widget removal. Overlaps legacy-ui at the file level (both
// live in dialog XMLs), but asserts the CDW-specific contract: no
// `cq:Widget` nodes and no custom `xtype=` remain. Invoke explicitly
// (`check.js cdw`) — at branch-diff time it is path-indistinguishable from
// legacy-ui, so plan.js auto-classifies shared dialog changes as legacy-ui
// (which already flags remaining xtypes).
module.exports = {
  describe: 'Custom Classic Widgets (ExtJS xtypes) → Coral 3 (offline source check)',
  mode: 'source-only',
  discover: discoverDialogs,
  async verify({ artifactPath, discovered }) {
    const widgetDialogs = [];
    const xtypeDialogs = [];
    for (const p of discovered.dialogs) {
      const xml = execFileSync('unzip', ['-p', artifactPath, p], { encoding: 'utf8' });
      if (/jcr:primaryType\s*=\s*"cq:Widget"/.test(xml)) widgetDialogs.push(p);
      if (/\bxtype\s*=\s*"/.test(xml)) xtypeDialogs.push(p);
    }
    // migration/references/legacy-ui/cdw/validation.md 2.2: scaffolded Granite
    // form components must extend the Coral 3 form field.
    const badScaffolds = execFileSync('unzip', ['-Z1', artifactPath], { encoding: 'utf8' }).split('\n')
      .filter((entry) => SCAFFOLD.test(entry))
      .filter((entry) => !FIELD_SUPERTYPE.test(execFileSync('unzip', ['-p', artifactPath, entry], { encoding: 'utf8' })))
      .map(dialogLabel);
    const remaining = new Set([...widgetDialogs, ...xtypeDialogs]).size;
    if (remaining > 0 || badScaffolds.length > 0) {
      const evidence = [];
      if (remaining > 0) evidence.push(`${widgetDialogs.length} dialog(s) still declare cq:Widget nodes, ${xtypeDialogs.length} still carry xtype= — custom widgets not fully migrated to Coral 3`);
      if (badScaffolds.length) evidence.push(`cdw validation.md 2.2 failed — scaffolded component(s) without the Coral form field supertype: ${badScaffolds.join(', ')}`);
      return {
        result: 'fail',
        failure_class: FAILURE_CLASSES.SOURCE_CONTRACT_MISMATCH,
        bundle_state: null, component_state: null,
        evidence: evidence.join('; '),
        checks: { dialogs_total: discovered.dialogs.length, cq_widget_dialogs: widgetDialogs.length, xtype_dialogs: xtypeDialogs.length,
          scaffold_supertype_failures: badScaffolds.length },
      };
    }
    return {
      result: 'pass',
      bundle_state: null, component_state: null,
      checks: { dialogs_total: discovered.dialogs.length, cq_widget_dialogs: 0, xtype_dialogs: 0 },
    };
  },
};
