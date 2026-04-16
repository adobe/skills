/**
 * Mock for @adobe/aio-lib-db — App Builder Database SDK (MongoDB-compatible)
 *
 * Usage: Copy the jest.mock() block below into your test file BEFORE requiring
 * the action under test.
 *
 * The mock provides a full in-memory mock of the Database SDK with common defaults.
 * Customize return values per test using mockResolvedValueOnce().
 */

// --- In-memory store for stateful testing (optional) ---
const memoryStore = new Map();

// --- Mock collection (exported for assertion access) ---
const mockCollection = {
  insertOne: jest.fn().mockImplementation(async (doc) => {
    const id = doc._id || `mock-${Date.now()}`;
    memoryStore.set(id, { ...doc, _id: id });
    return { insertedId: id };
  }),
  findOne: jest.fn().mockImplementation(async (filter) => {
    if (filter && filter._id) {
      const doc = memoryStore.get(filter._id);
      return doc || null;
    }
    return null;
  }),
  find: jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue([...memoryStore.values()]),
  }),
  updateOne: jest.fn().mockImplementation(async (filter, update) => {
    if (filter && filter._id && memoryStore.has(filter._id)) {
      const existing = memoryStore.get(filter._id);
      const setFields = update.$set || {};
      memoryStore.set(filter._id, { ...existing, ...setFields });
      return { modifiedCount: 1 };
    }
    return { modifiedCount: 0 };
  }),
  deleteOne: jest.fn().mockImplementation(async (filter) => {
    if (filter && filter._id && memoryStore.has(filter._id)) {
      memoryStore.delete(filter._id);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }),
  aggregate: jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue([]),
  }),
};

// --- Mock database instance ---
const mockDb = {
  collection: jest.fn().mockReturnValue(mockCollection),
};

// --- Jest mock setup ---
jest.mock('@adobe/aio-lib-db', () => ({
  init: jest.fn().mockResolvedValue(mockDb),
}));

// --- Helper to reset store between tests ---
function resetMocks() {
  memoryStore.clear();
  jest.clearAllMocks();
}

module.exports = { mockCollection, mockDb, resetMocks, memoryStore };
