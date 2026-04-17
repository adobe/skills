# UI Quality Checklist

Validate all generated UI components against this checklist before marking work as done.

## Shell Integration

- [ ] `@adobe/exc-app` `register()` called with app ID
- [ ] `runtime.done()` called immediately (NOT after data loading)
- [ ] `runtime.ready()` stores `imsToken`, `imsOrg`, `locale` in state
- [ ] App wrapped in `<Provider theme={defaultTheme} locale={locale}>`
- [ ] IMS token passed in `Authorization` header for action calls
- [ ] `x-gw-ims-org-id` header included for org-scoped operations

## Accessibility (Required)

- [ ] All interactive elements have visible labels or `aria-label`
- [ ] `TableView` has `aria-label` describing the data
- [ ] `Tabs` has `aria-label` describing the section purpose
- [ ] Form fields have `label` prop (not just placeholder text)
- [ ] Icon-only buttons have `aria-label` describing the action
- [ ] Error messages are associated with their form fields (use `errorMessage` prop)
- [ ] Loading states use `aria-label` on `ProgressCircle`/`ProgressBar`
- [ ] Dialog has descriptive `title` or `aria-label`
- [ ] Color is not the only way to convey information (use icons, text)

## Loading States

- [ ] Initial page load shows `ProgressCircle` while fetching data
- [ ] Form submission shows `isPending` on the submit `Button`
- [ ] Table shows loading state during data fetch (empty state or overlay spinner)
- [ ] Action calls have loading indicators visible to the user
- [ ] Long operations use `ProgressBar` with percentage when possible

## Error Handling

- [ ] Failed action calls display `InlineAlert` with error message
- [ ] Form validation errors shown on individual fields (`validationState="invalid"`)
- [ ] Network errors show a retry option
- [ ] Empty data states use `IllustratedMessage` (not blank space)
- [ ] Critical errors use `AlertDialog` to block further action

## Component Usage

- [ ] All UI uses React Spectrum components — no custom HTML for standard patterns
- [ ] No inline CSS or custom stylesheets for Spectrum-equivalent styling
- [ ] `Button` has appropriate `variant` (`accent` for primary action, `negative` for destructive)
- [ ] Destructive actions (delete, remove) have confirmation dialog
- [ ] `Picker` used instead of custom dropdown implementations
- [ ] `TableView` used for tabular data (not custom `<table>` elements)

## Routing (if applicable)

- [ ] `HashRouter` used (not `BrowserRouter`) for ExC Shell compatibility
- [ ] Navigation components use `useNavigate()` from `react-router-dom`
- [ ] Catch-all route (`path="*"`) for 404 handling
- [ ] Shell context available in all routes via React Context

## Data Fetching

- [ ] IMS token read from shell context (not hardcoded or cached stale)
- [ ] Pagination implemented for large datasets (action 1MB response limit)
- [ ] Mutations include optimistic UI updates where appropriate
- [ ] `useEffect` cleanup prevents state updates on unmounted components
- [ ] Request AbortController used for cancellable fetches

## Responsive Layout

- [ ] `Flex` and `Grid` used for layout (not fixed pixel widths)
- [ ] Content reflows properly at different viewport sizes
- [ ] Tables provide horizontal scroll on narrow viewports
- [ ] Form layouts stack vertically on mobile

## AEM Extensions

- [ ] `register()` uses a unique reverse-domain extension ID (e.g., `com.example.aem.cf-console-export`)
- [ ] `sharedContext` used for auth — NOT `@adobe/exc-app` `runtime.ready()`
- [ ] `attach()` in modal/panel pages uses the same ID as the parent `register()` call
- [ ] `progressCircle.stop()` called after every `progressCircle.start()` (prevents stuck spinners)
- [ ] Extension tested via AEM Extension Tester URL before deployment
- [ ] `ext.config.yaml` has both `operations` and `extensions` blocks configured