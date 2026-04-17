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
