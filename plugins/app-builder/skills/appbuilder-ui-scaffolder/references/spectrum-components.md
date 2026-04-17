> Reference based on @adobe/react-spectrum ^3.33.0. Component APIs may change in future versions.

# React Spectrum v3 Component Catalog

All components are imported from `@adobe/react-spectrum`. Use named imports:

```jsx
import { Button, TextField, Flex, View } from '@adobe/react-spectrum';
```

## Layout Components

### View
Container with Spectrum styling. Use for page sections and content areas.
```jsx
import { View } from '@adobe/react-spectrum';
<View padding="size-200" backgroundColor="gray-50" borderRadius="medium">
  {children}
</View>
```
**Required props:** none. **Common:** `padding`, `backgroundColor`, `UNSAFE_className`.

### Flex
Flexbox layout. Use for horizontal/vertical arrangements.
```jsx
import { Flex } from '@adobe/react-spectrum';
<Flex direction="column" gap="size-200" alignItems="start">
  {children}
</Flex>
```
**Required props:** none. **Common:** `direction`, `gap`, `alignItems`, `justifyContent`, `wrap`.

### Grid
CSS Grid layout. Use for complex multi-column layouts.
```jsx
import { Grid } from '@adobe/react-spectrum';
<Grid columns={['1fr', '1fr', '1fr']} gap="size-200">
  {children}
</Grid>
```

### Divider
Visual separator between sections.
```jsx
import { Divider } from '@adobe/react-spectrum';
<Divider size="S" marginY="size-200" />
```

## Navigation Components

### Tabs
Tabbed navigation for section switching.
```jsx
import { Tabs, TabList, TabPanels, Item } from '@adobe/react-spectrum';
<Tabs aria-label="Settings sections">
  <TabList>
    <Item key="general">General</Item>
    <Item key="advanced">Advanced</Item>
  </TabList>
  <TabPanels>
    <Item key="general"><GeneralSettings /></Item>
    <Item key="advanced"><AdvancedSettings /></Item>
  </TabPanels>
</Tabs>
```
**Required props:** `aria-label` on `Tabs`. **Accessibility:** Tab switching is keyboard-navigable by default.

### Breadcrumbs
Hierarchy navigation.
```jsx
import { Breadcrumbs, Item } from '@adobe/react-spectrum';
<Breadcrumbs onAction={(key) => navigate(key)}>
  <Item key="home">Home</Item>
  <Item key="products">Products</Item>
  <Item key="detail">Product Detail</Item>
</Breadcrumbs>
```
**Required props:** none. **Common:** `onAction`, `isDisabled`.

### Link
Navigation link, styled for Spectrum.
```jsx
import { Link } from '@adobe/react-spectrum';
<Link href="/settings" variant="primary">Settings</Link>
```

## Form Components

### Form
Form container with built-in layout.
```jsx
import { Form } from '@adobe/react-spectrum';
<Form onSubmit={handleSubmit} isRequired necessityIndicator="icon">
  {formFields}
</Form>
```
**Common:** `onSubmit`, `isRequired`, `validationBehavior="native"`, `necessityIndicator`.

### TextField
Single-line text input.
```jsx
import { TextField } from '@adobe/react-spectrum';
<TextField label="Name" value={name} onChange={setName} isRequired
  validationState={nameError ? 'invalid' : undefined}
  errorMessage={nameError} />
```
**Required props:** `label` (accessibility). **Common:** `value`, `onChange`, `isRequired`, `validationState`, `errorMessage`, `description`.

### NumberField
Numeric input with stepper.
```jsx
import { NumberField } from '@adobe/react-spectrum';
<NumberField label="Quantity" value={qty} onChange={setQty} minValue={0} maxValue={100} />
```
**Required props:** `label`. **Common:** `value`, `onChange`, `minValue`, `maxValue`, `step`.

### Picker (Select/Dropdown)
Selection from a list of options.
```jsx
import { Picker, Item } from '@adobe/react-spectrum';
<Picker label="Category" selectedKey={category} onSelectionChange={setCategory}>
  <Item key="electronics">Electronics</Item>
  <Item key="clothing">Clothing</Item>
</Picker>
```
**Required props:** `label`. **Common:** `selectedKey`, `onSelectionChange`, `isLoading`.

### Checkbox / Switch
Boolean toggles.
```jsx
import { Checkbox, Switch } from '@adobe/react-spectrum';
<Checkbox isSelected={agreed} onChange={setAgreed}>I agree to terms</Checkbox>
<Switch isSelected={enabled} onChange={setEnabled}>Enable notifications</Switch>
```
**Required props:** children (label text) for Checkbox.

## Button Components

### Button
Primary action button.
```jsx
import { Button } from '@adobe/react-spectrum';
<Button variant="accent" onPress={handleSave}>Save</Button>
<Button variant="primary" onPress={handleSubmit}>Submit</Button>
<Button variant="secondary" onPress={handleCancel}>Cancel</Button>
<Button variant="negative" onPress={handleDelete}>Delete</Button>
```
**Required props:** `variant`. **Common:** `onPress`, `isDisabled`, `isPending` (shows spinner).
**Accessibility:** Use descriptive text. Avoid icon-only buttons without `aria-label`.


## Collection Components

### TableView
Data table with sorting, selection, and async loading.
```jsx
import { TableView, TableHeader, Column, TableBody, Row, Cell } from '@adobe/react-spectrum';

<TableView aria-label="Products" selectionMode="multiple" onSortChange={handleSort}>
  <TableHeader>
    <Column key="name" allowsSorting>Name</Column>
    <Column key="price" allowsSorting>Price</Column>
    <Column key="status">Status</Column>
  </TableHeader>
  <TableBody items={products}>
    {(item) => (
      <Row key={item.id}>
        <Cell>{item.name}</Cell>
        <Cell>{item.price}</Cell>
        <Cell>{item.status}</Cell>
      </Row>
    )}
  </TableBody>
</TableView>
```
**Required props:** `aria-label` on `TableView`. **Common:** `selectionMode`, `onSelectionChange`, `onSortChange`, `sortDescriptor`.
**Accessibility:** Always provide `aria-label`. Column headers serve as row cell labels automatically.

### ListView
List with selection and actions.
```jsx
import { ListView, Item } from '@adobe/react-spectrum';
<ListView aria-label="Files" selectionMode="single" onSelectionChange={setSelected}>
  {items.map(item => <Item key={item.id}>{item.name}</Item>)}
</ListView>
```

### TagGroup
Display tags/chips for categories, filters.
```jsx
import { TagGroup, Item } from '@adobe/react-spectrum';
<TagGroup aria-label="Categories" onRemove={handleRemove}>
  {tags.map(tag => <Item key={tag.id}>{tag.label}</Item>)}
</TagGroup>
```

## Overlay Components

### DialogTrigger + AlertDialog
Confirmation dialogs.
```jsx
import { DialogTrigger, AlertDialog, ActionButton } from '@adobe/react-spectrum';

<DialogTrigger>
  <ActionButton>Delete</ActionButton>
  <AlertDialog
    variant="destructive"
    title="Delete item"
    primaryActionLabel="Delete"
    cancelLabel="Cancel"
    onPrimaryAction={handleDelete}
  >
    Are you sure you want to delete this item? This action cannot be undone.
  </AlertDialog>
</DialogTrigger>
```
**Required props:** `title` on `AlertDialog`. **Accessibility:** Focus is trapped inside the dialog automatically.

### Dialog (Complex Content)
For forms or rich content in a modal.
```jsx
import { DialogTrigger, Dialog, Heading, Content, Divider, ButtonGroup, Button } from '@adobe/react-spectrum';

<DialogTrigger>
  <ActionButton>Edit</ActionButton>
  {(close) => (
    <Dialog>
      <Heading>Edit Item</Heading>
      <Divider />
      <Content>
        <Form>{/* form fields */}</Form>
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={close}>Cancel</Button>
        <Button variant="accent" onPress={() => { handleSave(); close(); }}>Save</Button>
      </ButtonGroup>
    </Dialog>
  )}
</DialogTrigger>
```

### Tooltip
Contextual help on hover/focus.
```jsx
import { TooltipTrigger, Tooltip, ActionButton } from '@adobe/react-spectrum';
<TooltipTrigger>
  <ActionButton aria-label="Info"><InfoIcon /></ActionButton>
  <Tooltip>Additional information about this feature</Tooltip>
</TooltipTrigger>
```

## Status Components

### ProgressCircle / ProgressBar
Loading indicators.
```jsx
import { ProgressCircle, ProgressBar } from '@adobe/react-spectrum';
// Indeterminate (unknown duration)
<ProgressCircle aria-label="Loading data" isIndeterminate size="L" />
// Determinate (known progress)
<ProgressBar label="Uploading..." value={progress} />
```
**Required props:** `aria-label` (ProgressCircle) or `label` (ProgressBar).

### StatusLight
Status indicators.
```jsx
import { StatusLight } from '@adobe/react-spectrum';
<StatusLight variant="positive">Active</StatusLight>
<StatusLight variant="negative">Error</StatusLight>
<StatusLight variant="notice">Pending</StatusLight>
<StatusLight variant="neutral">Inactive</StatusLight>
```

### Badge
Count or status badges.
```jsx
import { Badge } from '@adobe/react-spectrum';
<Badge variant="positive">New</Badge>
<Badge variant="info">{count}</Badge>
```

## Content Components

### Heading / Text / Content
Typography components.
```jsx
import { Heading, Text, Content } from '@adobe/react-spectrum';
<Heading level={1}>Page Title</Heading>
<Heading level={2}>Section Title</Heading>
<Text>Body text content</Text>
<Content>Rich content area within a container</Content>
```

### IllustratedMessage
Empty states and error pages.
```jsx
import { IllustratedMessage, Heading, Content } from '@adobe/react-spectrum';
import NotFound from '@spectrum-icons/illustrations/NotFound';

<IllustratedMessage>
  <NotFound />
  <Heading>No results found</Heading>
  <Content>Try adjusting your search or filter criteria.</Content>
</IllustratedMessage>
```
**Use for:** Empty tables, no search results, error states, first-time setup screens.

### InlineAlert
Contextual messages within page flow.
```jsx
import { InlineAlert, Heading, Content } from '@adobe/react-spectrum';
<InlineAlert variant="informative">
  <Heading>Tip</Heading>
  <Content>You can sort the table by clicking column headers.</Content>
</InlineAlert>
<InlineAlert variant="negative">
  <Heading>Error</Heading>
  <Content>Failed to load data. Please try again.</Content>
</InlineAlert>
```
**Variants:** `informative`, `positive`, `notice`, `negative`.

## Accessibility Quick Reference

| Rule | How |
| --- | --- |
| Label all inputs | Use `label` prop on form fields |
| Label all tables | Use `aria-label` on `TableView` |
| Label all tabs | Use `aria-label` on `Tabs` |
| Label icon-only buttons | Use `aria-label` on `ActionButton` |
| Label loading spinners | Use `aria-label` on `ProgressCircle` |
| Announce errors | Use `errorMessage` prop on form fields |
| Don't rely on color alone | Pair colors with icons or text |
### ActionButton
Secondary/toolbar action.
```jsx
import { ActionButton } from '@adobe/react-spectrum';
<ActionButton onPress={handleEdit} aria-label="Edit item">
  <EditIcon />
</ActionButton>
```

### ButtonGroup
Group related buttons.
```jsx
import { ButtonGroup, Button } from '@adobe/react-spectrum';
<ButtonGroup>
  <Button variant="secondary" onPress={handleCancel}>Cancel</Button>
  <Button variant="accent" onPress={handleSave}>Save</Button>
</ButtonGroup>
```
