# Content preservation

What `migrate` keeps from the existing site, what it transforms, and
what it explicitly drops. The default answer is "preserve everything";
deviations require a basis in `direction.md`.

---

## Preserve verbatim

These are the things the redesign **never** changes unless
`direction.md § Anti-references` or a sibling note explicitly
authorises it:

- **Headline text** for every heading in `current/pages/<slug>.json §
  headings`. The redesign restyles type, scale, and rhythm — not what
  the headlines say.
- **Body copy** for every paragraph and list item. Restyle, do not
  rewrite.
- **CTA labels** for every button and button-styled link. The visual
  treatment changes; the label does not.
- **Navigation labels** in headers and footers.
- **Form fields** — name, type, label, required state, placeholder.
  The form's visual treatment changes; the schema does not.
- **Link destinations.** Every `href` resolves to the same target.
  Internal links are rewritten to the migrated tree (see § Internal
  link rewriting); external links are passed through untouched.
- **Alt text** for every image.
- **Sequence and grouping** of content within sections, unless
  `direction.md` explicitly authorises a structural change for this
  page.

When migrate cannot preserve a content item — it doesn't fit the
chosen component, it overflows a constraint, it duplicates something
the new IA already covers — the deviation goes in the provenance
block's `contentDeviations[]` array with `{ kind, source, target,
reason }` so the user can audit.

## Transform with rules

- **Tone of microcopy** that the redesign explicitly governs through
  `DESIGN.json.narrative.dos` / `donts` (e.g., voice rules carried
  from the divergence toolkit § 7). Migrate may apply minor tone
  adjustments to *button microcopy and inline labels* — never to
  headlines or body paragraphs. Each adjustment is logged in
  `contentDeviations[]`.
- **Internal link paths** are rewritten per § Internal link
  rewriting.
- **Asset paths** are rewritten per § Media references.
- **Whitespace and line breaks** in copy are normalised; trailing
  whitespace and double-spaces collapse.

## Drop deliberately

- **Inline analytics tags and tracking pixels** (Facebook pixel,
  Google Tag Manager, Hotjar, Segment, Linkedin Insight). The
  migrated site is a static HTML deliverable; tracking is added back
  during deploy by a separate concern.
- **Cookie consent banners.** Same reason — re-add at deploy time
  with the org's preferred CMP.
- **Embedded chat widgets** (Intercom, Drift, Zendesk Chat). Re-wire
  at deploy.
- **Inline JS for polyfills, A/B testing harnesses, feature flags,
  experiment SDKs.** Out of scope for static HTML output.
- **Empty or placeholder sections** (`<section><!-- TODO --></section>`
  in the current site). Drop and log.

Every drop is logged in `contentDeviations[]` with `kind: "dropped"`
and a `reason`.

## Internal link rewriting

For every `<a href>`:

1. **Skip** when href starts with `#` (intra-page anchor),
   `mailto:`, `tel:`, `javascript:`, or a non-HTTP scheme.
2. **External** (different host than `state.json.site.originUrl`):
   pass through unchanged.
3. **Internal** (same host, including same-host with absolute URL):
   - Strip origin and tracking params (`utm_*`, `gclid`, `fbclid`).
   - Look up the target path in `state.json.pages[].url` to find the
     slug.
   - If found, rewrite href to the migrated path (per the slug
     mapping in `migration-procedure.md` § Output path mapping).
     Use **root-relative** paths (`/about/`, `/docs/api/`) so the
     migrated site moves cleanly across hosts.
   - If not found (target was never extracted or was filtered out),
     compute the migrated path the slug would resolve to (per
     `migration-procedure.md` § Output path mapping) and rewrite
     the href to that path anyway. Mark the link
     `data-broken-link="true"` and log under
     `provenance.brokenInternalLinks[]`. The migrated tree stays
     internally consistent — every same-host link is a relative
     migrated path; broken links surface as an explicit signal,
     not as escape hatches to the live origin. The user resolves
     by extracting the missing page (and re-running migrate) or
     accepting the broken link.
4. **Preserve** any href fragment (`#section-3`) and query string
   (`?ref=foo`) exactly when rewriting.

## Media references

For every `<img>`, `<video>`, `<source>`:

1. Look up the original URL in
   `current/pages/<slug>.json § media.images[].src` (or
   `media.videos[]`).
2. Find the `localPath` recorded by extract
   (`stardust/current/assets/media/<basename-with-hash>.<ext>`).
3. **Copy** the local file to
   `stardust/migrated/assets/media/<basename-with-hash>.<ext>` (only
   if not already there).
4. **Rewrite** the `src` to a relative path: `/assets/media/<basename-with-hash>.<ext>`.
5. **Preserve `srcset`, `sizes`, `loading`, `decoding`, `alt`,
   `width`, `height`** verbatim. Update `srcset` URLs the same way as
   `src`.
6. If the local file is missing (download failed at extract time),
   keep the original absolute URL and log under
   `provenance.contentDeviations[]` with `kind: "media-missing"`.

For inline SVGs, preserve the markup verbatim (modulo class-name
substitutions to match the new component classes when the component
template requires it).

For iframes (YouTube, Vimeo, Calendly): preserve the embed code
verbatim. They are external dependencies the migrated site depends on.

## Forms

The form **schema** (action, method, field set) is preserved
verbatim. The form's visual treatment is restyled per DESIGN.json
component `form` (or `input` + `button` if no form component is
defined).

Form actions pointing at third-party services (Stripe Payment Links,
Calendly, Typeform, Mailchimp, Formspree) are preserved as-is —
they continue to work after deploy.

Form actions pointing at the origin's own backend (e.g.,
`/api/contact`) are preserved with a warning logged in
`contentDeviations[]` with `kind: "self-hosted-form"` and a hint:
"the origin's `/api/contact` endpoint must remain available at the
migrated site's origin, or the form must be re-wired to a static-form
service."

## Voice and tone deviations

When the redesign moves the **tone** axis (per
`direction.md § Movements`), migrate may *not* re-write headlines or
body copy to match the new tone. It restyles only.

If the user wants tone-aligned copy, they run a separate pass:
`$impeccable clarify stardust/migrated/<slug>` after migration.
Stardust does not auto-trigger that.

## Headings hierarchy

Preserve the heading levels from `current/pages/<slug>.json §
headings`. The redesign may re-style headings dramatically but must
not skip levels (an `h2` cannot become an `h4`) or invent new
headings.

If the current site has skipped levels (`h1` → `h3`), migrate
**fixes** them by demoting where needed and logs the fix in
`contentDeviations[]` with `kind: "heading-level-fix"`. This is one
of the few accessibility corrections migrate makes by default.

## Lang and direction attributes

`<html lang="...">` is preserved from the current page's `language`
field. `<html dir="ltr|rtl">` is added when DESIGN.md's
`extensions.breakpoints.rtl` is true *or* when the current page was
RTL.

## Mass-applied direction-driven changes

The following come from `direction.md` and apply to every migrated
page identically (not page-by-page deviations):

- Logo path (always `/assets/logo.<ext>`).
- Favicon — extracted at extract time, variants generated at
  `prepare-migration` Phase 4, linked via `<link rel="icon">`
  per `metadata-and-jsonld.md` § Favicon.
- Site-wide nav structure — emitted from `stardust/canon/header.html`
  on every page; re-iterating the canon-author prototype updates
  it sitewide.

## Delegated concerns

This doc covers **body content**. Two adjacent concerns are
delegated to dedicated references:

- **Head metadata** (title, description, OG, Twitter, JSON-LD,
  canonical, robots, theme-color, favicon) →
  `metadata-and-jsonld.md`. The five-category model
  (system-fixed, brand-level, preserved, derived, stripped)
  governs head composition end-to-end.
- **Font handling** — `@font-face` URLs are downloaded to
  `stardust/migrated/assets/fonts/` during `prepare-migration`
  Phase 4 (assets prep). Migrate-time fonts are local; missing
  downloads surface a warning per affected page in the run
  summary.
