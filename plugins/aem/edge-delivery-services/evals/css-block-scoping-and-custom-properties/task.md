# Testimonial Carousel Block — CSS Styling

## Problem/Feature Description

The marketing team at Acme Corp has just launched a redesign of their AEM Edge Delivery Services website. The development team already implemented the JavaScript decoration logic for a new `testimonial-carousel` block, but the CSS file was never written. The block displays customer testimonials in a horizontal carousel, and it supports two visual variants: a standard light background version and a `dark` variant with an inverted color scheme.

The design team's requirements are: on mobile, testimonials should stack vertically in a single column; on tablet (medium screens), items should be displayed side by side in two columns; on desktop (wide screens), up to three columns should be visible. The dark variant needs a darker background and light text, and should still follow the standard column layout rules. The block also needs proper typography for the quote text and a byline with author name and company.

## Output Specification

Create the CSS file for the `testimonial-carousel` block at the path:

```
blocks/testimonial-carousel/testimonial-carousel.css
```

The CSS should:
- Style the block container and its child elements (items, quote text, byline, author name, company)
- Implement the responsive column layout described above
- Style the dark variant
- Ensure fonts and colors are consistent with the site's design system

Do NOT create any JavaScript files — only the CSS file is needed.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: blocks/testimonial-carousel/testimonial-carousel.js ===============
/**
 * Decorate the testimonial-carousel block
 * @param {Element} block the block
 */
export default async function decorate(block) {
  const items = [...block.querySelectorAll(':scope > div')];

  const list = document.createElement('ul');
  list.className = 'items';

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'item';

    const quoteEl = item.querySelector('p:first-child');
    const bylineEl = item.querySelector('p:last-child');

    if (quoteEl) {
      const blockquote = document.createElement('blockquote');
      blockquote.className = 'quote';
      blockquote.append(quoteEl);
      li.append(blockquote);
    }

    if (bylineEl) {
      const byline = document.createElement('div');
      byline.className = 'byline';
      byline.append(bylineEl);
      li.append(byline);
    }

    list.append(li);
  });

  block.replaceChildren(list);
}

=============== FILE: styles/styles.css ===============
/* excerpt of the project's styles.css */
:root {
  /* colors */
  --background-color: white;
  --light-color: #f8f8f8;
  --dark-color: #505050;
  --text-color: #131313;
  --link-color: #3b63fb;
  --link-hover-color: #1d3ecf;

  /* fonts */
  --body-font-family: roboto, roboto-fallback, sans-serif;
  --heading-font-family: roboto-condensed, roboto-condensed-fallback, sans-serif;

  /* body sizes */
  --body-font-size-m: 22px;
  --body-font-size-s: 19px;
  --body-font-size-xs: 17px;

  /* heading sizes */
  --heading-font-size-xxl: 55px;
  --heading-font-size-xl: 44px;
  --heading-font-size-l: 34px;
  --heading-font-size-m: 27px;
  --heading-font-size-s: 24px;
  --heading-font-size-xs: 22px;

  /* nav height */
  --nav-height: 64px;
}

@media (width >= 900px) {
  :root {
    /* body sizes */
    --body-font-size-m: 18px;
    --body-font-size-s: 16px;
  }
}
