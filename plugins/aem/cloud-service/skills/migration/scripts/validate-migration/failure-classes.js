'use strict';

/**
 * Failure taxonomy — frozen enum.
 *
 * The `submit-migration-validation-result` MCP tool accepts exactly this set of
 * `failure_class` strings. Changing it changes the outcome payload contract.
 */

const FAILURE_CLASSES = Object.freeze({
  INPUT_JAR_MISSING:        'input.jar_missing',
  BUILD_FAILED:             'build.failed',
  DISCOVERY_NO_MATCH:       'discovery.no_pattern_match',
  SDK_UNREACHABLE:          'sdk.unreachable',
  SETUP_MCP_UNAVAILABLE:    'setup.mcp_unavailable',
  DEPLOY_FAILED:            'deploy.failed',

  BUNDLE_NOT_INSTALLED:     'runtime.bundle_not_installed',
  BUNDLE_NOT_ACTIVE:        'runtime.bundle_not_active',
  COMPONENT_UNSATISFIED:    'runtime.component_unsatisfied',
  ACTIVATION_ERROR:         'runtime.activation_error',
  CONTRACT_MISMATCH:        'runtime.contract_mismatch',

  TESTS_FAILED:             'tests.failed',
  SOURCE_CONTRACT_MISMATCH: 'source.contract_mismatch',

  UNKNOWN:                  'unknown',
});

const ALL_FAILURE_CLASSES = Object.freeze(Object.values(FAILURE_CLASSES));

function isFailureClass(value) {
  return typeof value === 'string' && ALL_FAILURE_CLASSES.includes(value);
}

module.exports = { FAILURE_CLASSES, ALL_FAILURE_CLASSES, isFailureClass };
