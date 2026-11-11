# Authoring Model (contract section 1)

## Contents

- Personalized sections
- Grammar
- Sources
- Variants and fragments
- What the page shows
- Rendering prerequisite
- Placement

## Personalized sections

Authors personalize a **whole section** by adding rows to its Section Metadata.

- The section's authored content is the **default**. It stays where the author wrote it. Bots,
  visitors without consent, visitors no rule matches, failures and timeouts all see it.
- A **variant** is an EDS fragment. Its content replaces the section's content for the visitors it
  is chosen for.
- Nothing authored is ever moved, rewritten or deleted.

The browser runtime, the edge worker and this skill's scripts all use the same grammar code
(`scripts/personalization/section-spec.js`, unchanged), so every environment reads a section the
same way. The schema is `assets/contract/schemas/section.schema.json`.

```
| Section Metadata               |                                                     |
| Style                          | highlight                       (any other rows stay) |
| Personalization                | home-hero                                           |
| Personalization Source         | rules                           (default; split, api, target) |
| Personalization Variants       | /fragments/personalization/home-hero/india          |
|                                | /fragments/personalization/home-hero/na-mobile      |
| Personalization Rule India     | geo: IN                                             |
| Personalization Rule NA Mobile | geo: US, CA & device: mobile                        |
| Personalization Rule India 2   | param: utm_campaign=diwali                          |
```

In the content document (`content/<page>.html`, which is what DA stores), the rows form a
`section-metadata` block inside the section. The Variants cell has one link per paragraph. The
template is `assets/content/section-metadata.html`:

```html
<div>
  <h1>Original hero</h1>
  <p>Authored copy: the default.</p>
  <div class="section-metadata">
    <div><div><p>Personalization</p></div><div><p>home-hero</p></div></div>
    <div><div><p>Personalization Variants</p></div><div>
      <p><a href="/fragments/personalization/home-hero/india">/fragments/personalization/home-hero/india</a></p>
      <p><a href="/fragments/personalization/home-hero/na-mobile">/fragments/personalization/home-hero/na-mobile</a></p>
    </div></div>
    <div><div><p>Personalization Rule India</p></div><div><p>geo: IN</p></div></div>
    <div><div><p>Personalization Rule NA Mobile</p></div><div><p>geo: US, CA &amp; device: mobile</p></div></div>
  </div>
</div>
```

## Grammar

| Row | Value | For | Rules |
|---|---|---|---|
| `Personalization` | Section id, e.g. `home-hero` | All | `^[a-z0-9][a-z0-9_-]*$`, at most 64 characters, unique on the page. Used by `?pzn=`, the engine and events |
| `Personalization Source` | `rules` \| `split` \| `api` \| `target` | All | Optional; the default is `rules` |
| `Personalization Variants` | Fragment links, one per line | All (required) | The **allowlist**. Fragments must be under `fragmentPrefixes` (default `/fragments/`). The variant name is the last path segment. A variant named `default`, a duplicate name, or an item that isn't a fragment path is an error |
| `Personalization Rule <Variant>` | One condition (`criteria.md`) | `rules` (at least one); `api` (the fallback) | Checked top to bottom; the first match wins. `<Variant>` must name a listed variant. `Rule India 2` adds another rule for the same variant |
| `Personalization Split` | `40, 30` | `split` | One percentage per variant, in Variants order; the default gets the rest. Without the row, the split is even. More values than variants, or a total over 100, is an error |
| `Personalization Hint` | What the section should achieve (at most 500 characters) | `api` | Optional. Used by engines that choose with a model (OF1) |
| `Personalization Description <Variant>` | What that variant offers (at most 600 characters) | `api` | Optional. `Description Default` describes the authored content. Recommended for OF1 |
| `Personalization Location` | An existing Target location (mbox) | `target` | Use it when the location isn't the section id |
| `Personalization Trigger` | `scroll: 60%`, `view` or `load` | `target` | Makes the section a popup |
| `Personalization Display` | `inline` \| `popup` | `target` | Defaults to `popup` with a Trigger row, else `inline`. `popup` without a Trigger uses `scroll: 70%` |

Errors make the section invalid: it shows its default, with outcome `invalid` and a console
warning. The errors are:

- a row that belongs to another source, for example Split outside `split` or Hint outside `api`;
- Rule rows in a `split` or `target` section;
- a Rule or Description row that names no listed variant;
- a section that also carries AEM Experimentation metadata (`Experiment`, `Campaign`,
  `Audience: …`). One personalization per section.

Warnings:

- an unknown `Personalization <something>` row;
- a `rules` variant with no rule, which only a `?pzn=` preview can show;
- a Trigger with `Display | inline`.

Variant names and rule keys are compared loosely: case, spaces, `_` and `-` count as equal
(`Persona_A` = `persona-a`). This is needed because the pipeline keeps `_` in keys while older
`aem.js` turns it into `-`.

**Hint and Description rows are public**: they are in the page HTML. Write them like marketing
copy, with no internal notes and no personal data.

## Sources

| Source | Who decides | Without consent | Details |
|---|---|---|---|
| `rules` (default) | The Rule rows, in the browser or at the edge | Default, unless the `rules` exception applies | `criteria.md` |
| `split` | A random draw, kept for the session, against the default | Default and not assigned, unless the `split` exception applies | `split.md` |
| `api` | A decision engine, in one batched call; the Rule rows are the written fallback | Default, unless the `api` or `rules` exception applies | `decision-api.md` |
| `target` | Adobe Target, inline or as a popup | Default (popups wait); there is no exception | `target.md` |

Only listed variants are ever shown. A source that answers anything else gives outcome `fallback`
with reason `not listed: …`. There is no other source and no plugin mechanism in the first
release: any other engine uses the decision engine API. Consent is covered in `consent.md`.

## Variants and fragments

- **Location.** Variant fragments live at `/fragments/personalization/<id>/<variant>` by
  convention. Anything under `fragmentPrefixes` is allowed. Keep `fragmentPrefixes` the same in
  `config.js` and `edge-config.js`. URLs are reduced to their path, so a fragment always loads
  from the site itself.
- **Content only.** A variant contributes the children of every section of the fragment,
  flattened into the host section. The host section keeps its classes (`Style`), id and data
  attributes. The fragment's own Section Metadata is dropped.
- **Scaffolding.** Build every variant from the section's authored content: same blocks, images,
  buttons and heading level. Replace only the copy, with `TODO:` unless the user gave the copy. A
  bare heading drops the layout and costs CLS and LCP. `assets/content/fragment.html` is the bare
  scaffold for when there is nothing to copy.
- **First section.** The variant's first image gets `loading="eager"` and `fetchpriority="high"`.
- **Restrictions.** Fragments must be `noindex` (bulk metadata, see `da-content.md`). They must not
  contain a personalized section; the validator rejects nesting.

## What the page shows

Once decided, a section carries the decision as attributes. The same values go into the
`pzn:decided` event (`decisions-and-measurement.md`).

| Attribute | Value |
|---|---|
| `data-pzn-variant` | What is shown: a variant name, or `default` |
| `data-pzn-source` | `rules`, `split`, `api`, `target`, `override` (`?pzn=`) or `bot`. An `api` section that fell back to its Rule rows says `rules` |
| `data-pzn-outcome` | `variant`, `control`, `intentional-default`, `no-match`, `low-confidence`, `no-consent`, `fallback`, `timeout`, `error`, `invalid`, `bot` or `override` |
| `data-pzn-reason` | Why, when it isn't obvious: `HTTP 500`, `not listed: x`, `fragment failed: /path`, `no decision`, or the engine's reason code |
| `data-pzn-decision` | The `decisionId`: `<id>#1`, then `#2` and so on after re-evaluations |
| `data-pzn-status` | `applied` (browser). From the edge: `applied` or `selected` |
| `data-pzn-where` | `edge` when the edge decided the section |
| `data-pzn-cached` | `true` when the answer came from a cache |
| `data-pzn-tracking` | Edge only: the engine's `tracking` JSON (at most 1 KB, no personal data) |

## Rendering prerequisite

The rows reach the runtime only as `data-personalization*` attributes on the section. Two setups
produce them:

- **Pipeline (rendering v2).** The Helix pipeline turns Section Metadata into section attributes
  when the site renders with version 2 or later. Sites created on or after 2026-05-01 do this by
  default. How rows and cells are converted:
  - Row names go through `toMetaName`: characters outside `[0-9a-zA-Z:_-]` become `-`, then the
    name is lowercased (`Personalization Rule NA Mobile` → `data-personalization-rule-na-mobile`).
  - Link cells become their absolute URLs (the link text is dropped).
  - Text is split on commas, trimmed and re-joined with `,`. Several paragraphs in one cell are
    joined with `,`.
  - A repeated row keeps its first position but takes the **last** value. Two
    `Personalization Rule India` rows therefore silently lose one: number them.
- **Older `aem.js`.** If its `decorateSections` still reads the `section-metadata` block in the
  browser, it produces the same attributes before the hook runs. This works too.

`detect-project.mjs` reports which setup renders the site (`sectionMetadata.renderedBy`).
`validate-placeholders.mjs` renders local content the way the pipeline does and flags repeated rows
and multi-paragraph rule cells. When `verify-preview.mjs` finds no personalized section on the
page, it fails with a rendering-v2 hint.

## Placement

- Personalize one section per region and keep the rest of the page as authored. If only part of
  a section should change, split it in two and copy its `Style` row to the new section.
- For content only some visitors see (a welcome-back banner), add a new section that contains only
  its Section Metadata. Its default is empty, so everyone else, bots included, sees nothing.
- **The first section holds the LCP.** In the browser it stays hidden until it is decided, for up
  to `budgets.eager` (800 ms). Prefer the edge for it (`rules`, `split`, `api`), or personalize a
  later section. `target` is browser-only, so use a popup or a later section. The validator fails
  a slow engine (`of1`) on a first section decided in the browser.
- Don't personalize regions that Target already changes (VEC, at.js or Web SDK auto-rendering), or
  a page that runs an AEM Experimentation page experiment.
- Avoid personalizing the H1 or the main SEO copy. If the user insists, keep the H1 in the
  default and in every variant, and keep the variants semantically equivalent
  (`cross-cutting.md`).
- Text tokens (`{name}`) are not sections: use the placeholders sheet.
