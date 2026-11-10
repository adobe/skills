# Creating Custom Form Components

This guide explains how to create custom components for the Form block, which follows an MVC (Model-View-Controller) architecture. It covers the structure, authorable properties, extension mechanism, and best practices for custom components.

---

## Architecture Overview
- **Model:** Defined by the JSON schema for each field/component. Authorable properties are specified in the corresponding JSON file (`blocks/form/models/form-components/_<type>.json` for OOTB fields, `blocks/form/components/<name>/_<name>.json` for custom components).
- **View:** The HTML structure for each field type is described in [form-field-types.md](./form-field-types.md). This is the base structure your component will extend or modify.
- **Controller/Component Logic:** Implemented in JavaScript, either as OOTB (out-of-the-box) or custom components.

---

## OOTB Components
- OOTB (out-of-the-box) components are located in `blocks/form/models/form-components`.
- Each OOTB component has a JSON file defining its authorable properties (e.g., `_text-input.json`, `_drop-down.json`).
- These properties are available to authors in the form builder and are passed to the component as part of the field definition (`fd`).
- The base HTML structure for each OOTB component is documented in [form-field-types.md](./form-field-types.md).

---

## Custom Components: Structure & Placement
- Custom components reside in the `blocks/form/components` folder.
- Each custom component must be placed in its own folder, named after the component (e.g., `countdown-timer`).
- Inside the folder, you must have:
  - `countdown-timer.js` (main logic)
  - `countdown-timer.css` (optional, for styles)
- The name of the folder and the JS/CSS files must match.

---

## Defining New Properties for Custom Components
- If you need to capture new properties for your custom component, **create a new JSON file** `_<name>.json` in the component folder (`blocks/form/components/<name>/`) that extends an existing component definition.
- This is typically done by referencing the base component and adding or overriding properties as needed.
- The new JSON file should include the new properties under the `properties` or `fields` section.
- **Example: Countdown Timer**
  - See `_countdown-timer.json` for a real-world example. This file defines a custom component that extends the base button component and adds new properties like `initialText`, `finalText`, `time`, and `retries`.
  - These properties are defined in the `fields` array of the JSON file, making them available to authors in the form builder.
- The custom component can also be identified using the `:type` property, which can be set as `fd:viewType` in the JSON file (e.g., `fd:viewType: countdown-timer`). This allows the system to recognize and load the correct custom component.
- Any new properties added in the JSON definition are available in the field definition as `properties.<propertyName>` in your component's JS logic.

---

## Extending OOTB Components
- Custom components **must extend** from a predefined set of OOTB components.
- The system identifies which custom component to load using two mechanisms:
  1. **`:type`** (set via `fd:viewType` in the JSON schema) — checked against both `customComponents` and `OOTBComponentDecorators` in `mappings.js`.
  2. **`properties.variant`** (set in authoring) — checked against `customComponents` only.
- When either matches a registered name, the system loads the corresponding JS and CSS files from `blocks/form/components/<name>/`.
- The custom component is then applied to the base HTML structure of the OOTB component, allowing you to enhance or override its behavior and appearance.

---

## Component JS API
- Your custom component's JS file **must export a default function** (commonly called `decorate`).
- **Signature:**
  ```js
  export default function decorate(element, fd, container, formId) {
    // element: The HTML structure of the OOTB component you are extending
    // fd: The JSON field definition (all authorable properties)
    // container: The parent element (fieldset or form)
    // formId: The id of the form
    // ... your logic here ...
  }
  ```
- You can modify the `element`, add event listeners, inject additional markup, etc.
- Access any new properties you defined in your JSON as `fd.properties.<propertyName>`.

---

## Listening to Field Changes: How `subscribe` Works
- The `subscribe` function (from `blocks/form/rules/index.js`) connects your component to its field model. Always use `{ listenChanges: true }` for new components.
- **Callback Signature:**
  - `callback(element, fieldModel, 'register')` — called once when the model is ready
  - `callback(element, fieldModel, 'change', payload)` — called on every property change (when `listenChanges` is true)
  - `payload.changes` is an array of `{ propertyName, currentValue, prevValue }`
- For the full API reference, callback patterns, and child subscription examples, see [subscribe-api.md](./subscribe-api.md).
- **Example: Countdown Timer**
  ```js
  import { subscribe } from '../../rules/index.js';

  export default function decorate(fieldDiv, fieldJson, container, formId) {
    const { initialText, finalText, time } = fieldJson?.properties;

    let model = null;

    subscribe(fieldDiv, formId, (_fieldDiv, fieldModel, eventType, payload) => {
      if (eventType === 'register') {
        model = fieldModel;
        // one-time setup...
      } else if (eventType === 'change') {
        payload?.changes?.forEach((change) => {
          if (change?.propertyName === 'value') {
            // react to value changes
          }
        });
      }
    }, { listenChanges: true });
  }
  ```
- **Panel/container components** that watch child items should call `subscribe()` on each child's DOM wrapper inside the parent's `'register'` callback. Find child wrappers with `element.querySelector('[data-id="${child.id}"]')` and find child models by `fieldType` or `':type'`. See [subscribe-api.md](./subscribe-api.md) for the full child pattern.
- **Custom events** (e.g. `idVerified`, `timerComplete`) dispatched from rules, custom functions, or other components: use `fieldModel.subscribe(cb, 'eventName')` inside the `'register'` branch — **not** `fieldDiv.addEventListener(...)`. DOM listeners bypass the AEM Forms model event system. See [subscribe-api.md § Custom event subscription](./subscribe-api.md#custom-event-subscription) for the full pattern, dispatch sites, and anti-pattern callout.

---

## Reusing and Extending Fields in Custom Components

When defining fields in your custom component's JSON (for any field group—basic, validation, help, etc.), follow these best practices for maintainability and consistency:

- **Reuse standard/shared fields** by referencing existing shared containers or field definitions (e.g., `../../models/form-common/_basic-input-placeholder-fields.json#/fields`, `../../models/form-common/_basic-validation-fields.json#/fields`). This ensures you inherit all standard options without duplicating them.
- **Add only new or custom fields** explicitly in your container. This keeps your schema DRY and focused.
- **Remove or avoid duplicating fields** that are already included via references. Only define fields that are unique to your component's logic.
- **Reference help containers and other shared content** (e.g., `../../models/form-common/_help-container.json`) as needed for consistency and maintainability.

**Minimal Example: Container in a Custom Component JSON**
```json
{
  "component": "container",
  "name": "validation",
  "label": "Validation",
  "collapsible": true,
  "fields": [
    { "...": "../../models/form-common/_basic-validation-fields.json#/fields" },
    { "component": "number", "name": "minAge", "label": "Minimum Age", "valueType": "number", "description": "Minimum age allowed for date of birth." },
    { "component": "number", "name": "maxAge", "label": "Maximum Age", "valueType": "number", "description": "Maximum age allowed for date of birth." },
    { "component": "text", "name": "minimumErrorMessage", "label": "Minimum age error message", "valueType": "string", "description": "Error message shown when the age is below the minimum allowed." },
    { "component": "text", "name": "maximumErrorMessage", "label": "Maximum age error message", "valueType": "string", "description": "Error message shown when the age is above the maximum allowed." }
  ]
}
```

**Tip:**
- This pattern makes it easy to update or extend logic in the future, and ensures your custom components remain consistent with the rest of the form system.
- Always check for existing shared containers or field definitions before adding new ones.

---

## Step-by-Step: Creating a Custom Component
1. **Choose an OOTB component to extend** (e.g., button, drop-down, text-input, etc.).
2. **Create a folder** in `blocks/form/components` with your component's name (e.g., `countdown-timer`).
3. **Add a JS file** with the same name:
   - `blocks/form/components/countdown-timer/countdown-timer.js`
4. **(Optional) Add a CSS file** for custom styles:
   - `blocks/form/components/countdown-timer/countdown-timer.css`
5. **Define a new JSON file** (e.g., `_countdown-timer.json`) in the same folder as your component JS file (`blocks/form/components/countdown-timer/_countdown-timer.json`). This JSON should extend an existing component and set `fd:viewType` to your component's name (see minimal example above).
   - **For all field groups (basic, validation, help, etc.):** Reference standard/shared fields as shown above, and add only your custom fields explicitly.
6. **Implement the JS logic:**
   - Export a default function as described above.
   - Use the `element` parameter to modify the base HTML structure.
   - Use the `fd` parameter if needed for standard field data.
   - Use `subscribe` to listen to field changes or custom events if needed.
7. **Register your component** by setting `fd:viewType` in your component's JSON schema to your component's name (e.g., `countdown-timer`). The runtime uses this as the `:type` property to load the component. Alternatively, components can be identified via `properties.variant` set in authoring (checked against `customComponents` only).
8. **Update `mappings.js`:** Add your component's name to the `OOTBComponentDecorators` (for OOTB-style components) or `customComponents` list so it is recognized and loaded by the system.
9. **Update `_form.json`:** Add your component's name to the `"form"` filter `components` array so authors can insert it in the Universal Editor (the project scaffolder does this automatically).
10. **Run the build:json script:** Execute `npm run build:json` to compile and merge all component JSON definitions into a single file to be served from the server. This ensures your new component's schema is included in the merged output.

**JS implementation (`countdown-timer.js`):**
```js
import { subscribe } from '../../rules/index.js';

export default function decorate(fieldDiv, fieldJson, container, formId) {
  const { initialText, finalText, time } = fieldJson?.properties;

  let model = null;

  subscribe(fieldDiv, formId, (_fieldDiv, fieldModel, eventType, payload) => {
    if (eventType === 'register') {
      model = fieldModel;
      // one-time setup with model...
    } else if (eventType === 'change') {
      payload?.changes?.forEach((change) => {
        if (change?.propertyName === 'value') {
          // react to value changes
        } else if (change?.propertyName === 'properties') {
          // react to custom property changes (e.g., initialText)
        }
      });
    }
  }, { listenChanges: true });
}
```

---

## Best Practices
- **Keep your component logic focused**: Only add/override what is necessary for your custom behavior.
- **Leverage the base structure**: Use the OOTB HTML as your starting point.
- **Use authorable properties**: Expose configurable options via the JSON schema.
- **Namespace your CSS**: Avoid style collisions by using unique class names.
- **Test with different field values and events**.

---

## References
- [form-field-types.md](./form-field-types.md): Base HTML structures and properties for all field types.
- `blocks/form/models/form-components`: OOTB component property definitions.
- `blocks/form/components`: Place for your custom components.
- Example: `blocks/form/components/countdown-timer/_countdown-timer.json` shows how to extend a base component and add new properties.

---

By following this guide, you can create robust, maintainable custom components that integrate seamlessly with the Form block's architecture.