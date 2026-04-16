/**
 * Unit test boilerplate for App Builder actions (CommonJS).
 *
 * Usage:
 *   1. Copy this file to test/actions/<action-name>/index.test.js
 *   2. Replace <action-name> with the actual action name
 *   3. Update the require path to point to the action source
 *   4. Add/remove mocks based on the action's SDK dependencies (see references/mock-catalog.md)
 *   5. Add action-specific params and assertions
 *
 * Run: npx jest test/actions/<action-name>/index.test.js --coverage
 */

// --- Mock dependencies BEFORE requiring the action ---

jest.mock('@adobe/aio-sdk', () => ({
  Core: {
    Logger: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

// Add more mocks here based on the action's dependencies:
// jest.mock('@adobe/aio-lib-state', () => ({ init: jest.fn().mockResolvedValue({...}) }));
// jest.mock('@adobe/aio-lib-files', () => ({ init: jest.fn().mockResolvedValue({...}) }));
// jest.mock('node-fetch', () => jest.fn());

// --- Require the action under test ---

// NOTE: Path varies by extension type (e.g., dx-excshell-1, aem-cf-console-admin-1, dx-asset-compute-worker-1).
// Adjust the path below to match your project's extension folder.
const action = require('../../src/dx-excshell-1/actions/<action-name>/index.js');

// --- Tests ---

describe('<action-name>', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 200 with valid params', async () => {
    const params = {
      __ow_headers: {
        authorization: 'Bearer test-token',
        'x-gw-ims-org-id': 'test-org-id',
      },
      LOG_LEVEL: 'info',
      // TODO: Add action-specific required params here
    };

    const result = await action.main(params);

    expect(result).toBeDefined();
    expect(result.statusCode).toBe(200);
    expect(result.body).toBeDefined();
  });

  test('returns 400 when required param is missing', async () => {
    const params = {
      __ow_headers: {
        authorization: 'Bearer test-token',
      },
      // Deliberately omit required params
    };

    const result = await action.main(params);

    expect(result.statusCode).toBe(400);
    expect(result.body).toBeDefined();
    expect(result.body.error).toBeDefined();
  });

  test('returns 401 when authorization header is missing', async () => {
    const params = {
      __ow_headers: {},
      LOG_LEVEL: 'info',
    };

    const result = await action.main(params);

    // Action may return 401 or 403 depending on auth implementation
    expect([401, 403]).toContain(result.statusCode);
  });

  test('returns 500 on unexpected SDK failure', async () => {
    // Configure a mock to reject — adjust based on which SDK the action uses
    // Example for State SDK:
    // const { init } = require('@adobe/aio-lib-state');
    // init.mockRejectedValueOnce(new Error('SDK init failed'));

    const params = {
      __ow_headers: {
        authorization: 'Bearer test-token',
      },
      LOG_LEVEL: 'info',
      // TODO: Add valid params so the error comes from the SDK, not validation
    };

    const result = await action.main(params);

    expect(result.statusCode).toBe(500);
    expect(result.body).toBeDefined();
    expect(result.body.error).toBeDefined();
  });
});
