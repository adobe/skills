# Star Rating Component Does Not Show Up

## Problem/Feature Description

A developer at Acme Retail built a `star-rating` custom component for the customer feedback form a few weeks ago. Authors report two problems: on the published form the field renders as a plain number box with no stars, and in the Universal Editor the "Maximum stars" property panel is missing the basic Name/Label fields. When stars did appear in an earlier prototype, choosing a star did not update the value submitted with the form, and rules that set the rating did not update the stars.

## Output Specification

Find and fix every problem with the `star-rating` component and its registration so that it loads at runtime, its authoring panel is complete, and it stays in sync with the form model in both directions. Keep the component name `star-rating`.

Write `FIX-REPORT.md` at the project root listing each defect found (file and cause), the fix, and how each fix was verified.

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

=============== FILE: blocks/form/components/star-rating/starRating.js ===============
import { subscribe } from '../../rules/index';

export default function decorate(fieldDiv, fieldJson, container, formId) {
  const input = fieldDiv.querySelector('input');
  const max = fieldJson?.properties?.maxStars || 5;
  const stars = document.createElement('div');
  stars.className = 'star-rating-stars';
  for (let i = 1; i <= max; i += 1) {
    const star = document.createElement('button');
    star.type = 'button';
    star.textContent = '★';
    star.addEventListener('click', () => {
      input.value = i;
      input.dispatchEvent(new Event('change'));
    });
    stars.append(star);
  }
  fieldDiv.append(stars);

  subscribe(fieldDiv, formId, (_el, fieldModel) => {
    fieldModel.subscribe((e) => {
      e.payload?.changes?.forEach((change) => {
        if (change.propertyName === 'value') {
          [...stars.children].forEach((s, idx) => s.classList.toggle('selected', idx < change.currentValue));
        }
      });
    }, 'change');
  });
  return fieldDiv;
}

=============== FILE: blocks/form/components/star-rating/star-rating.css ===============
.star-rating-stars button { background: none; border: 0; font-size: 1.5rem; color: #ccc; }
.star-rating-stars button.selected { color: #f5a623; }

=============== FILE: blocks/form/components/star-rating/_star-rating.json ===============
{
  "definitions": [
    {
      "title": "Star Rating",
      "id": "star-rating",
      "plugins": {
        "xwalk": {
          "page": {
            "resourceType": "core/fd/components/form/numberinput/v1/numberinput",
            "template": {
              "jcr:title": "Star Rating",
              "fieldType": "number-input",
              "fd:viewType": "starRating"
            }
          }
        }
      }
    }
  ],
  "models": [
    {
      "id": "star-rating",
      "fields": [
        {
          "component": "container",
          "name": "basic",
          "label": "Basic",
          "collapsible": false,
          "...": "../form-common/_basic-input-fields.json"
        },
        {
          "component": "number",
          "name": "maxStars",
          "label": "Maximum stars",
          "valueType": "number"
        },
        {
          "...": "../../models/form-common/_help-container.json"
        }
      ]
    }
  ]
}
