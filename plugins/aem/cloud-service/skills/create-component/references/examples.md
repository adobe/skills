# Component Creation Examples

This reference provides example prompts and expected responses for common component creation scenarios.

## Example 1: Simple Component

```
User: Create an AEM component called hero-banner
```

**Response:**

- Create with placeholder dialog (no fields specified)
- Ask user what dialog fields they need

## Example 2: Component with Dialog Spec

```
User: Create a tiles-list component with these fields:
| Field | Type |
|-------|------|
| Title | Textfield |
| Items | Multifield |
```

**Response:**

> "I will create a dialog with EXACTLY these 2 fields:Title (textfield) -> titleItems (multifield) -> itemsProceeding with creation..."

## Example 3: Extending Core Component

```
User: Create a hero-teaser extending teaser with Video URL (pathfield) and Autoplay (checkbox)
```

**Response:**

> "Using Core Component: core/wcm/components/teaser/v2/teaserAdding 2 custom fields while inheriting Teaser dialog."

## Example 4: Extending Core Component with Hidden Tabs

```
User: Create a CTA List component extending List. Hide List Settings and Item Settings tabs.
      Add listTitle field. Only allow Fixed list.
```

**Response:**

> "Extending Core Component: core/wcm/components/list/v4/listDialog Changes:Hiding inherited tabs: listSettings, itemSettings (using sling:hideResource)Adding custom Properties tab with: listTitle, pages multifieldSetting listFrom=static via hidden fieldModel Changes:Using SlingHttpServletRequest as adaptableImplementing delegation to core List model via @Self @Via(type = ResourceSuperType.class)Implementing ComponentExporter interfaceAdding custom listTitle propertyProceeding with creation..."

## Example 5: Overriding Inherited Field Properties

```
User: Create a custom-button extending button. Make the link text field required and change label to "Button Label"
```

**Response:**

> "Extending Core Component: core/wcm/components/button/v2/buttonDialog Changes:Overriding inherited linkText field using sling:hidePropertiesChanging fieldLabel to "Button Label"Adding required="{Boolean}true"Proceeding with creation..."

## Example 6: Integration Component with Sling Servlet

```
User: Create a search-results component that fetches results dynamically based on user query.
      Dialog fields: Search Path (pathfield), Results Per Page (numberfield)
```

**Response:**

> "I will create a component with dynamic content loading:Dialog Fields (2 fields):Search Path (pathfield) -> searchPathResults Per Page (numberfield) -> resultsPerPageDynamic Content:Creating GET Servlet: SearchResultsServletSelector: searchURL pattern: /content/.../component.search.json?q={query}Files to Create:Component definition, dialog, HTLSling Model for dialog propertiesSling Servlet for search functionalityClientlib with Fetch API for async loadingUnit tests for model AND servletProceeding with creation..."

## Example 7: Form Submission Component with POST Servlet

```
User: Create a contact-form component with Name (textfield), Email (textfield), Message (textarea).
      Form should submit via AJAX without page reload.
```

**Response:**

> "I will create a form component with async submission:Dialog Fields (3 fields):Name (textfield) -> nameEmail (textfield) -> emailMessage (textarea) -> messageForm Submission:Creating POST Servlet: ContactFormServletSelector: submitURL pattern: /content/.../component.submit.jsonCSRF token handling includedFiles to Create:Component definition, dialog, HTL (with form markup)Sling Model for dialog configurationPOST Servlet with validationClientlib with form submission handlerUnit tests with validation scenariosProceeding with creation..."

## Example 8: Figma-Based Component Creation

```
User: Create a promo-card component from this Figma design:
      https://www.figma.com/design/nIRsoy3t8Jmu9NHSBvIgG4/Promo-Cards?node-id=4-103
      Dialog fields: Title (textfield), Description (textarea), CTA Link (pathfield)
```

**Response:**

> "Figma URL detected. Fetching design context...Calling get_design_context with fileKey='nIRsoy3t8Jmu9NHSBvIgG4', nodeId='4:103'Design tokens extracted:Colors: #1A2B3C (heading), #555555 (body text), #0066CC (CTA link)Typography: 'Helvetica Neue', sans-serif — heading 24px/700, body 16px/400Spacing: padding 32px, gap 16pxBorder-radius: 8pxDialog Fields (3 fields — from user spec, NOT from Figma):Title (textfield) -> titleDescription (textarea) -> descriptionCTA Link (pathfield) -> ctaLinkCSS: Pixel-perfect BEM styles from Figma design tokensHTL: Semantic HTML structure derived from Figma JSX, with Sling Model expressionsProceeding with creation..."

## Example 9: Component with Image (Embedded Core Image)

```
User: Create an author-bio component with Author Name (textfield), Author Photo (image), and Bio (textarea)
```

**Response:**

> "I will create an author-bio component with an embedded image. For the image, I'll embed the Core Image component which provides responsive renditions, lazy loading, and inline editing support.Dialog Fields (2 fields):Author Name (textfield) -> authorNameBio (textarea) -> bio(No dialog field needed for the image — the Core Image component provides its own editing UI via the page editor)Content Node:image child node with sling:resourceType='core/wcm/components/image/v3/image' in .content.xml(This pre-provisions the embedded image resource)Sling Model:@ValueMapValue for authorName, bio(No model code needed for the image — the Core Image component handles rendering automatically)HTL:data-sly-resource for embedded Core Image with wrapper div pattern:<div class='cmp-authorbio__photo'><div data-sly-resource="${'image' @ resourceType='core/wcm/components/image/v3/image'}"></div></div>The wrapper div preserves the CSS class during page editor interactions (the editor replaces the data-sly-resource element during inline editing)Proceeding with creation..."

## Example 10: Checkbox with Conditional Field Visibility

```
User: Create a cta-banner component with Title (textfield), Show Link (checkbox), Link URL (pathfield), Link Text (textfield). Link URL and Link Text should only be editable when Show Link is checked.
```

**Response:**

> "I will create a component with conditional field visibility:Dialog Fields (4 fields):Title (textfield) -> titleShow Link (checkbox) -> showLink (value='true', uncheckedValue='false')Link URL (pathfield) -> linkURL (granite:class='cmp-ctabanner__link-url')Link Text (textfield) -> linkText (granite:class='cmp-ctabanner__link-text')Dialog Clientlib:Category: [project].cta-banner.dialogUsing foundation-contentloaded event (NOT dialog-ready)Toggle logic: when showLink checkbox changes, enable/disable linkURL and linkText fields using adaptTo('foundation-field').setDisabled()Dialog XML: extraClientlibs='[project].cta-banner.dialog'Sling Model:@ValueMapValue for title, showLink (boolean), linkURL, linkTextHTL:data-sly-test='${model.showLink}' to conditionally render link markupProceeding with creation..."

## Example 11: Component with Datepicker

```
User: Create an event-card component with Event Title (textfield), Event Date (datepicker), and Location (textfield)
```

**Response:**

> "I will create a component with a date field:Dialog Fields (3 fields):Event Title (textfield) -> eventTitleEvent Date (datepicker) -> eventDate (type='datetime', displayedFormat='YYYY-MM-DD HH:mm')Location (textfield) -> locationSling Model:@ValueMapValue for eventTitle, location@ValueMapValue private Calendar eventDate (java.util.Calendar type for datepicker)Getter returns formatted date string using SimpleDateFormat for HTL renderingHTL:${model.eventTitle} for title${model.formattedEventDate} for formatted date display${model.location} for locationProceeding with creation..."

## Example 12: Single-Value Multifield (Tags/Keywords)

```
User: Create a highlights component with Section Title (textfield) and Highlights (a list of plain text values the author can add/remove)
```

**Response:**

> "I will create a component with a single-value multifield:Dialog Fields (2 fields):Section Title (textfield) -> sectionTitleHighlights (multifield) -> highlights (single-value, NOT composite)Multifield child: single textfield with name='./highlights', emptyText='Enter highlight'(No composite=true — this is a simple list of strings)Sling Model:@ValueMapValue private String sectionTitle@ValueMapValue private List<String> highlights (simple multifield injects as List<String> directly)Getter returns unmodifiable list via Collections.unmodifiableList()HTL:data-sly-list.highlight='${model.highlights}' to iterate<li>${highlight}</li> for each plain text valueProceeding with creation..."

## Example 13: Component with File Upload (Non-Image Document)

```
User: Create a resource-download component with Title (textfield), Description (textarea), and Downloadable Document (PDF/document upload)
```

**Response:**

> "I will create a resource-download component with a file upload for downloadable documents:Dialog Fields (3 fields):Title (textfield) -> titleDescription (textarea) -> descriptionDownloadable Document (fileupload) -> document (with fileReferenceParameter='./document/fileReference', mimeTypes=[application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document], uploadUrl='${suffix.path}', useHTML5=true)(fileupload is the correct widget for non-image files like PDFs and documents — for images, use embedded Core Image instead)Sling Model:@ValueMapValue for title, description@ChildResource(name='document') for documentResourcegetDocumentReference() method to extract fileReference from document resourceHTL:data-sly-test='${model.documentReference}' to conditionally render download link<a href='${model.documentReference}' download class='cmp-resourcedownload__link'>${model.title}</a>Proceeding with creation..."