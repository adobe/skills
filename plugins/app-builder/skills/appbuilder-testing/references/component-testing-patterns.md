# Component Testing Patterns — React Spectrum + Jest + Testing Library

Testing React Spectrum UI components in App Builder requires specific patterns because Spectrum components rely on a theme Provider and render using ARIA roles rather than visible text.

## a. Setup

Install test dependencies (if not already present):

```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

**Jest configuration** — Add JSX transform support. In `jest.config.js` or `package.json`:

```json
{
  "jest": {
    "testEnvironment": "jsdom",
    "transform": {
      "\\.[jt]sx?$": ["babel-jest", { "presets": ["@babel/preset-env", "@babel/preset-react"] }]
    },
    "moduleNameMapper": {
      "\\.(css|less|scss)$": "<rootDir>/test/__mocks__/styleMock.js"
    }
  }
}
```

Create `test/__mocks__/styleMock.js` to handle CSS imports from Spectrum:

```javascript
module.exports = {};
```

## b. Provider Wrapping — The #1 Gotcha

**Every test must wrap the component in `<Provider theme={defaultTheme}>`** or Spectrum components render nothing — no DOM output, no ARIA roles, no text.

### The reusable helper

```javascript
const React = require('react');
const { render } = require('@testing-library/react');
const { Provider, defaultTheme } = require('@adobe/react-spectrum');

function renderWithSpectrum(ui) {
  return render(
    React.createElement(Provider, { theme: defaultTheme }, ui)
  );
}
```

### What happens without it

```javascript
// ❌ BAD — renders empty, all queries return null
render(React.createElement(MyButton, { label: 'Save' }));
screen.getByRole('button'); // throws — no button found!

// ✅ GOOD — Spectrum renders correctly with ARIA roles
renderWithSpectrum(React.createElement(MyButton, { label: 'Save' }));
screen.getByRole('button', { name: 'Save' }); // found!
```

## c. Shell Context Mocking (`@adobe/exc-app`)

Components that use shell context (IMS token, org, runtime) need the shell SDK mocked.

```javascript
const mockRuntime = {
  ready: jest.fn(),
  done: jest.fn(),
  on: jest.fn(),
  imsToken: 'mock-ims-access-token',
  imsOrg: 'mock-ims-org-id@AdobeOrg',
};

jest.mock('@adobe/exc-app', () => ({
  register: jest.fn((cb) => { if (typeof cb === 'function') cb(mockRuntime); }),
  runtime: jest.fn(() => mockRuntime),
}));
```

Use `assets/shell-mock-helper.js` for a full reusable version with `resetMocks()`.

**Common pattern:** Components call `register()` on mount. The mock immediately invokes the callback with `mockRuntime`, so `imsToken` and `imsOrg` are available synchronously.

## d. AEM Extension Guest Mocking (`@adobe/uix-guest`)

Extension components use `register()` or `attach()` to connect to the AEM host.

```javascript
const mockSharedContext = {
  aemHost: 'https://author-p12345-e67890.adobeaemcloud.com',
  imsOrg: 'mock-ims-org-id@AdobeOrg',
  imsToken: 'mock-ims-access-token',
  apiKey: 'mock-api-key',
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

Use `assets/uix-guest-mock-helper.js` for a full reusable version.

## e. Action Call Mocking

Most App Builder UI components call backend actions via `actionWebInvoke` or `fetch()`.

### Mocking `actionWebInvoke`

```javascript
jest.mock('../../../web-src/src/utils', () => ({
  actionWebInvoke: jest.fn(),
}));
const { actionWebInvoke } = require('../../../web-src/src/utils');

// In test — success
actionWebInvoke.mockResolvedValue({ items: [{ id: '1', name: 'Test' }] });

// In test — error
actionWebInvoke.mockRejectedValue(new Error('500 Internal Server Error'));
```

### Mocking `fetch()` directly

```javascript
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ data: 'response' }),
});
```

### Verifying IMS token is passed

```javascript
expect(actionWebInvoke).toHaveBeenCalledWith(
  expect.any(String),           // action URL
  expect.any(Object),           // headers
  expect.objectContaining({
    authorization: expect.stringContaining('Bearer'),
  })
);
```

## f. Async State Testing

UI components typically have three states: loading, success, and error.

### Loading state

```javascript
test('shows loading spinner while fetching', () => {
  actionWebInvoke.mockReturnValue(new Promise(() => {})); // never resolves
  renderWithSpectrum(React.createElement(MyComponent));
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
});
```

### Success state (use `findBy*` or `waitFor`)

```javascript
test('renders data after fetch', async () => {
  actionWebInvoke.mockResolvedValue({ items: [{ id: '1', name: 'Row 1' }] });
  renderWithSpectrum(React.createElement(MyComponent));
  expect(await screen.findByText('Row 1')).toBeInTheDocument();
});
```

### Error state

```javascript
test('shows error message on failure', async () => {
  actionWebInvoke.mockRejectedValue(new Error('Failed'));
  renderWithSpectrum(React.createElement(MyComponent));
  expect(await screen.findByText(/error/i)).toBeInTheDocument();
});
```

**Key rules:**
- Use `findBy*` (returns a promise) for elements that appear after async work.
- Use `waitFor()` when you need to assert on something that _changes_ rather than _appears_.
- Use `queryBy*` when asserting an element does NOT exist (returns null instead of throwing).

## g. React Spectrum ARIA Selector Reference

Spectrum components render as ARIA landmarks. Use `getByRole()` to query them.

| Spectrum Component | ARIA Role | Query Example |
| --- | --- | --- |
| `Button` | `button` | `getByRole('button', { name: 'Save' })` |
| `ActionButton` | `button` | `getByRole('button', { name: 'Edit' })` |
| `TextField` | `textbox` | `getByRole('textbox', { name: 'Email' })` |
| `TextArea` | `textbox` | `getByRole('textbox', { name: 'Notes' })` |
| `Checkbox` | `checkbox` | `getByRole('checkbox', { name: 'Agree' })` |
| `Switch` | `switch` | `getByRole('switch', { name: 'Enable' })` |
| `Picker` (closed) | `button` | `getByRole('button', { name: 'Select...' })` |
| `Picker` (open) | `listbox` | `getByRole('listbox')` |
| `ComboBox` | `combobox` | `getByRole('combobox', { name: 'Search' })` |
| `TableView` | `grid` | `getByRole('grid')` |
| `TableView` rows | `row` | `getAllByRole('row')` |
| `Dialog` | `dialog` | `getByRole('dialog')` |
| `AlertDialog` | `alertdialog` | `getByRole('alertdialog')` |
| `ProgressCircle` | `progressbar` | `getByRole('progressbar')` |
| `Menu` | `menu` | `getByRole('menu')` |
| `MenuItem` | `menuitem` | `getByRole('menuitem', { name: 'Delete' })` |
| `TabList` | `tablist` | `getByRole('tablist')` |
| `Tab` | `tab` | `getByRole('tab', { name: 'Settings' })` |

**Tips:**
- Always use `{ name: '...' }` with role queries to target specific instances.
- `Picker` has two roles: `button` when closed, `listbox` when open. Use `userEvent.click()` on the button first.
- `TableView` header row is also a `row` — use `getAllByRole('row')` and slice off index 0 for data rows.
