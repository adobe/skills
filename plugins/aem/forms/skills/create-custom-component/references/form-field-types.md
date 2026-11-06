# Form Field Types: Identification, Common Properties, Structure, and Field-Specifics

This document summarizes how JSON schema maps to rendered HTML in `blocks/form/form.js`, focusing on how fields are identified and rendered, common patterns, and field-specific differences.

---

## How Fields Are Identified (`fieldType`)
- Each field in the JSON schema has a `fieldType` property that determines how it is rendered.
- `fieldType` can be:
  - A **special type** (e.g., `drop-down`, `radio-group`, `checkbox-group`, `panel`, `plain-text`, `image`, `heading`, etc.)
  - A **valid HTML input type** (e.g., `text`, `number`, `email`, `date`, `password`, `tel`, `range`, `file`, etc.)
  - A type with a **`-input` suffix** (e.g., `text-input`, `number-input`, etc.), which is normalized to the base type (e.g., `text`, `number`).
- If the `fieldType` matches a special type, a custom renderer is used. Otherwise, it is treated as a default input type.
- See the sections below for the full HTML structure and properties for each type.

---

## Common Properties (Used by Most Fields)
- `id`: Used for element IDs and accessibility.
- `name`: Used for the `name` attribute of the input/select/fieldset.
- `label.value`, `label.richText`, `label.visible`: For label/legend text, HTML, and visibility.
- `value`: The current value of the field.
- `required`: Adds `required` attribute or data.
- `readOnly`, `enabled`: Disables the field if set.
- `description`: Appended as help/help text below the field.
- `tooltip`: Used for the `title` attribute on inputs.
- `constraintMessages`: Custom error messages (as data attributes).

## Common HTML Structure
Most fields are rendered inside a wrapper with a label and optional help text:

```html
<div class="<fieldType>-wrapper field-wrapper field-<name>" data-id="<id>">
  <label for="<id>" class="field-label">Label</label>
  <!-- Field-specific input/element here -->
  <div class="field-description" id="<id>-description">Description or error message</div>
</div>
```
- For groups (radio/checkbox) and panels, a `<fieldset>` with a `<legend>` is used instead of a `<div>`/`<label>`.
- The help text `<div>` is only present if `description` is set.

---

## Error Message Display
- **Error messages** are shown in the same `.field-description` element used for help text, which is updated dynamically.
- When a field is invalid:
  - The wrapper (e.g., `.field-wrapper`) receives the class `.field-invalid`.
  - The `.field-description` content is replaced with the error message.
- When the field becomes valid again:
  - The `.field-invalid` class is removed.
  - The `.field-description` is restored to the original help text (if any), or removed if none.
- **Custom error messages** can be set via the `constraintMessages` property in the JSON. These are added as `data-<constraint>ErrorMessage` attributes on the wrapper (e.g., `data-requiredErrorMessage`).

---

## Default Input Types (HTML Input or `*-input`)
- If `fieldType` is not a special type, it is treated as a standard HTML input type or as `<type>-input` (e.g., `text`, `number`, `email`, `date`, `text-input`, `number-input`, etc.).
- The suffix `-input` is stripped and the base type is used as the input's `type` attribute.
- These types are handled by default in `renderField()`.
- **Common default input types:**
  - `text`, `number`, `email`, `date`, `password`, `tel`, `range`, `file`, etc.
  - Also accepts `text-input`, `number-input`, etc. (these are normalized to the base type).

### Constraints for Default Input Types
- Constraints are added as attributes on the input element based on JSON properties. The following mapping applies (from the code):

| JSON Property   | HTML Attribute   | Applies To                |
|----------------|-----------------|---------------------------|
| `maxLength`    | `maxlength`      | text, email, password, tel|
| `minLength`    | `minlength`      | text, email, password, tel|
| `pattern`      | `pattern`        | text, email, password, tel|
| `maximum`      | `Max`            | number, range, date       |
| `minimum`      | `Min`            | number, range, date       |
| `step`         | `step`           | number, range, date       |
| `accept`       | `accept`         | file                      |
| `Multiple`     | `multiple`       | file                      |
| `maxOccur`     | `data-max`       | panel                     |
| `minOccur`     | `data-min`       | panel                     |

- Note: `Multiple` is a boolean property that, if true, adds the `multiple` attribute.
- These are set automatically by the form renderer using the field's JSON definition.
- **Example HTML Structure with Constraints:**
  ```html
  <div class="number-wrapper field-wrapper field-age" data-id="age" data-required="true" data-minimumErrorMessage="Too small" data-maximumErrorMessage="Too large">
    <label for="age" class="field-label">Age</label>
    <input type="number" id="age" name="age" value="30" required Min="18" Max="99" step="1" placeholder="Enter your age" />
    <div class="field-description" id="age-description">Description or error message</div>
  </div>
  ```
- All validation, error display, and help text logic applies as described above.

---

## Field-Specific Properties & Full HTML Structure

### `drop-down`
- **Extra Properties:**
  - `enum`, `enumNames`: Option values and display names.
  - `type`: If array, enables `multiple`.
  - `placeholder`: Adds a disabled placeholder option.
- **Full HTML Structure:**
  ```html
  <div class="drop-down-wrapper field-wrapper field-<name>" data-id="<id>" data-required="true" data-requiredErrorMessage="This field is required">
    <label for="<id>" class="field-label">Label</label>
    <select id="<id>" name="<name>" required title="Tooltip" multiple>
      <option disabled selected value="">Placeholder</option>
      <option value="opt1">Option 1</option>
      <option value="opt2">Option 2</option>
      <!-- ... -->
    </select>
    <div class="field-description" id="<id>-description">Description or error message</div>
  </div>
  ```

### `plain-text`
- **Extra Properties:**
  - `richText`: If true, renders HTML in the paragraph.
- **Full HTML Structure:**
  ```html
  <div class="plain-text-wrapper field-wrapper field-<name>" data-id="<id>">
    <label for="<id>" class="field-label">Label</label>
    <p>Text or <a href="..." target="_blank">link</a></p>
  </div>
  ```

### `checkbox`
- **Extra Properties:**
  - `enum`: Checked/unchecked values.
  - `properties.variant`, `properties.alignment`: For switch styling.
- **Full HTML Structure:**
  ```html
  <div class="checkbox-wrapper field-wrapper field-<name>" data-id="<id>" data-required="true" data-requiredErrorMessage="Please check this box">
    <label for="<id>" class="field-label">Label</label>
    <input type="checkbox" id="<id>" name="<name>" value="on" required data-unchecked-value="off" />
    <div class="field-description" id="<id>-description">Description or error message</div>
  </div>
  ```

### `button`
- **Extra Properties:**
  - `buttonType`: Sets the button type (`button`, `submit`, `reset`).
- **Full HTML Structure:**
  ```html
  <div class="button-wrapper field-wrapper field-<name>" data-id="<id>">
    <button id="<id>" name="<name>" type="submit" class="button">Label</button>
  </div>
  ```

### `multiline-input`
- **Extra Properties:**
  - `minLength`, `maxLength`, `pattern`, `placeholder`: For textarea validation and UI.
- **Full HTML Structure:**
  ```html
  <div class="multiline-wrapper field-wrapper field-<name>" data-id="<id>" data-minLengthErrorMessage="Too short" data-maxLengthErrorMessage="Too long">
    <label for="<id>" class="field-label">Label</label>
    <textarea id="<id>" name="<name>" required minlength="2" maxlength="100" pattern="[A-Za-z]+" placeholder="Type here..."></textarea>
    <div class="field-description" id="<id>-description">Description or error message</div>
  </div>
  ```

### `panel`
- **Extra Properties:**
  - `repeatable`, `minOccur`, `maxOccur`, `properties.variant`, `properties.colspan`, `index`, `Fieldset`.
- **Full HTML Structure:**
  ```html
  <fieldset class="panel-wrapper field-wrapper field-<name>" data-id="<id>" name="<name>" data-repeatable="true" data-index="0">
    <legend class="field-label">Label</legend>
    <!-- Nested fields here -->
    <button type="button" class="add">Add</button>
    <button type="button" class="remove">Remove</button>
    <div class="field-description" id="<id>-description">Description or error message</div>
  </fieldset>
  ```

### `radio`
- **Extra Properties:**
  - `enum`: Value(s) for the radio.
- **Full HTML Structure:**
  ```html
  <div class="radio-wrapper field-wrapper field-<name>" data-id="<id>" data-required="true">
    <label for="<id>" class="field-label">Label</label>
    <input type="radio" id="<id>" name="<name>" value="opt1" required />
    <div class="field-description" id="<id>-description">Description or error message</div>
  </div>
  ```

### `radio-group`
- **Extra Properties:**
  - `enum`, `enumNames`: Option values and display names.
- **Full HTML Structure:**
  ```html
  <fieldset class="radio-group-wrapper field-wrapper field-<name>" data-id="<id>" data-required="true">
    <legend class="field-label">Label</legend>
    <div>
      <input type="radio" id="<id>-0" name="<name>" value="opt1" required />
      <label for="<id>-0">Option 1</label>
    </div>
    <div>
      <input type="radio" id="<id>-1" name="<name>" value="opt2" />
      <label for="<id>-1">Option 2</label>
    </div>
    <div class="field-description" id="<id>-description">Description or error message</div>
  </fieldset>
  ```

### `checkbox-group`
- **Extra Properties:**
  - `enum`, `enumNames`, `minItems`, `maxItems`: Option values, display names, and selection constraints.
- **Full HTML Structure:**
  ```html
  <fieldset class="checkbox-group-wrapper field-wrapper field-<name>" data-id="<id>" data-required="true" data-minItems="1" data-maxItems="3">
    <legend class="field-label">Label</legend>
    <div>
      <input type="checkbox" id="<id>-0" name="<name>" value="opt1" required />
      <label for="<id>-0">Option 1</label>
    </div>
    <div>
      <input type="checkbox" id="<id>-1" name="<name>" value="opt2" />
      <label for="<id>-1">Option 2</label>
    </div>
    <div class="field-description" id="<id>-description">Description or error message</div>
  </fieldset>
  ```

### `image`
- **Extra Properties:**
  - `value`, `properties['fd:repoPath']`: Image path.
  - `altText`: For the image alt attribute.
- **Full HTML Structure:**
  ```html
  <div class="image-wrapper field-wrapper field-<name>" data-id="<id>">
    <picture>
      <img src="..." alt="..." />
      <!-- Optimized sources -->
    </picture>
  </div>
  ```

### `heading`
- **Extra Properties:**
  - `value`: Heading text.
- **Full HTML Structure:**
  ```html
  <div class="heading-wrapper field-wrapper field-<name>" data-id="<id>">
    <h2 id="<id>">Heading Text</h2>
  </div>
  ```

---

For more details, see the implementation in `blocks/form/form.js` and `blocks/form/util.js`.