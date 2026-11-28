# Accessibility Checklist for AEM Core Form Components

Every component MUST satisfy all applicable items below. This checklist is derived from WCAG 2.1 AA requirements and the patterns already established in the codebase.

## Labels & Names (WCAG 1.1.1, 1.3.1, 4.1.2)

- [ ] Every interactive element has a programmatic label via `<label for="...">` or `aria-label`
- [ ] The `<label>` element uses `for="${widgetId}"` matching the widget's `id="${componentId}-widget"`
- [ ] When label is hidden (`labelVisible=false`), provide `aria-label` on the widget
- [ ] Rich text labels use `data-richtext="true"` and render with `@ context='html'`
- [ ] Screen reader text is computed server-side via `assistPriority` (label/name/description/custom)

## ARIA States & Properties (WCAG 4.1.2)

- [ ] `aria-invalid="true"` set on widget when validation fails (managed by JS `updateValidity()`)
- [ ] `aria-readonly="true"` set on widget when `readOnly=true` (separate from `disabled`)
- [ ] `aria-required="true"` or HTML `required` attribute when field is required
- [ ] `aria-expanded` on question mark button (toggles between `true`/`false`)
- [ ] `aria-describedby` links widget to error message and description elements when present

## Live Regions (WCAG 4.1.3)

- [ ] Error message container: `aria-live="assertive"` — announces validation errors immediately
- [ ] Short description (tooltip): `aria-live="polite"` — announces on focus
- [ ] Long description: `aria-live="polite"` — announces when revealed

## Keyboard Navigation (WCAG 2.1.1, 2.1.2)

- [ ] All interactive elements reachable via Tab key
- [ ] `tabindex="0"` on custom interactive elements (not native `<input>`/`<button>`/`<select>`)
- [ ] No keyboard traps — Tab/Shift+Tab always moves focus in/out
- [ ] For radio groups: Arrow keys navigate between options (native radio behavior)
- [ ] For checkbox groups: Tab focuses each checkbox independently
- [ ] For custom widgets: implement keydown handlers for Space/Enter activation

## Focus Management (WCAG 2.4.7, 3.2.1)

- [ ] Visible focus indicator on all interactive elements (`:focus` styles in LESS)
- [ ] Focus outline: minimum `2px solid` with `outline-offset: 2px`
- [ ] Focus color meets 3:1 contrast ratio against adjacent colors
- [ ] `setActive()`/`setInactive()` called in JS view on focus/blur events

## Error Identification (WCAG 3.3.1, 3.3.2)

- [ ] Error message div follows pattern: `id="${componentId}__errormessage"`
- [ ] Error messages are text-based (not color-only indicators)
- [ ] `aria-invalid` combined with visible error message
- [ ] `data-attribute-valid` on root element reflects validation state

## Color & Contrast (WCAG 1.4.1, 1.4.3, 1.4.11)

- [ ] Information NOT conveyed through color alone (icons, text, patterns supplement color)
- [ ] Text contrast ratio: minimum 4.5:1 for normal text, 3:1 for large text
- [ ] Non-text UI elements (borders, icons, focus rings): minimum 3:1 contrast ratio
- [ ] Error states use both color AND text/icon indicators

## Component Structure (WCAG 1.3.1, 1.3.2)

- [ ] Semantic HTML elements used (`<label>`, `<input>`, `<button>`, `<fieldset>`, `<legend>`)
- [ ] For grouped controls (checkbox-group, radio-group): use `role="group"` or `<fieldset>`
- [ ] Reading order matches visual order (DOM order = visual order)
- [ ] `data-cmp-visible` / `data-cmp-enabled` / `data-cmp-required` / `data-cmp-readonly` on root

## BEM Naming Convention for Accessibility Elements

Every component follows this naming pattern:
```
.cmp-adaptiveform-{componentname}              — root container
.cmp-adaptiveform-{componentname}__label        — label element
.cmp-adaptiveform-{componentname}__widget       — main interactive widget
.cmp-adaptiveform-{componentname}__errormessage — error message area
.cmp-adaptiveform-{componentname}__shortdescription — tooltip
.cmp-adaptiveform-{componentname}__longdescription  — expanded help text
.cmp-adaptiveform-{componentname}__questionmark     — help toggle button
.cmp-adaptiveform-{componentname}__label-container  — label + question mark wrapper
```

## ID Convention for ARIA Linkage

```
{componentId}           — root element id
{componentId}-widget    — widget element id (label[for] target)
{componentId}__errormessage     — error message div
{componentId}__shortdescription — tooltip div
{componentId}__longdescription  — long description div
```

## JS View Accessibility Methods

Every view class MUST implement:

| Method | Purpose |
|--------|---------|
| `updateValidity(validity)` | Set `aria-invalid` on widget based on `validity.valid` |
| `updateReadOnly(readonly)` | Set `aria-readonly` and `disabled` on widget |
| `updateEnabled(enabled)` | Toggle `disabled` attribute on widget |
| `setModel(model)` | Register focus/blur listeners for `setActive()`/`setInactive()` |

## Testing Accessibility

- Unit tests should verify `getFieldType()`, label rendering, required/enabled/readOnly states
- JSON export tests (`Utils.testJSONExport`) validate the model schema which includes accessibility properties
- Integration tests should cover keyboard navigation and screen reader announcements
- Manual testing with VoiceOver (macOS) or NVDA (Windows) recommended before release
