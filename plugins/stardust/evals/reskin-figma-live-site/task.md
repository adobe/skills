# Eval: reskin — live-site content onto a Figma design

The path Auto runs: the content comes from a live site, the design from a
Figma file.

## Setup

A clean project. Network access to a stable public CONTENT site and the
Figma REST API. `FIGMA_TOKEN` (a personal access token with
`file_content:read`) is set in the environment and nowhere else. The runner
pins the pair: the content page and a Figma kit whose modules have desktop
and mobile frames (structure drift is expected maintenance). Impeccable
installed. Node + Playwright available.

## User prompt

"$stardust reskin — rebuild https://<content-site-page> with the design in
https://www.figma.com/design/<file-key>/<kit> and take it to EDS"

## Expected behavior

The stardust `reskin` skill is invoked with a Figma donor
(`reference/donor-sources.md` § 3). It:

1. **Captures the Figma donor headlessly**: `figma-donor.mjs capture` over
   REST (no browser, no MCP), the token read from `FIGMA_TOKEN` only;
   foundation values cite their node, `_crawl-log.json` records
   `fetchTechnique: "figma-rest"`. It authors `reskin/curation-rules.json`,
   then runs `curate` and `stamp`.
2. **Captures the content from the live site** with `capture-content.mjs`
   and the scope-coverage check, never from the Figma frames: text, CTAs,
   images and SEO metadata are the live page's.
3. **Maps and renders**: `mapping.md` maps every content slot to a Figma
   module (`M<n>`); the renderer interpolates the content model; the
   surface comes from `donor-tokens.json`.
4. **Runs the gates**: content (`dom-equality` + `slot-coverage`),
   design adoption (`donor-probe`, overflow at 1440/360) and Figma
   fidelity (`figma-gate all` with a checks file that has a mobile root
   for every module with a mobile frame). One fix iteration, then
   residuals.
5. **Hands off to migrate** through the bridge (`canon-from-reskin`,
   `reskin-ledger`, `reskin-preflight` exit 0) and deploys to EDS: every
   block gets its `.js` and `.css`.

## Failure modes this eval pins against

- Figma sample text, placeholder copy or sample image sizes in the output.
- The content site's own colours, fonts or layout instead of the kit's.
- A desktop-only page: mobile frames in the kit, no mobile root checked.
- A waiver or accepted residual that the run does not record.
- `FIGMA_TOKEN` written to a file, a log or `state.json`.
- A CSS-only block, or a block named outside the EDS map.
- Sibling pages rendered before `reskin-preflight` exits 0.
