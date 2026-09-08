# stardust

> Modernise an existing website, with or without a redesign, and ship it.

Stardust is a Claude Code plugin for improving a website that already exists
and delivering the result. It started as a redesign tool and still puts design
first, but design is one of several things a modern site needs. Stardust
measures and works on all of them, and you choose which ones move. The design
craft itself comes from [impeccable](https://github.com/pbakaus/impeccable);
stardust owns the job of taking a live site from where it is to where you want
it, with every decision reasoned in the open before code runs.

## What stardust improves

| Dimension | Outcome |
|---|---|
| Design | The site keeps its current design, gets a new one resolved from your intent, or adopts a donor's. The result is measured against the source or the target spec, and template-looking output is rejected. |
| Performance | Core Web Vitals are scored on the live site before and after. Delivered pages swap fonts without layout shift, reserve space for late-loading chrome, and load the first image eagerly. |
| SEO and technical | Every page has a title, description and canonical. The site has a sitemap, redirects for changed paths, robots rules and structured data. Internal links resolve on the new origin instead of bouncing to the old one. |
| LLM and AI-search visibility | Key facts sit in server-rendered HTML where crawlers and AI bots read them. `llms.txt` and schema coverage are checked. |
| Accessibility | Contrast, alt text, landmarks and a single `<h1>` per page, verified with axe on the delivered site. |
| Content fidelity | Copy is carried verbatim and counted per page. Nothing is dropped, invented or reworded without a logged reason. |
| Platform | A static HTML tree that runs on any host, or a delivery to the target platform through the delivery layer. |

## Two layers

Stardust has a platform-agnostic core and an EDS-specific delivery layer. The
core never mentions EDS. The delivery layer consumes the core's output and is
the only place where blocks, Document Authoring and AEM appear. You can stop
after the core and host the static tree anywhere.

```
platform-agnostic core                          EDS delivery
────────────────────────────────────────────    ─────────────────────────────
extract → direct → prototype → migrate     ──▶  deploy → rollout → qa
replica ─────────────────────┘                  (diff is used by both)
reskin ──────────────────────┘
audit, uplift (standalone)
```

**Platform-agnostic core.** Eleven skills that read a live site and produce
a redesign, a replica or a reskin as self-contained static HTML under
`stardust/`. Nothing in them assumes a CMS.

- `extract` crawls the site (capped, multi-page) and writes the captured
  design system, brand surface, per-page inventory and rendered DOM to
  `stardust/current/`.
- `direct` resolves your intent into a target `PRODUCT.md` and `DESIGN.md`,
  with reference research when the refero MCP is present and the reasoning
  kept in `stardust/direction.md`.
- `prototype` renders before/after pages under `stardust/prototypes/` and
  iterates them through impeccable's craft loop.
- `prepare-migration` runs extract, direct and prototype in `--prep` mode
  with confirmation gates, for the redesign migration flow.
- `replica` recreates one archetype per page type as clean HTML/CSS that
  matches the live site near pixel-perfect, proven by a measured gate.
- `reskin` re-lays byte-faithful content onto a donor design system.
- `migrate` applies the approved design or replica to every page and writes
  the deployable static tree to `stardust/migrated/`, one fidelity tier per
  page.
- `audit` scores any URL across the dimensions above.
- `uplift` turns a URL into three presales redesign variants without further
  input.
- `diff` compares any prototype with any build, pixel and structure, through
  an `eds` or `generic` profile.
- `stardust` is the master skill: setup, routing, state report, hands-off
  mode.

Outputs: `stardust/current/`, `stardust/prototypes/`, `stardust/migrated/`,
`stardust/state.json`, `stardust/status.jsonl`, `stardust/learnings.md`.

**EDS delivery.** Three skills that take the migrated tree to AEM Edge
Delivery Services.

- `deploy` converts one page into EDS blocks under `blocks/` and Document
  Authoring content under `content/`, then writes it through the DA Source
  API. Each prototype section becomes a block. Content structure passes the
  David's Model lint, blocks pass the Experience Workspace editability gate,
  internal links are localized, and a per-page atomic contract checks the
  delivered page before it counts as deployed.
- `rollout` delivers the whole site: coverage ledger, block dedup, per-page
  delivery through `deploy`, site assembly (sitemap, redirects, dynamic
  listings, multilingual trees), full-site verify and link audit, an
  optimize gate that aggregates accessibility, SEO, AI-search and
  brand-tension findings, deterministic AEM autofixes, and a report.
- `qa` sweeps the live EDS site read-only: routing, content fidelity against
  the capture, template conformance, rendered integrity, visual regression,
  metadata and JSON-LD, links, axe accessibility, performance budgets,
  editability. It reports and never fixes.

Outputs: `blocks/`, `content/`, `stardust/rollout/` (ledger, coverage,
findings, dashboard), `stardust/qa/`.

## Two migration flows

A migration to EDS starts with one question: does the design stay or change?
The answer picks the flow. The delivery layer is the same for both, the two
flows are never mixed, and the master skill names the chosen flow in its first
reply to any "how do I migrate this site" question.

| | Keep the design | Redesign on the way |
|---|---|---|
| Core (agnostic) | `replica` → `migrate` | `prepare-migration` (or `extract` → `direct` → `prototype`) → `migrate` |
| Delivery (EDS) | `deploy` for a pilot page, `rollout` for the site, `qa` after | same |
| Design source | The captured site. Changes only through an inconsistency register, which is usually empty. | Your intent, resolved into a target spec. |
| Prep step | None besides replica itself. Never run `prepare-migration` with it. | `prepare-migration`, or the three skills by hand. |

### Keep the design: `replica` → `migrate` → `deploy` / `rollout`

1. `extract --prep` runs as replica's first phase and captures the full
   inventory.
2. The captured design system becomes the target spec by mechanical
   promotion. The only permitted design changes are the entries of an
   explicit inconsistency register.
3. One archetype per page type is recreated as clean semantic HTML/CSS with
   values lifted from the source's own CSS. Never a DOM copy.
4. Each archetype is gated against the live site per breakpoint: structural
   content diff, visual heuristics, stitched pixel diff with a three-iteration
   cap, a crop gate for header, footer and sticky strips, a computed-style
   chrome-parity probe, and interaction parity observed at runtime rather than
   inferred from CSS.
5. Siblings are cloned through `migrate` at the sibling tier after a live
   variance probe has budgeted template deltas as block variants.
6. EDS delivery, with the final gate run against the published origin rather
   than a local harness.

### Redesign on the way: `prepare-migration` → `migrate` → `deploy` / `rollout`

1. `extract --prep` crawls the full inventory and types the pages.
2. `direct --prep` resolves the intent into `PRODUCT.md` and `DESIGN.md` and
   confirms page types and the module catalog.
3. `prototype --prep` produces one archetype prototype per page type plus the
   design canon, through impeccable's craft loop with anti-template,
   brand-tension and vision-verified checkpoints.
4. `migrate` applies canon and modules to every page with a declared
   fidelity tier (archetype, sibling or thin), content preserved verbatim
   and counted.
5. EDS delivery.

## Other entry points

- `audit <url>` when you want the scorecard before deciding anything.
- `reskin` when the content stays and the design comes from another live
  site or from local prototypes. Content is gated byte for byte; the layout
  adapts to the donor's modules. Delivery is the same EDS layer.
- `uplift <url>` when you need a pitch: three differentiated variants, one of
  them cinematic, from the URL alone.
- `extract` → `direct` → `prototype` → `migrate` when you want a redesign
  as static HTML with no platform change.

## Hands-off mode

Production migrations run the whole chain without conversational gates.
Decisions that would normally pause for you are resolved from the captured
evidence and logged, run status streams to `stardust/status.jsonl`, and each
run appends to `stardust/learnings.md`. General findings from that ledger are
folded back into the skills. The chrome crop gate, the sizing-model lift, the
editability contract, link localization and the glyph-noise floor all entered
the plugin that way.

## Dependencies

Stardust requires impeccable and has no fallback. The dependency is
deliberately unpinned so that the design craft is always the current release,
and the setup step prints one line when a newer impeccable is available than
the one installed.

Three integrations are used when present and skipped when absent: the refero
MCP for `direct`'s reference research, modern-web-guidance for platform best
practices, and the marketing-skills `seo-audit`, `schema`, `ai-seo` and
`site-architecture` skills, which feed `audit` and rollout's optimize gate.

## Status

`v0.19.x` folds a series of field harvests from same-design migrations into
the skills: element-anchored chrome crop gates, chrome-parity and row-profile
instruments, rendered-DOM capture, link localization as a deploy stage,
dropped-content and script-text detectors, sibling variance probing, and the
impeccable update hint. [CHANGELOG.md](CHANGELOG.md) has the full list.

## License

Apache-2.0
