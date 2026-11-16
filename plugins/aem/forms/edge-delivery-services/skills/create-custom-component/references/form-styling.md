# CSS Styling Patterns for Form Components

Source: [Customize the look of your forms — CSS Styling Patterns and Best Practices](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/edge-delivery/build-forms/universal-editor/style-theme-forms#comprehensive-form-styling-with-css-custom-properties) (Experience League).

The Adaptive Forms Block follows specific CSS patterns that keep styling maintainable, performant, and consistent across components. Follow them when writing `<name>.css` for a custom component. The `var(--…)` values are the form's CSS custom properties, defined at `:root` in `/blocks/form/form.css`.

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

```css
/* Validation states */
.form .field-wrapper[data-valid="false"] input {
    border-color: var(--form-error-color);
    box-shadow: 0 0 0 2px rgba(255, 95, 63, 0.1);
}

.form .field-wrapper[data-valid="true"] input {
    border-color: #28a745;
    box-shadow: 0 0 0 2px rgba(40, 167, 69, 0.1);
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

- Start every selector with `.form` and the component's own wrapper or class, e.g. `.form .<name>-…`, the same way the patterns above target `.form .{Type}-wrapper`.
- Use field-name targeting (`.form .field-{name}`) only for one-off, form-specific styling, never in a reusable component's stylesheet.
- Style validation and interaction states with the state patterns above (validation, `:focus`).
