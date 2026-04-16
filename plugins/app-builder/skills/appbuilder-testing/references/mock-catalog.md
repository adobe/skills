# Mock Catalog — Adobe SDK Mocks for Jest

Ready-to-use `jest.mock()` setups for all common Adobe App Builder SDK dependencies. Copy the relevant mock block into your test file **before** `require()`-ing the action under test.

## @adobe/aio-lib-state

State SDK for ephemeral key-value storage.

```javascript
const mockStateInstance = {
  get: jest.fn().mockResolvedValue({ value: 'stored-data', expiration: null }),
  put: jest.fn().mockResolvedValue('key'),
  delete: jest.fn().mockResolvedValue('key'),
  deleteAll: jest.fn().mockResolvedValue(true),
  list: jest.fn().mockResolvedValue({ keys: ['key1', 'key2'], cursor: null }),
};
jest.mock('@adobe/aio-lib-state', () => ({
  init: jest.fn().mockResolvedValue(mockStateInstance),
}));
```

**Common assertions:**
- `expect(mockStateInstance.get).toHaveBeenCalledWith('expected-key')`
- `expect(mockStateInstance.put).toHaveBeenCalledWith('key', 'value', { ttl: 3600 })`

**Pitfalls:**
- `get()` returns `{ value, expiration }`, not the raw value. Asserting against raw string fails.
- `init()` requires no args in tests but needs credentials in production — always mock it.

## @adobe/aio-lib-files

Files SDK for cloud file storage.

```javascript
const mockFilesInstance = {
  read: jest.fn().mockResolvedValue(Buffer.from('file-content')),
  write: jest.fn().mockResolvedValue('file-path'),
  delete: jest.fn().mockResolvedValue(true),
  list: jest.fn().mockResolvedValue([{ name: 'file.txt', size: 100 }]),
  generatePresignURL: jest.fn().mockResolvedValue('https://storage.example.com/presigned'),
  copy: jest.fn().mockResolvedValue('dest-path'),
};
jest.mock('@adobe/aio-lib-files', () => ({
  init: jest.fn().mockResolvedValue(mockFilesInstance),
}));
```

**Common assertions:**
- `expect(mockFilesInstance.write).toHaveBeenCalledWith('path/file.txt', expect.any(Buffer))`
- `expect(mockFilesInstance.generatePresignURL).toHaveBeenCalledWith('path/file.txt', { expiryInSeconds: 600 })`

**Pitfalls:**
- `read()` returns a Buffer, not a string. Use `.toString()` in assertions if comparing text content.
- `generatePresignURL` options include `expiryInSeconds` and `permissions` ('r' or 'rwd').

## @adobe/aio-lib-events

Events SDK for publishing and consuming Adobe I/O Events.

```javascript
const mockEventsInstance = {
  publishEvent: jest.fn().mockResolvedValue('OK'),
  getEventsFromJournal: jest.fn().mockResolvedValue({
    events: [{ event_id: 'evt-1', event: { key: 'value' } }],
    _page: { next: null },
  }),
  getEventsObservableFromJournal: jest.fn(),
};
jest.mock('@adobe/aio-lib-events', () => ({
  init: jest.fn().mockResolvedValue(mockEventsInstance),
}));
```

**Common assertions:**
- `expect(mockEventsInstance.publishEvent).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Object) }))`

**Pitfalls:**
- `init()` requires `orgId`, `apiKey`, `accessToken`, and `providerId` in production — all mocked away in tests.
- Journal responses have `_page.next` for pagination — mock it as `null` for simple tests.

## @adobe/aio-lib-db

Database SDK for MongoDB-compatible document storage.

```javascript
const mockCollection = {
  insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock-id' }),
  findOne: jest.fn().mockResolvedValue({ _id: 'mock-id', name: 'doc' }),
  find: jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue([{ _id: '1', name: 'doc1' }])
  }),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  aggregate: jest.fn().mockReturnValue({
    toArray: jest.fn().mockResolvedValue([])
  }),
};

const mockDb = {
  collection: jest.fn().mockReturnValue(mockCollection),
};

jest.mock('@adobe/aio-lib-db', () => ({
  init: jest.fn().mockResolvedValue(mockDb),
}));
```

**Common assertions:**
- `expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: 'expected-id' })`
- `expect(mockCollection.insertOne).toHaveBeenCalledWith(expect.objectContaining({ name: 'doc' }))`
- `expect(mockCollection.find).toHaveBeenCalledWith(expect.objectContaining({ selector: expect.any(Object) }))`

**Pitfalls:**
- `find()` and `aggregate()` return cursors — call `.toArray()` to get results. Mock both the cursor and `toArray()`.
- `collection()` must be called to get a collection handle before any CRUD operation.
- `init()` requires credentials in production — always mock it in unit tests.

## @adobe/aio-sdk (Combined Entry Point)

The combined SDK re-exports Core (Logger), State, Files, Events, and other libs.

```javascript
jest.mock('@adobe/aio-sdk', () => ({
  Core: {
    Logger: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
  State: { init: jest.fn().mockResolvedValue({ get: jest.fn(), put: jest.fn() }) },
  Files: { init: jest.fn().mockResolvedValue({ read: jest.fn(), write: jest.fn() }) },
  Events: { init: jest.fn().mockResolvedValue({ publishEvent: jest.fn() }) },
}));
```

Use this when the action imports from `@adobe/aio-sdk` directly instead of individual packages.

## @adobe/aio-lib-core-logging (Logger)

Standalone logger mock when not using the combined SDK.

```javascript
jest.mock('@adobe/aio-lib-core-logging', () =>
  jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    close: jest.fn(),
  })
);
```

**Pitfalls:**
- The module itself is a factory function (not an object with `init()`).
- Logger is created with `require('@adobe/aio-lib-core-logging')('action-name', { level: 'info' })`.

## node-fetch

Mock HTTP calls to external APIs.

```javascript
jest.mock('node-fetch', () =>
  jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ data: 'response' }),
    text: jest.fn().mockResolvedValue('response-text'),
    headers: { get: jest.fn().mockReturnValue('application/json') },
  })
);
```

**Common assertions:**
- `expect(fetch).toHaveBeenCalledWith('https://api.example.com/path', expect.objectContaining({ method: 'GET' }))`

**Pitfalls:**
- Mock `ok` property — many actions check `response.ok` before parsing JSON.
- For error testing, mock with `{ ok: false, status: 500, json: ... }`.

## @adobe/exc-app (ExC Shell Context)

Shell SDK for Experience Cloud shell runtime context, IMS tokens, and navigation.

```javascript
const mockRuntime = {
  ready: jest.fn(),
  done: jest.fn(),
  on: jest.fn(),
  imsToken: 'mock-ims-access-token',
  imsOrg: 'mock-ims-org-id@AdobeOrg',
  imsProfile: { name: 'Test User', email: 'test@adobe.com' },
  locale: 'en-US',
  theme: 'light',
};
jest.mock('@adobe/exc-app', () => ({
  register: jest.fn((cb) => { if (typeof cb === 'function') cb(mockRuntime); }),
  runtime: jest.fn(() => mockRuntime),
}));
```

**Common assertions:**
- `expect(mockRuntime.ready).toHaveBeenCalled()` — component called `runtime.ready()` after setup
- `expect(mockRuntime.on).toHaveBeenCalledWith('configuration', expect.any(Function))` — component listens for config changes

**Pitfalls:**
- `register()` is called on app mount and expects a callback — the mock must invoke it synchronously or the component never initializes.
- Components often destructure `imsToken` and `imsOrg` from runtime — ensure both are present in the mock.

See `assets/shell-mock-helper.js` for a full reusable mock with `resetMocks()`.

## @adobe/uix-guest (AEM UIX Guest SDK)

Guest SDK for AEM UI extensibility — used by extension components to connect to the AEM host.

```javascript
const mockSharedContext = {
  aemHost: 'https://author-p12345-e67890.adobeaemcloud.com',
  imsOrg: 'mock-ims-org-id@AdobeOrg',
  imsToken: 'mock-ims-access-token',
  apiKey: 'mock-api-key',
  locale: 'en-US',
  theme: 'light',
};
const mockGuestConnection = {
  sharedContext: {
    get: jest.fn((key) => mockSharedContext[key]),
    getAll: jest.fn(() => mockSharedContext),
  },
  host: {
    modal: { showUrl: jest.fn(), close: jest.fn() },
    toasts: { display: jest.fn() },
  },
};
jest.mock('@adobe/uix-guest', () => ({
  register: jest.fn(() => Promise.resolve(mockGuestConnection)),
  attach: jest.fn(() => Promise.resolve(mockGuestConnection)),
}));
```

**Common assertions:**
- `expect(mockGuestConnection.sharedContext.get).toHaveBeenCalledWith('imsToken')` — component reads IMS token from shared context
- `expect(mockGuestConnection.host.modal.showUrl).toHaveBeenCalledWith(expect.objectContaining({ src: expect.any(String) }))` — component opens a modal

**Pitfalls:**
- `register()` and `attach()` return Promises — component code must `await` them. The mock resolves immediately but async tests still need `waitFor()` or `findBy*`.
- `sharedContext.get()` returns individual values by key; `sharedContext.getAll()` returns the full object. Mock both.
- Extension components often use `attach()` for panels and `register()` for top-level extensions — mock the one your component uses.

See `assets/uix-guest-mock-helper.js` for a full reusable mock with `resetMocks()` and `getCapturedRegistration()`.
