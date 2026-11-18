# CSS Styling Patterns for Form Components

Source: [Customize the look of your forms — CSS Styling Patterns and Best Practices](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/universal-editor/style-theme-forms#comprehensive-form-styling-with-css-custom-properties) (Experience League).

The Adaptive Forms Block follows specific CSS patterns that keep styling maintainable, performant, and consistent across components. Follow them when writing `<name>.css` for a custom component.

---

## Primary styling patterns

**Component wrapper patterns.** Target field types through their consistent wrapper classes:

```css
/* Text input fields */
.form .text-wrapper input {
    padding: var(--form-input-padding);
    border: var(--form-input-border-size) solid var(--form-input-border-color);
    font-size: var(--form-input-font-size);
    border-radius: 4px;
    width: 100%;
}

/* Email input fields */
.form .email-wrapper input {
    padding: var(--form-input-padding);
    border: var(--form-input-border-size) solid var(--form-input-border-color);
    font-size: var(--form-input-font-size);
}

/* Button styling */
.form .button-wrapper button {
    background-color: var(--form-button-background-color);
    color: var(--form-button-color);
    padding: var(--form-button-padding);
    border: var(--form-button-border);
    font-size: var(--form-button-font-size);
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.form .button-wrapper button:hover {
    background-color: var(--form-button-background-hover-color);
}
```

---

## Advanced customization patterns

**Field-specific targeting.** Target an individual field by name for unique styling needs:

```css
/* Style specific fields */
.form .field-email input {
    background-image: url('data:image/svg+xml;...'); /* Email icon */
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 40px;
}

.form .field-phone input {
    text-align: center;
    letter-spacing: 1px;
    font-family: monospace;
}
```

**State-based styling.** Implement validation and interaction states:

The form block [adds `.field-invalid` to the field wrapper when showing an error and removes it when clearing the error](https://github.com/adobe-rnd/aem-boilerplate-forms/blob/02a535ab39da0e741de2660b4713ce72b9319071/blocks/form/util.js#L166-L182). Use this class rather than `data-valid` attributes. Its absence does not distinguish an untouched field from a validated field, so the example does not add a success style.

```css
/* Validation error state */
.form .field-invalid input {
    border-color: var(--form-error-color);
    box-shadow: 0 0 0 2px rgba(255, 95, 63, 0.1);
}

/* Focus states */
.form .text-wrapper input:focus,
.form .email-wrapper input:focus {
    outline: none;
    border-color: var(--button-primary-color);
    box-shadow: 0 0 0 2px rgba(95, 141, 218, 0.2);
}
```

---

## Applying this to a custom component's stylesheet

The `.{Type}-wrapper` class comes from the field's base `fieldType`, not from the component name. A `loan-slider` built on `number-input` renders as `<div class="number-wrapper field-wrapper field-<name>" data-id="…">`: the form block never adds a `.loan-slider-wrapper` class, so a selector such as `.form .loan-slider-wrapper .loan-slider-range` matches nothing and none of its rules apply.

- Start every selector with `.form` and a class that `decorate()` adds, prefixed with the component name: for example, `.form .loan-slider-widget` for the container element that `decorate()` creates.
- To style the field wrapper itself, add the class in `decorate()` (`fieldDiv.classList.add('<name>')`) and target that. Don't style `.{base type}-wrapper` in a component stylesheet: it also matches every other field of the same base type.
- Use field-name targeting (`.form .field-{name}`) only for one-off, form-specific styling, never in a reusable component's stylesheet.
- Style validation and interaction states with the state patterns above (validation, `:focus`).
