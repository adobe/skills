/**
 * Mock for @adobe/exc-app — Experience Cloud Shell SDK
 *
 * Usage: Copy the jest.mock() block below into your test file BEFORE requiring
 * or importing the component under test.
 *
 * Provides a mock shell runtime with IMS token, org, and configuration callbacks.
 * CommonJS format to match App Builder project conventions.
 */

// --- Mock values ---
const mockImsToken = 'mock-ims-access-token';
const mockImsOrg = 'mock-ims-org-id@AdobeOrg';
const mockImsProfile = { name: 'Test User', email: 'test@adobe.com' };

// --- Mock runtime object ---
const mockRuntime = {
  ready: jest.fn(),
  done: jest.fn(),
  on: jest.fn(),
  imsToken: mockImsToken,
  imsOrg: mockImsOrg,
  imsProfile: mockImsProfile,
  locale: 'en-US',
  theme: 'light',
  historyType: 'browser',
  solution: { title: 'Test App' },
};

// --- Jest mock setup ---
// register() invokes the callback with the mock runtime, simulating shell bootstrap.
jest.mock('@adobe/exc-app', () => ({
  register: jest.fn((cb) => {
    if (typeof cb === 'function') cb(mockRuntime);
  }),
  runtime: jest.fn(() => mockRuntime),
}));

// --- Helper to reset mocks between tests ---
function resetMocks() {
  mockRuntime.ready.mockClear();
  mockRuntime.done.mockClear();
  mockRuntime.on.mockClear();
  jest.clearAllMocks();
}

module.exports = { mockRuntime, mockImsToken, mockImsOrg, mockImsProfile, resetMocks };
