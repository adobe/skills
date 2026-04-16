/**
 * Integration test template for deployed App Builder actions.
 *
 * Prerequisites:
 *   1. Action must be deployed: run `aio app deploy` first
 *   2. CLI must be authenticated: run `aio auth login`
 *   3. Correct workspace selected: run `aio app use` if needed
 *
 * Usage:
 *   1. Copy this file to test/integration/<action-name>.integration.test.js
 *   2. Replace <action-name> with the actual action name
 *   3. Update the params and assertions for your action
 *   4. Run: npx jest test/integration/ --testPathPattern=integration
 *
 * NOTE: These tests invoke REAL deployed actions. They are NOT meant to run
 * in the default `npm test` — separate them with a test path pattern or tag.
 */

const { execFileSync } = require('child_process');

/**
 * Helper to invoke a deployed action via aio CLI.
 * Uses execFileSync with array args to avoid shell injection.
 * @param {string} actionName - The action name as registered in the manifest
 * @param {Object} params - Parameters to pass to the action
 * @returns {Object} The action result (parsed JSON)
 */
function invokeAction(actionName, params = {}) {
  const args = ['rt', 'action', 'invoke', actionName, '--result'];

  for (const [key, value] of Object.entries(params)) {
    args.push('-p', key, String(value));
  }

  try {
    const output = execFileSync('aio', args, {
      encoding: 'utf-8',
      timeout: 30000, // 30s timeout for action invocation
    });
    return JSON.parse(output);
  } catch (error) {
    // If the action returns an error, it may still be valid JSON
    try {
      return JSON.parse(error.stdout || error.stderr);
    } catch {
      throw new Error(`Action invocation failed: ${error.message}`);
    }
  }
}

describe('<action-name> integration tests', () => {
  const ACTION_NAME = '<package>/<action-name>';

  // Increase timeout for network calls to deployed actions
  jest.setTimeout(60000);

  test('responds with 200 and expected body for valid input', () => {
    const result = invokeAction(ACTION_NAME, {
      // TODO: Add valid params for your action
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toBeDefined();
    // TODO: Add action-specific response assertions
    // expect(result.body).toHaveProperty('expectedField');
  });

  test('responds with 400 for missing required params', () => {
    const result = invokeAction(ACTION_NAME, {
      // Deliberately omit required params
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error).toBeDefined();
  });

  test('responds within acceptable latency', () => {
    const start = Date.now();

    invokeAction(ACTION_NAME, {
      // TODO: Add valid params
    });

    const duration = Date.now() - start;
    // Adjust threshold based on expected action complexity
    expect(duration).toBeLessThan(10000); // 10 seconds
  });
});
