# Searchable Dropdown — Authoring Properties

## Problem/Feature Description

Acme Travel's booking form has country and airport dropdowns with hundreds of options. The team wants a searchable dropdown that filters the list as the user types. Form authors need these settings in the Universal Editor properties panel, grouped in a collapsible "Search" section:

- **Enable search** (on/off, default on)
- **Minimum characters** before filtering starts (number, 0–5)
- **Match mode**: "Starts with" or "Contains"
- **Placeholder** for the search box (text)

The panel must still show the standard basic and validation settings that a normal dropdown has, plus the help content section. Options must continue to come from the dropdown's normal enum/enumNames, and if a rule changes the options at runtime the filtered list must update.

## Output Specification

Create a custom form component named `searchable-dropdown` extending the OOTB `drop-down` field type: JS, CSS, authoring JSON schema and README, registered so it loads at runtime.

## Input Files

The following files are provided as inputs and form the project root of an AEM Forms Edge Delivery Services project (based on aem-boilerplate-forms). Extract them before beginning. `node_modules` is not installed and there is no network access, so `npm run build:json` and `npm run lint` may not be runnable; if a command cannot run, say so instead of claiming it passed.

=============== FILE: package.json ===============
{
  "name": "acme-forms",
  "private": true,
  "type": "module",
  "scripts": {
    "lint:js": "eslint .",
    "lint:css": "stylelint blocks/**/*.css styles/*.css",
    "lint": "npm run lint:js && npm run lint:css",
    "build:json": "npm-run-all -p build:json:models build:json:definitions build:json:filters",
    "build:json:models": "merge-json-cli -i \"models/_component-models.json\" -o \"component-models.json\"",
    "build:json:definitions": "merge-json-cli -i \"models/_component-definition.json\" -o \"component-definition.json\"",
    "build:json:filters": "merge-json-cli -i \"models/_component-filters.json\" -o \"component-filters.json\""
  }
}

=============== FILE: blocks/form/mappings.js ===============
import { loadCSS } from '../../scripts/aem.js';

let customComponents = ['countdown-timer'];
const OOTBComponentDecorators = ['accordion', 'file-input', 'modal', 'password', 'rating', 'wizard'];

export function setCustomComponents(components) {
  customComponents = components;
}

export function getOOTBComponents() {
  return OOTBComponentDecorators;
}

export function getCustomComponents() {
  return customComponents;
}

/**
 * Loads the JS/CSS of every component matching fd[':type'] (from fd:viewType)
 * or properties.variant, and calls its default export.
 */
export default async function componentDecorator(element, fd, container, formId) {
  const { ':type': type = '', properties } = fd;
  const names = [];
  if (properties?.variant && customComponents.includes(properties.variant)) names.push(properties.variant);
  if (customComponents.includes(type) || OOTBComponentDecorators.includes(type)) names.push(type);
  await Promise.all(names.map(async (componentName) => {
    loadCSS(`${window.hlx.codeBasePath}/blocks/form/components/${componentName}/${componentName}.css`);
    const mod = await import(`${window.hlx.codeBasePath}/blocks/form/components/${componentName}/${componentName}.js`);
    if (mod.default) await mod.default(element, fd, container, formId);
  }));
  return element;
}

=============== FILE: blocks/form/_form.json ===============
{
  "definitions": [
    {
      "title": "Adaptive Form",
      "id": "form",
      "plugins": {
        "xwalk": {
          "page": {
            "resourceType": "core/fd/components/form/container/v2/container",
            "template": {
              "fieldType": "form"
            }
          }
        }
      }
    }
  ],
  "models": [
    {
      "id": "form",
      "fields": [
        {
          "component": "text",
          "name": "title",
          "label": "Title",
          "valueType": "string"
        }
      ]
    }
  ],
  "filters": [
    {
      "id": "form",
      "components": [
        "text-input",
        "number-input",
        "drop-down",
        "email",
        "checkbox",
        "checkbox-group",
        "panel",
        "button",
        "countdown-timer"
      ]
    }
  ]
}

=============== FILE: models/_component-definition.json ===============
{
  "groups": [
    {
      "title": "Adaptive Form Components",
      "id": "form-general",
      "components": [
        {
          "...": "../blocks/form/models/form-components/*.json#/definitions"
        }
      ]
    },
    {
      "title": "Custom Components",
      "id": "custom-components",
      "components": [
        {
          "...": "../blocks/form/components/countdown-timer/_countdown-timer.json#/definitions"
        }
      ]
    }
  ]
}

=============== FILE: blocks/form/rules/index.js ===============
/**
 * Connects a field wrapper (element with data-id) to its form field model.
 * callback(fieldDiv, fieldModel, 'register') is called once when the model is ready.
 * With { listenChanges: true }, callback(fieldDiv, fieldModel, 'change', payload) is also
 * called on every model property change; payload.changes = [{ propertyName, currentValue, prevValue }].
 */
export function subscribe(fieldDiv, formId, callback, options = {}) {
  // runtime implementation omitted from this fixture
  return { fieldDiv, formId, callback, options };
}

export default subscribe;

=============== FILE: blocks/form/models/form-common/_basic-input-fields.json ===============
{"fields": [
  {"component": "text", "name": "name", "label": "Name", "valueType": "string"},
  {"component": "text", "name": "jcr:title", "label": "Label", "valueType": "string"}
]}

=============== FILE: blocks/form/models/form-common/_basic-validation-fields.json ===============
{"fields": [
  {"component": "boolean", "name": "required", "label": "Required", "valueType": "boolean"}
]}

=============== FILE: blocks/form/models/form-common/_help-container.json ===============
{"component": "container", "name": "help", "label": "Help Content", "collapsible": true, "fields": [
  {"component": "richtext", "name": "description", "label": "Help text", "valueType": "string"}
]}

=============== FILE: blocks/form/models/form-components/_drop-down.json ===============
{
  "definitions": [
    {
      "title": "Drop Down",
      "id": "drop-down",
      "plugins": {
        "xwalk": {
          "page": {
            "resourceType": "core/fd/components/form/dropdown/v1/dropdown",
            "template": {
              "jcr:title": "Drop Down",
              "fieldType": "drop-down"
            }
          }
        }
      }
    }
  ],
  "models": [
    {
      "id": "drop-down",
      "fields": [
        {
          "component": "container",
          "name": "basic",
          "label": "Basic",
          "collapsible": false,
          "...": "../form-common/_basic-input-fields.json"
        },
        {
          "component": "container",
          "name": "validation",
          "label": "Validation",
          "collapsible": true,
          "fields": [
            {
              "...": "../form-common/_basic-validation-fields.json#/fields"
            }
          ]
        },
        {
          "...": "../form-common/_help-container.json"
        }
      ]
    }
  ]
}
