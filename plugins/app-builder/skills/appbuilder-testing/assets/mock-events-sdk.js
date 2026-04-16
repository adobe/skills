/**
 * Mock for @adobe/aio-lib-events — Adobe I/O Events SDK
 *
 * Usage: Copy the jest.mock() block below into your test file BEFORE requiring
 * the action under test.
 *
 * The mock provides a full mock of the Events SDK with sensible defaults.
 * Customize return values per test using mockResolvedValueOnce().
 */

// --- Mock instance (exported for assertion access) ---
const mockEventsInstance = {
  publishEvent: jest.fn().mockResolvedValue('OK'),
  getEventsFromJournal: jest.fn().mockResolvedValue({
    events: [
      {
        event_id: 'mock-event-1',
        event: { type: 'mock.event.type', data: { key: 'value' } },
        position: 'pos-1',
      },
    ],
    _page: { next: null },
  }),
  getEventsObservableFromJournal: jest.fn().mockReturnValue({
    subscribe: jest.fn(),
  }),
  getAllEventMetadataForProvider: jest.fn().mockResolvedValue({
    _embedded: {
      eventmetadata: [
        { event_code: 'mock.event.type', label: 'Mock Event', description: 'A mock event' },
      ],
    },
  }),
};

// --- Jest mock setup ---
jest.mock('@adobe/aio-lib-events', () => ({
  init: jest.fn().mockResolvedValue(mockEventsInstance),
}));

// --- Helper to reset between tests ---
function resetEventsMock() {
  jest.clearAllMocks();
}

module.exports = { mockEventsInstance, resetEventsMock };
