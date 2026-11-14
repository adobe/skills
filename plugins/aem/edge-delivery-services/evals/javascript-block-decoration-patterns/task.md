# Add a feature-highlights block

Authors want a `feature-highlights` block: a grid of feature cards, each with an icon, a headline and a short description. Each row of the block is one feature, icon in the first cell, headline and description in the second. Not every feature has an icon.

A `compact` option shows only the icon and headline of each feature, in a single horizontal row.

This is the block as delivered on the test page (`/drafts/features.plain.html`):

```html
<div class="feature-highlights">
  <div>
    <div>
      <picture>
        <source type="image/webp" srcset="./media_1a2b3c.png?width=2000&#x26;format=webply&#x26;optimize=medium" media="(min-width: 600px)">
        <source type="image/webp" srcset="./media_1a2b3c.png?width=750&#x26;format=webply&#x26;optimize=medium">
        <source type="image/png" srcset="./media_1a2b3c.png?width=2000&#x26;format=png&#x26;optimize=medium" media="(min-width: 600px)">
        <img loading="lazy" alt="Speed" src="./media_1a2b3c.png?width=750&#x26;format=png&#x26;optimize=medium" width="96" height="96">
      </picture>
    </div>
    <div>
      <h3 id="blazing-fast">Blazing Fast</h3>
      <p>Sub-second page loads with edge caching.</p>
    </div>
  </div>
  <div>
    <div>
      <picture>
        <source type="image/webp" srcset="./media_4d5e6f.png?width=2000&#x26;format=webply&#x26;optimize=medium" media="(min-width: 600px)">
        <source type="image/webp" srcset="./media_4d5e6f.png?width=750&#x26;format=webply&#x26;optimize=medium">
        <source type="image/png" srcset="./media_4d5e6f.png?width=2000&#x26;format=png&#x26;optimize=medium" media="(min-width: 600px)">
        <img loading="lazy" alt="Security" src="./media_4d5e6f.png?width=750&#x26;format=png&#x26;optimize=medium" width="96" height="96">
      </picture>
    </div>
    <div>
      <h3 id="enterprise-security">Enterprise Security</h3>
      <p>Encryption and SOC 2 Type II compliance out of the box. <a href="/security">Learn more</a></p>
    </div>
  </div>
  <div>
    <div>
      <h3 id="infinitely-scalable">Infinitely Scalable</h3>
      <p>Handles traffic spikes without configuration.</p>
    </div>
  </div>
</div>
```
