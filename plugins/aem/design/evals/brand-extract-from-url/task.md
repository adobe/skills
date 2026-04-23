# Eval: brand extraction from a URL

## Setup

Empty project; no `aem-design/` folder.

## User prompt

"Extract the brand identity from https://www.stripe.com and save it."

## Expected behavior

The `brand` skill is invoked. It:

1. Uses Playwright (not WebFetch) to visit the URL and capture visual evidence.
2. Produces `aem-design/brand-profile.json` with color palette, typography, voice, and provenance block.
3. Produces `aem-design/brand-board.html` (self-contained HTML, no dev server) rendering the palette and type specimens.
4. Optionally writes `.impeccable.md` if a design personality emerges.
5. The brand-profile.json includes a `provenance` field listing the source URL and extraction method.
6. Does NOT reference EDS, AEM, `localhost:3000`, or dev servers.
