# Eval: figma-to-content vs stardust reskin — routing a Figma-only site

## User prompt

"We have no website yet. Here's our Figma file with the login and registration pages and our
component kit — build the site in EDS so the pages match the design exactly: <figma-url>"

## Expected behavior

The agent recognises a Figma-only multi-page site whose design system lives in the same Figma file and
routes to stardust reskin's Figma-only path (`figma-donor.mjs init` → `content` → render → Figma text
gate), or, when stardust is not installed, says so and explains that figma-to-content builds single
pages against an existing EDS project's blocks. It does not silently run figma-to-content page by page.
