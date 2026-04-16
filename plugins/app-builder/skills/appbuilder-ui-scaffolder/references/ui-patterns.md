# UI Patterns

Annotated patterns for common App Builder UI components. The agent reads these patterns and adapts them to the user's project conventions — these are NOT static templates to copy verbatim.

Each pattern includes: when to use, required components, an annotated example, common variations, and pitfalls.

## Page Pattern {#page}

### When to Use

User wants to create a new page or view in the App Builder SPA. This is the container pattern — most other patterns are composed within a page.

### Required Components

```jsx
import { View, Heading, Content, Flex, ProgressCircle } from '@adobe/react-spectrum';
```

### Annotated Example

```jsx
import React, { useState, useEffect } from 'react';
import { View, Heading, Content, Flex, ProgressCircle } from '@adobe/react-spectrum';
import { useShellContext } from '../ShellContext'; // Adapt to project's context pattern

/**
 * Page pattern: View container with heading, loading state, and content area.
 * Adapt: file path, component name, data fetching, and content to user's needs.
 */
function DashboardPage() {
  const { imsToken, imsOrg } = useShellContext();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Adapt: replace with actual action URL and params
    async function loadData() {
      try {
        const res = await fetch(actionUrl, {
          headers: {
            'Authorization': `Bearer ${imsToken}`,
            'x-gw-ims-org-id': imsOrg
          }
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        setData(await res.json());
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [imsToken, imsOrg]);

  if (isLoading) {
    return (
      <Flex alignItems="center" justifyContent="center" height="size-3000">
        <ProgressCircle aria-label="Loading dashboard" isIndeterminate size="L" />
      </Flex>
    );
  }

  // Adapt: add error display with InlineAlert if needed

  return (
    <View padding="size-400">
      <Heading level={1}>Dashboard</Heading>
      <Content marginTop="size-200">
        {/* Adapt: replace with actual page content */}
      </Content>
    </View>
  );
}

export default DashboardPage;
```

### Common Variations

- **Settings page:** Add `Form` inside the content area
- **Detail page:** Add `Breadcrumbs` above the heading for navigation back
- **Multi-section page:** Use `Tabs` to organize content sections

### Pitfalls

- Not showing a loading state during initial data fetch (blank page confuses users)
- Using fixed pixel dimensions instead of Spectrum dimension tokens (`size-*`)
- Forgetting to pass shell context (IMS token) for authenticated data fetching

## Form Pattern {#form}

### When to Use

User wants to create a form for data input — customer data, settings, configuration, etc.

### Required Components

```jsx
import { Form, TextField, NumberField, Picker, Item, Button, ButtonGroup,
         Flex, InlineAlert, Heading, Content } from '@adobe/react-spectrum';
```

### Annotated Example

```jsx
import React, { useState } from 'react';
import { Form, TextField, Picker, Item, Button, ButtonGroup,
         Flex, InlineAlert, Heading, Content } from '@adobe/react-spectrum';
import { useShellContext } from '../ShellContext';

/**
 * Form pattern: Controlled fields, validation, submit with loading, error display.
 * Adapt: field names, validation rules, action URL, and success handling.
 */
function CustomerForm({ onSuccess }) {
  const { imsToken, imsOrg } = useShellContext();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  // Adapt: add more fields as needed

  const validate = () => {
    if (!name.trim()) return 'Name is required';
    if (!email.includes('@')) return 'Valid email is required';
    if (!department) return 'Department is required';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(actionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${imsToken}`,
          'x-gw-ims-org-id': imsOrg
        },
        body: JSON.stringify({ name, email, department })
      });
      if (!res.ok) throw new Error(`Submit failed: ${res.status}`);
      onSuccess?.(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form onSubmit={handleSubmit} maxWidth="size-6000">
      {error && (
        <InlineAlert variant="negative">
          <Heading>Error</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}
      {/* Adapt: add/remove/change fields to match user's data model */}
      <TextField label="Name" value={name} onChange={setName} isRequired />
      <TextField label="Email" value={email} onChange={setEmail} isRequired
        type="email" />
      <Picker label="Department" selectedKey={department}
        onSelectionChange={setDepartment} isRequired>
        <Item key="engineering">Engineering</Item>
        <Item key="marketing">Marketing</Item>
        <Item key="sales">Sales</Item>
      </Picker>
      <ButtonGroup marginTop="size-200">
        <Button variant="accent" type="submit" isPending={isSubmitting}>
          Submit
        </Button>
      </ButtonGroup>
    </Form>
  );
}
```

### Common Variations

- **Edit form:** Pre-populate fields from existing data, change submit label to "Save"
- **Settings form:** Add `Switch` and `Checkbox` components for toggles
- **Multi-step form:** Use state to track current step, show different field groups

### Pitfalls

- Not showing `isPending` on the submit button during submission
- Missing `isRequired` on required fields (no visual indicator for users)
- Forgetting `type="email"` or `type="password"` on relevant TextFields
- Not clearing the error message on successful resubmission

## Table Pattern {#table}

### When to Use

User wants to display tabular data — product lists, user records, log entries, etc.

### Required Components

```jsx
import { TableView, TableHeader, Column, TableBody, Row, Cell,
         ProgressCircle, Flex, IllustratedMessage, Heading, Content } from '@adobe/react-spectrum';
import NotFound from '@spectrum-icons/illustrations/NotFound';
```

### Annotated Example

```jsx
import React, { useState, useEffect, useMemo } from 'react';
import { TableView, TableHeader, Column, TableBody, Row, Cell,
         ProgressCircle, Flex, IllustratedMessage, Heading, Content,
         ActionButton } from '@adobe/react-spectrum';
import NotFound from '@spectrum-icons/illustrations/NotFound';
import { useShellContext } from '../ShellContext';

/**
 * Table pattern: Async data loading, sortable columns, empty state, row actions.
 * Adapt: columns, data shape, action URL, row actions.
 */
function ProductsTable() {
  const { imsToken, imsOrg } = useShellContext();
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortDescriptor, setSortDescriptor] = useState({ column: 'name', direction: 'ascending' });

  useEffect(() => {
    async function loadProducts() {
      try {
        const res = await fetch(actionUrl, {
          headers: {
            'Authorization': `Bearer ${imsToken}`,
            'x-gw-ims-org-id': imsOrg
          }
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        setItems(data.products || []);
      } catch (err) {
        console.error('Failed to load products:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadProducts();
  }, [imsToken, imsOrg]);

  // Client-side sorting — adapt for server-side sorting with large datasets
  const sortedItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const val = a[sortDescriptor.column] < b[sortDescriptor.column] ? -1 : 1;
      return sortDescriptor.direction === 'descending' ? -val : val;
    });
    return sorted;
  }, [items, sortDescriptor]);

  if (isLoading) {
    return (
      <Flex alignItems="center" justifyContent="center" height="size-3000">
        <ProgressCircle aria-label="Loading products" isIndeterminate size="L" />
      </Flex>
    );
  }

  // Adapt: column definitions to match user's data model
  return (
    <TableView
      aria-label="Products"
      sortDescriptor={sortDescriptor}
      onSortChange={setSortDescriptor}
      selectionMode="multiple"
      renderEmptyState={() => (
        <IllustratedMessage>
          <NotFound />
          <Heading>No products found</Heading>
          <Content>Add a product to get started.</Content>
        </IllustratedMessage>
      )}
    >
      <TableHeader>
        <Column key="name" allowsSorting>Name</Column>
        <Column key="price" allowsSorting>Price</Column>
        <Column key="status">Status</Column>
        <Column key="actions" width={100}>Actions</Column>
      </TableHeader>
      <TableBody items={sortedItems}>
        {(item) => (
          <Row key={item.id}>
            <Cell>{item.name}</Cell>
            <Cell>${item.price}</Cell>
            <Cell>{item.status}</Cell>
            <Cell>
              <ActionButton isQuiet onPress={() => handleEdit(item)} aria-label={`Edit ${item.name}`}>
                Edit
              </ActionButton>
            </Cell>
          </Row>
        )}
      </TableBody>
    </TableView>
  );
}
```

### Common Variations

- **Server-side pagination:** Add page state, pass page/limit params to action, show page controls
- **Search + filter:** Add `SearchField` above table, filter items or re-fetch with query params
- **Row selection actions:** Add toolbar above table with bulk action buttons, use `onSelectionChange`
- **Inline status:** Use `StatusLight` in cells for visual status indicators

### Pitfalls

- Missing `aria-label` on `TableView` (accessibility violation)
- Not showing empty state when no data exists (blank table confuses users)
- Client-side sorting on large datasets (use server-side sorting for >1000 rows)
- Not handling loading state (table renders empty before data arrives)

## Dialog Pattern {#dialog}

### When to Use

User wants a confirmation dialog before destructive actions, or a modal for editing/creating records.

### Required Components

```jsx
import { DialogTrigger, AlertDialog, Dialog, Heading, Divider, Content,
         ButtonGroup, Button } from '@adobe/react-spectrum';
```

### Annotated Example — Confirmation Dialog

```jsx
import React from 'react';
import { DialogTrigger, AlertDialog, ActionButton } from '@adobe/react-spectrum';
import { useShellContext } from '../ShellContext';

/**
 * Dialog pattern: Confirmation before destructive actions.
 * Adapt: trigger button, dialog text, and action handler.
 */
function DeleteConfirmation({ itemName, itemId, onDeleted }) {
  const { imsToken, imsOrg } = useShellContext();

  const handleDelete = async () => {
    // Adapt: replace with actual delete action URL and params
    const res = await fetch(actionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${imsToken}`,
        'x-gw-ims-org-id': imsOrg
      },
      body: JSON.stringify({ id: itemId })
    });
    if (res.ok) onDeleted?.(itemId);
  };

  return (
    <DialogTrigger>
      <ActionButton>Delete</ActionButton>
      <AlertDialog
        variant="destructive"
        title={`Delete ${itemName}?`}
        primaryActionLabel="Delete"
        cancelLabel="Cancel"
        onPrimaryAction={handleDelete}
      >
        This will permanently delete "{itemName}". This action cannot be undone.
      </AlertDialog>
    </DialogTrigger>
  );
}
```

### Common Variations

- **Edit dialog:** Use `Dialog` (not `AlertDialog`) with a `Form` inside `Content`
- **Create dialog:** Same as edit, but with empty initial state
- **Info dialog:** Non-destructive `AlertDialog` with `variant="information"`

### Pitfalls

- Using `AlertDialog` for complex forms (use `Dialog` instead — AlertDialog is for simple confirmations)
- Not using `variant="destructive"` for delete actions (visual cue is important)
- Forgetting to call the close function after successful action in `Dialog`

## Navigation Pattern {#navigation}

### When to Use

User wants to add navigation between sections — tabs, sidebar, breadcrumbs.

### Required Components

```jsx
import { Tabs, TabList, TabPanels, Item, Breadcrumbs, Flex, View } from '@adobe/react-spectrum';
```

### Annotated Example — Tabbed Navigation

```jsx
import React from 'react';
import { Tabs, TabList, TabPanels, Item, View, Heading } from '@adobe/react-spectrum';

/**
 * Navigation pattern: Tabs for section switching within a page.
 * Adapt: tab keys, labels, and panel content to user's sections.
 */
function SettingsPage() {
  return (
    <View padding="size-400">
      <Heading level={1}>Settings</Heading>
      <Tabs aria-label="Settings sections" marginTop="size-200">
        <TabList>
          <Item key="general">General</Item>
          <Item key="notifications">Notifications</Item>
          <Item key="advanced">Advanced</Item>
        </TabList>
        <TabPanels>
          <Item key="general"><GeneralSettings /></Item>
          <Item key="notifications"><NotificationSettings /></Item>
          <Item key="advanced"><AdvancedSettings /></Item>
        </TabPanels>
      </Tabs>
    </View>
  );
}
```

### Common Variations

- **Sidebar layout:** `Flex` with fixed-width sidebar `View` + main content area (see `references/routing-patterns.md`)
- **Breadcrumb navigation:** `Breadcrumbs` with `onAction` for hierarchical navigation
- **Tab + router:** Sync `Tabs` `selectedKey` with `useLocation()` for URL-driven tabs

### Pitfalls

- Missing `aria-label` on `Tabs` (accessibility violation)
- Not syncing tabs with URL state (user can't bookmark or share tab state)
- Using custom navigation components instead of Spectrum's `Tabs` or `Breadcrumbs`