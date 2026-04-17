/**
 * Component test boilerplate for React Spectrum UI (CommonJS + Jest + Testing Library).
 *
 * Usage:
 *   1. Copy this file to test/web-src/components/<ComponentName>.test.js
 *   2. Replace <ComponentName> with the actual component
 *   3. Update the require/import path to point to the component source
 *   4. Add shell or UIX guest mocks if the component depends on them
 *      (see assets/shell-mock-helper.js or assets/uix-guest-mock-helper.js)
 *
 * Prerequisites:
 *   npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event
 *
 * Run: npx jest test/web-src/components/<ComponentName>.test.js --coverage
 */

const React = require('react');
const { render, screen, waitFor } = require('@testing-library/react');
const userEvent = require('@testing-library/user-event').default;
require('@testing-library/jest-dom');
const { Provider, defaultTheme } = require('@adobe/react-spectrum');

// --- Mock backend action calls ---
// Adjust the path to match your project's action utility location.
jest.mock('../../../web-src/src/utils', () => ({
  actionWebInvoke: jest.fn(),
}));
const { actionWebInvoke } = require('../../../web-src/src/utils');

// --- Provider wrapper (THE #1 gotcha) ---
// React Spectrum components render NOTHING without a Provider wrapper.
// Always use this helper instead of bare render().
function renderWithSpectrum(ui) {
  return render(
    React.createElement(Provider, { theme: defaultTheme }, ui)
  );
}

// --- Require the component under test ---
// NOTE: Adjust this path to your component location.
// const MyComponent = require('../../../web-src/src/components/<ComponentName>').default;

describe('<ComponentName>', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows loading state while fetching data', async () => {
    // Keep the action mock pending to capture loading state
    actionWebInvoke.mockReturnValue(new Promise(() => {}));

    // renderWithSpectrum(React.createElement(MyComponent));

    // React Spectrum ProgressCircle renders with role="progressbar"
    // expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  test('renders data on successful fetch', async () => {
    actionWebInvoke.mockResolvedValue({
      items: [{ id: '1', name: 'Item One' }],
    });

    // renderWithSpectrum(React.createElement(MyComponent));

    // Wait for async data to load
    // const row = await screen.findByText('Item One');
    // expect(row).toBeInTheDocument();

    // Verify action was called with IMS token
    // expect(actionWebInvoke).toHaveBeenCalledWith(
    //   expect.any(String),
    //   expect.any(Object),
    //   expect.objectContaining({ authorization: expect.stringContaining('Bearer') })
    // );
  });

  test('shows error state on fetch failure', async () => {
    actionWebInvoke.mockRejectedValue(new Error('Network error'));

    // renderWithSpectrum(React.createElement(MyComponent));

    // Wait for error banner or message to appear
    // const errorMessage = await screen.findByText(/error/i);
    // expect(errorMessage).toBeInTheDocument();
  });
});
