/**
 * Mock for @adobe/aio-lib-files — App Builder Files SDK
 *
 * Usage: Copy the jest.mock() block below into your test file BEFORE requiring
 * the action under test.
 *
 * The mock provides a full mock of the Files SDK with sensible defaults.
 * Customize return values per test using mockResolvedValueOnce().
 */

// --- Mock instance (exported for assertion access) ---
const mockFilesInstance = {
  read: jest.fn().mockResolvedValue(Buffer.from('mock-file-content')),
  write: jest.fn().mockResolvedValue('path/to/written-file'),
  delete: jest.fn().mockResolvedValue(true),
  list: jest.fn().mockResolvedValue([
    { name: 'file1.txt', size: 1024, lastModified: '2024-01-01T00:00:00Z' },
    { name: 'file2.json', size: 512, lastModified: '2024-01-02T00:00:00Z' },
  ]),
  generatePresignURL: jest.fn().mockResolvedValue(
    'https://storage.adobe.io/presigned/mock-url?token=abc123'
  ),
  copy: jest.fn().mockResolvedValue('path/to/copied-file'),
};

// --- Jest mock setup ---
jest.mock('@adobe/aio-lib-files', () => ({
  init: jest.fn().mockResolvedValue(mockFilesInstance),
}));

// --- Helper to reset between tests ---
function resetFilesMock() {
  jest.clearAllMocks();
}

module.exports = { mockFilesInstance, resetFilesMock };
