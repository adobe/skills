# Feature Highlights Block — JavaScript Implementation

## Problem/Feature Description

The product team at TechFlow wants to add a new "feature-highlights" block to their AEM Edge Delivery Services website. This block will appear on their product landing page and display a grid of feature cards, each containing an icon image, a short headline, and a descriptive paragraph. Authors will create the content in Google Docs using a two-column table where each row is one feature: the left cell contains the icon image and the right cell contains the heading and description text.

The block needs to support a `compact` variant that renders the features in a condensed single-row horizontal strip. For the standard variant, features appear in a grid layout with images displayed prominently. When the compact variant is active, only the icon and heading are shown (the description is hidden via a CSS class). The JavaScript decoration is entirely responsible for restructuring the authored table markup into the semantic grid/strip structure.

## Output Specification

Create the JavaScript decoration file for the `feature-highlights` block at the path:

```
blocks/feature-highlights/feature-highlights.js
```

The JS file should:
- Transform the authored table rows into a list of feature card elements
- Handle the `compact` variant by adding an appropriate class to hide descriptions
- Be structured so that a CSS file could later add styling without any changes to the JS

You do not need to create the CSS file — only the JS decoration file is required.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/sample-content.html ===============
<!-- This is an example of what the AEM platform delivers to the decorate function.
     The block receives this DOM structure as the `block` parameter. -->
<div class="feature-highlights">
  <div>
    <div><picture><img src="./images/icon-speed.png" alt="Speed icon"></picture></div>
    <div>
      <h3>Blazing Fast</h3>
      <p>Delivers sub-second page loads with edge caching and optimized bundles.</p>
    </div>
  </div>
  <div>
    <div><picture><img src="./images/icon-secure.png" alt="Security icon"></picture></div>
    <div>
      <h3>Enterprise Security</h3>
      <p>End-to-end encryption and SOC 2 Type II compliance out of the box.</p>
    </div>
  </div>
  <div>
    <div><picture><img src="./images/icon-scale.png" alt="Scale icon"></picture></div>
    <div>
      <h3>Infinitely Scalable</h3>
      <p>Auto-scales to handle traffic spikes without any configuration.</p>
    </div>
  </div>
</div>
