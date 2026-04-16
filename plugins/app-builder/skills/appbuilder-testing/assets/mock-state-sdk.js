/**
 * Mock for @adobe/aio-lib-state — App Builder State SDK
 *
 * Usage: Copy the jest.mock() block below into your test file BEFORE requiring
 * the action under test.
 *
 * The mock provides a full in-memory mock of the State SDK with common defaults.
 * Customize return values per test using mockResolvedValueOnce().
 */

// --- In-memory store for stateful testing (optional) ---
const memoryStore = new Map();

// --- Mock instance (exported for assertion access) ---
const mockStateInstance = {
  get: jest.fn().mockImplementation(async (key) => {
    const value = memoryStore.get(key);
    return value !== undefined ? { value, expiration: null } : undefined;
  }),
  put: jest.fn().mockImplementation(async (key, value, options) => {
    memoryStore.set(key, value);
    return key;
  }),
  delete: jest.fn().mockImplementation(async (key) => {
    memoryStore.delete(key);
    return key;
  }),
  deleteAll: jest.fn().mockImplementation(async () => {
    memoryStore.clear();
    return true;
  }),
  list: jest.fn().mockResolvedValue({ keys: [], cursor: null }),
};

// --- Jest mock setup ---
jest.mock('@adobe/aio-lib-state', () => ({
  init: jest.fn().mockResolvedValue(mockStateInstance),
}));

// --- Helper to reset store between tests ---
function resetStateStore() {
  memoryStore.clear();
  jest.clearAllMocks();
}

module.exports = { mockStateInstance, resetStateStore, memoryStore };
