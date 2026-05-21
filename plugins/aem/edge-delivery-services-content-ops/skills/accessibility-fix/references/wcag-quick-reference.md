# WCAG 2.1 AA Quick Reference for AEM Edge Delivery Services

A concise reference for the WCAG 2.1 AA criteria most relevant to EDS sites. For each criterion: what it means for EDS, where to fix it, and common violations.

---

## 1.1.1 Non-text Content

Every non-text element (images, icons, charts) must have a text alternative that serves the same purpose.

- **Where to fix:** Source document (Google Docs image properties, Word alt text panel, da.live image settings).
- **Common EDS violations:** Images dragged into the document without setting alt text. Alt text left as the filename. Decorative images given descriptive alt text instead of empty alt.

---

## 1.3.1 Info and Relationships

Information conveyed through presentation (headings, lists, tables, emphasis) must also be conveyed programmatically.

- **Where to fix:** Source document (use Heading styles for headings, list formatting for lists, table insertion for tabular data).
- **Common EDS violations:** Heading levels chosen for visual size instead of structure. Lists typed as paragraphs with dashes instead of using list formatting. Bold text used to simulate a heading without applying a Heading style.

---

## 1.4.3 Contrast (Minimum)

Text and images of text must have a contrast ratio of at least 4.5:1 (normal text) or 3:1 (large text: 18px+ or 14px+ bold).

- **Where to fix:** `styles.css` (CSS custom properties for colors). Never in the source document.
- **Common EDS violations:** Light gray text on white backgrounds. Link colors that lack sufficient contrast. Button text on colored button backgrounds. Text on colored section backgrounds where the section-specific overrides were not checked.

---

## 2.1.1 Keyboard

All functionality must be operable through a keyboard interface without requiring specific timings.

- **Where to fix:** Block JavaScript files (e.g., `accordion.js`, `tabs.js`, `carousel.js`, `nav.js`).
- **Common EDS violations:** Custom blocks that only respond to click events, not keyboard events. Hamburger menu not operable with Enter/Space. Carousel slides not navigable with arrow keys. Accordion toggles not focusable or activatable with keyboard.

---

## 2.4.1 Bypass Blocks

A mechanism must be available to bypass repeated content (navigation, headers).

- **Where to fix:** Header block JavaScript or `head.html` (add a skip-to-main-content link).
- **Common EDS violations:** No skip navigation link. EDS boilerplate does not include one by default — it must be added to the header block or `head.html`.

---

## 2.4.2 Page Titled

Pages must have titles that describe their topic or purpose.

- **Where to fix:** Source document metadata table (the `title` row) or the page's metadata sheet.
- **Common EDS violations:** Missing title metadata (EDS falls back to a generic or empty title). Title that duplicates another page's title. Title that does not reflect the actual page content.

---

## 2.4.4 Link Purpose (In Context)

The purpose of each link can be determined from the link text alone, or from the link text together with its surrounding context.

- **Where to fix:** Source document (edit the link text directly).
- **Common EDS violations:** "Click here", "Read more", "Learn more" as link text. Bare URLs used as link text. Multiple "Read more" links on the same page pointing to different destinations. Image links with no alt text (the link has no accessible name).

---

## 2.4.6 Headings and Labels

Headings and labels describe the topic or purpose of the content they introduce.

- **Where to fix:** Source document (rewrite headings to be descriptive).
- **Common EDS violations:** Generic headings like "Overview", "Details", or "More Information" that do not distinguish sections. Headings that match the CTA rather than describing the section content.

---

## 3.1.1 Language of Page

The default human language of the page must be programmatically determinable.

- **Where to fix:** `head.html` (add `lang` attribute to the `<html>` element) or site configuration.
- **Common EDS violations:** Missing `lang` attribute entirely. The EDS boilerplate may not set this by default. Incorrect language code for non-English sites.

---

## 4.1.2 Name, Role, Value

All user interface components must have accessible names and expose their states programmatically.

- **Where to fix:** Block JavaScript and CSS files.
- **Common EDS violations:** Accordion blocks without `aria-expanded`. Tab blocks without `role="tablist"` / `role="tab"` / `role="tabpanel"`. Modal blocks that do not set `role="dialog"` or `aria-modal="true"`. Buttons created with `<div>` or `<span>` instead of `<button>` in block JS. Custom interactive elements missing ARIA attributes.

---

## Quick Decision: Document Fix vs. Code Fix

| Criterion | Typical Fix Location |
|-----------|---------------------|
| 1.1.1 Non-text Content | Document |
| 1.3.1 Info and Relationships | Document |
| 1.4.3 Contrast Minimum | `styles.css` |
| 2.1.1 Keyboard | Block JS |
| 2.4.1 Bypass Blocks | Header block JS or `head.html` |
| 2.4.2 Page Titled | Document metadata |
| 2.4.4 Link Purpose | Document |
| 2.4.6 Headings and Labels | Document |
| 3.1.1 Language of Page | `head.html` or site config |
| 4.1.2 Name, Role, Value | Block JS |
