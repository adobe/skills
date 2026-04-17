/**
 * Mock for @adobe/uix-guest — AEM UI Extension Guest SDK
 *
 * Usage: Copy the jest.mock() block below into your test file BEFORE requiring
 * or importing the extension component under test.
 *
 * Provides mock register() and attach() with shared context values.
 * CommonJS format to match App Builder project conventions.
 */

// --- Mock shared context values ---
const mockSharedContext = {
  aemHost: 'https://author-p12345-e67890.adobeaemcloud.com',
  imsOrg: 'mock-ims-org-id@AdobeOrg',
  imsToken: 'mock-ims-access-token',
  apiKey: 'mock-api-key',
  locale: 'en-US',
  theme: 'light',
};

// --- Mock guest connection ---
const mockGuestConnection = {
  sharedContext: {
    get: jest.fn((key) => mockSharedContext[key]),
    getAll: jest.fn(() => mockSharedContext),
  },
  host: {
    modal: {
      showUrl: jest.fn(),
      close: jest.fn(),
      set: jest.fn(),
    },
    toasts: {
      display: jest.fn(),
    },
    remoteApp: {
      getRemoteAppMetadata: jest.fn().mockResolvedValue({ appId: 'test-app' }),
    },
  },
};

// --- Capture registration for test assertions ---
let capturedRegistration = null;

// --- Jest mock setup ---
jest.mock('@adobe/uix-guest', () => ({
  register: jest.fn((config) => {
    capturedRegistration = config;
    return Promise.resolve(mockGuestConnection);
  }),
  attach: jest.fn((config) => {
    capturedRegistration = config;
    return Promise.resolve(mockGuestConnection);
  }),
}));

// --- Helper to reset mocks between tests ---
function resetMocks() {
  capturedRegistration = null;
  mockGuestConnection.sharedContext.get.mockClear();
  mockGuestConnection.sharedContext.getAll.mockClear();
  jest.clearAllMocks();
}

// --- Helper to get captured registration ---
function getCapturedRegistration() {
  return capturedRegistration;
}

module.exports = {
  mockSharedContext,
  mockGuestConnection,
  resetMocks,
  getCapturedRegistration,
};
