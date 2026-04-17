# SPA Routing Patterns

React Router integration for App Builder SPAs running inside the Experience Cloud Shell.

## Setup

App Builder SPAs use `react-router-dom` for client-side routing. The shell manages the outer navigation; the SPA manages its own internal routes.

```bash
npm install react-router-dom
```

## Basic Router Configuration

Use `HashRouter` (not `BrowserRouter`) inside the ExC Shell — the shell controls the URL path, so the SPA uses hash-based routing to avoid conflicts.

```jsx
import { HashRouter, Routes, Route } from 'react-router-dom';
import { defaultTheme, Provider } from '@adobe/react-spectrum';

function App({ shellContext }) {
  return (
    <Provider theme={defaultTheme} locale={shellContext.locale}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </HashRouter>
    </Provider>
  );
}
```

**Why HashRouter:** The Experience Cloud Shell owns the browser URL path. `BrowserRouter` would conflict with the shell's routing. `HashRouter` uses `#/path` which stays within the iframe.

## Navigation Components

### With React Spectrum Tabs

```jsx
import { Tabs, TabList, TabPanels, Item } from '@adobe/react-spectrum';
import { useNavigate, useLocation } from 'react-router-dom';

function NavigationTabs() {
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { id: '/', label: 'Dashboard' },
    { id: '/products', label: 'Products' },
    { id: '/settings', label: 'Settings' }
  ];

  return (
    <Tabs
      aria-label="App sections"
      selectedKey={location.pathname}
      onSelectionChange={(key) => navigate(key)}
    >
      <TabList>
        {tabs.map(tab => <Item key={tab.id}>{tab.label}</Item>)}
      </TabList>
    </Tabs>
  );
}
```

### With React Spectrum Breadcrumbs

```jsx
import { Breadcrumbs, Item } from '@adobe/react-spectrum';
import { useNavigate } from 'react-router-dom';

function AppBreadcrumbs({ items }) {
  const navigate = useNavigate();

  return (
    <Breadcrumbs onAction={(key) => navigate(key)}>
      {items.map(item => (
        <Item key={item.path}>{item.label}</Item>
      ))}
    </Breadcrumbs>
  );
}

// Usage:
<AppBreadcrumbs items={[
  { path: '/', label: 'Home' },
  { path: '/products', label: 'Products' },
  { path: `/products/${id}`, label: productName }
]} />
```

## Layout with Sidebar Navigation

```jsx
import { Flex, View, ActionButton } from '@adobe/react-spectrum';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'Dashboard', icon: <HomeIcon /> },
    { path: '/products', label: 'Products', icon: <BoxIcon /> },
    { path: '/settings', label: 'Settings', icon: <GearIcon /> }
  ];

  return (
    <Flex direction="row" height="100vh">
      <View
        backgroundColor="gray-100"
        padding="size-200"
        width="size-3000"
        borderEndWidth="thin"
        borderEndColor="gray-300"
      >
        <Flex direction="column" gap="size-100">
          {navItems.map(item => (
            <ActionButton
              key={item.path}
              isQuiet={location.pathname !== item.path}
              onPress={() => navigate(item.path)}
            >
              {item.icon} {item.label}
            </ActionButton>
          ))}
        </Flex>
      </View>
      <View flex padding="size-400">
        <Outlet />
      </View>
    </Flex>
  );
}
```

## Passing Shell Context to Routes

Pass shell context (IMS token, org) down to route components that need it:

```jsx
import { createContext, useContext } from 'react';

const ShellContext = createContext({});

export function useShellContext() {
  return useContext(ShellContext);
}

// In App.jsx:
<ShellContext.Provider value={shellContext}>
  <HashRouter>
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/products" element={<Products />} />
      </Route>
    </Routes>
  </HashRouter>
</ShellContext.Provider>
```

Then in any page component:
```jsx
function Products() {
  const { imsToken, imsOrg } = useShellContext();
  // Use token to call backend actions
}
```

## Common Pitfalls

1. **Using BrowserRouter** — Breaks inside ExC Shell iframe. Always use `HashRouter`.
2. **Not handling 404** — Add a catch-all `<Route path="*">` for unknown paths.
3. **Losing shell context on navigation** — Use React Context to share shell data across routes.
4. **Deep linking issues** — Hash routes work for bookmarking (`#/products/123`), but the shell may not restore them after a full page reload.
