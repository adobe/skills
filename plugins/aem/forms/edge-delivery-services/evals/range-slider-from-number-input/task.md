# Loan Amount Slider — Custom Form Component

## Problem/Feature Description

Acme Bank's loan application form (AEM Forms on Edge Delivery Services) asks for the loan amount with a plain number field. The product team wants a slider instead. Form authors must be able to configure the slider's minimum, maximum and step in the Universal Editor properties panel, and the selected amount must show next to the slider. Rules elsewhere in the form already read and set the loan amount field's value, so the slider must stay in sync when a rule changes the value, and user changes must reach the form model.

## Output Specification

Create a custom form component named `loan-slider` that extends the OOTB `number-input` field type. Produce every file the component needs inside the project (component JS, CSS, authoring JSON schema and component README), and update the project files required for the component to load at runtime and be insertable by authors.

When finished, write `VALIDATION.md` at the project root describing how you validated the component (commands run and results, checks that could not be run, and how to verify it in a browser).

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

=============== FILE: blocks/form/models/form-components/_number-input.json ===============
{
  "definitions": [
    {
      "title": "Number Input",
      "id": "number-input",
      "plugins": {
        "xwalk": {
          "page": {
            "resourceType": "core/fd/components/form/numberinput/v1/numberinput",
            "template": {
              "jcr:title": "Number Input",
              "fieldType": "number-input"
            }
          }
        }
      }
    }
  ],
  "models": [
    {
      "id": "number-input",
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
