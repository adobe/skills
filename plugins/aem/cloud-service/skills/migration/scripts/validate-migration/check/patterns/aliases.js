'use strict';

// Pattern names used by the migration runbook and the CAM BPA tools, mapped to
// validator patterns. Validator names stay canonical: they are the values the
// submit-migration-validation-result tool accepts.
const ALIASES = Object.freeze({
  assetApi: 'asset-manager',
  resourceChangeListener: 'resource-change-listener',
  eventListener: 'event-migration',
  eventHandler: 'event-migration',
  lui: 'legacy-ui',
  luiCoral2: 'legacy-ui',
  templateModernization: 'custom-templates',
});

/** Returns the validator pattern for a migration/BPA pattern name; other names pass through. */
function canonicalPattern(name) {
  return Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
}

module.exports = { ALIASES, canonicalPattern };
