'use strict';

const { FAILURE_CLASSES } = require('../../failure-classes.js');
const { mcpUnavailableOutcome } = require('./diagnosis.js');

function fail(failure_class, bundle_state, component_state, evidence) {
  return { result: 'fail', failure_class, bundle_state, component_state, evidence };
}

/** Fail outcome when MCP has no report or the bundle is not Active; null otherwise. */
function bundleGate(diagnosis, bundleBSN) {
  if (!diagnosis.available) return mcpUnavailableOutcome(bundleBSN);
  if (!diagnosis.found) return fail(FAILURE_CLASSES.BUNDLE_NOT_INSTALLED, diagnosis.bundle_state, 'Unknown', `bundle ${bundleBSN} not found on SDK`);
  if (diagnosis.bundle_state !== 'Active') return fail(FAILURE_CLASSES.BUNDLE_NOT_ACTIVE, diagnosis.bundle_state, 'Unknown', `bundle state=${diagnosis.bundle_state}`);
  return null;
}

/** On an Active bundle: `{ failure }` when the component is missing or inactive, else `{ state }`. */
function componentGate(diagnosis, name, { allowSatisfied = false } = {}) {
  const component = diagnosis.components.get(name);
  if (!component) {
    return { failure: fail(FAILURE_CLASSES.COMPONENT_UNSATISFIED, 'Active', 'Unknown', `component ${name} not present in MCP diagnose-osgi-bundle report`) };
  }
  const state = component.state || 'Unknown';
  if (state === 'Active' || (allowSatisfied && state === 'Satisfied')) return { state };
  return { failure: fail(FAILURE_CLASSES.ACTIVATION_ERROR, 'Active', state, `component_state=${state}`) };
}

module.exports = { bundleGate, componentGate };
