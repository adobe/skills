# stardust

> Modernise an existing website — with or without a redesign — and ship it.

Stardust is a Claude Code plugin for taking a website that already exists and
making it measurably better, then delivering the result. It grew out of a
redesign tool and keeps that DNA: it is opinionated about what *better* looks
like, reasons every decision in the open before code runs, and delegates the
design craft itself to **[impeccable](https://github.com/pbakaus/impeccable)**.
But design is one dimension of a modern site, not the whole job. Stardust
treats modernisation as several dimensions at once, and lets you decide which
ones move.

| Dimension | What stardust does about it | Where |
|---|---|---|
| **Design** | Capture the current design system; keep it, refresh it from an intent, or adopt a donor's; anti-template and brand-tension gates | `extract`, `direct`, `prototype`, `replica`, `reskin`, `uplift` |
| **Performance** | Core Web Vitals scored on the live site; self-hosted metric-matched fonts, reserved chrome, eager LCP images and CLS probes on the delivered pages; perf budgets in QA | `audit`, `deploy`, `qa` |
| **SEO / technical** | Titles, descriptions, canonicals, sitemap, redirects, robots, JSON-LD; path-safety and link localization at delivery; deterministic autofixes | `audit`, `migrate`, `rollout`, `qa` |
| **LLM / AI-search visibility** | Answerability, `llms.txt`, schema coverage, key facts crawlable in server-rendered HTML rather than only in chrome | `audit`, `deploy`, `rollout` |
| **Accessibility** | Contrast, alt coverage, landmarks, one `<h1>`; axe sweep on the deployed site | `audit`, `rollout`, `qa` |
| **Content fidelity** | Verbatim copy, measured per page at import time; byte-level gates when the design changes | `migrate`, `replica`, `reskin`, `qa` |
| **Authoring** | Generated blocks stay editable in Experience Workspace; David's Model content structure enforced by a lint | `deploy`, `rollout` |
| **Platform** | Delivery to AEM Edge Delivery Services via Document Authoring, or platform-agnostic static HTML | `migrate`, `deploy`, `rollout` |

## Start from your goal

The first question stardust asks about a site is not "what should it look
like" but "what are you trying to do". The answer picks the flow; the
delivery chain downstream is shared.

| You want to… | Flow | Design |
|---|---|---|
| Know where the site stands today | `audit <url>` — scored report across the dimensions above | unchanged |
| **Move to a new platform and keep the current design** | `replica` → `migrate` → `deploy` / `rollout` | kept, near pixel-perfect |
| **Move to a new platform and redesign on the way** | `prepare-migration` (or `extract` → `direct` → `prototype`) → `migrate` → `deploy` / `rollout` | new, from your intent |
| Keep the content, take the design from elsewhere | `reskin` (donor = another live site or local prototypes) → `deploy` / `rollout` | donor's |
| See what a redesign could be, for a pitch | `uplift <url>` — three differentiated variants, one cinematic, from the URL alone | proposed |
| Redesign without changing platform | `extract` → `direct` → `prototype` → `migrate` (static HTML) | new |

Two of these are full **migration flows**. They must never be mixed, and the
master skill states which one applies in its first answer to any "how do I
migrate X" question.

### Migration without redesign — `replica`

Same pages, same content, same design, new platform. Every judgement call is
a measurement-policy call, never a taste call.

1. **Capture** the full inventory (`extract --prep` runs as replica's first
   phase; no separate `prepare-migration`).
2. **Preserve the direction** mechanically: the captured design system *is*
   the target spec. The only permitted design changes are entries in an
   explicit **inconsistency register**; an empty register is the common case.
3. **Recreate one archetype per page type** as clean semantic HTML/CSS —
   never DOM copies — with values lifted from the source's own CSS.
4. **Gate it against the live site** per breakpoint: structural content
   diff, visual heuristics, stitched pixel diff with a hard iteration cap,
   a separate chrome crop gate for header/footer/strips, a computed-style
   chrome-parity probe, and observed (never inferred) interaction parity.
5. **Fan out** to siblings via `migrate` at the sibling tier, after a live
   variance probe budgets template deltas as block variants, then
   `deploy` / `rollout`. The final gate runs against the **published
   origin**, not a local harness.

### Migration with redesign — `prepare-migration` → `migrate`

The site is re-platformed *and* moves to a new design resolved from your
intent ("more expressive for a younger audience", "calmer, more editorial").

1. **`extract --prep`** — full-inventory crawl, page typing, module catalog.
2. **`direct --prep`** — intent → target `PRODUCT.md` + `DESIGN.md`,
   grounded in reference research, with the reasoning trace kept.
3. **`prototype --prep`** — one archetype prototype per page type plus the
   design canon, iterated through impeccable's craft loop with
   anti-template, brand-tension and vision-verified checkpoints.
4. **`migrate`** — apply canon and modules to every page with a declared
   fidelity tier (archetype / sibling / thin), content preserved verbatim
   and measured.
5. **`deploy` / `rollout`** — the shared delivery chain below.

`prepare-migration` orchestrates steps 1–3 with confirmation gates; running
the three skills yourself is equivalent.

### Shared delivery chain

- **`deploy`** — one page → EDS blocks + Document Authoring content. Each
  prototype section becomes a block; content structure follows David's
  Model (mechanical lint); blocks obey the Experience Workspace editability
  contract; internal links are localized; fonts, chrome reservation and LCP
  handling keep CLS low; a per-page atomic contract verifies the delivered
  page before it counts as deployed.
- **`rollout`** — the whole site: inventory and coverage ledger, block
  dedup, per-page delivery through `deploy`, site assembly (sitemap,
  redirects, dynamic listings, multilingual trees), full-site verify and
  link audit, then an **optimize gate** that aggregates findings from the
  audit sources (accessibility, SEO, AI-search, brand tensions) and applies
  deterministic AEM autofixes before the report.
- **`qa`** — read-only sweep of the live site: routing, content fidelity vs
  the capture, template conformance, rendered integrity, visual regression,
  metadata and JSON-LD, links, axe accessibility, performance budgets,
  editability. Finds; never fixes.
- **`diff`** — pixel and structural fidelity probes between any prototype
  and its build, reused by every gate above.

## Skills

| Skill | Owns |
|---|---|
| `stardust` | Master skill: setup, goal-based routing, state report, hands-off mode |
| `audit` | Design + SEO + LLM-visibility + Core Web Vitals audit of any URL → scored report |
| `extract` | Capture the current site: design system, brand surface, per-page inventory, rendered DOM |
| `direct` | Resolve intent into a target design spec with a reasoning trace |
| `prototype` | Per-page before/after prototypes through the impeccable craft loop; optional motion register |
| `prepare-migration` | The redesign-flow prep cascade with confirmation gates |
| `replica` | Same-design migration with a measured source-fidelity gate |
| `reskin` | Byte-faithful content onto a donor design system |
| `uplift` | One-shot presales redesign: URL in, three variants out |
| `migrate` | Render every page to platform-agnostic static HTML with fidelity tiers |
| `deploy` | One page → EDS blocks + DA delivery |
| `rollout` | Whole-site delivery, optimize gate, autofix, report |
| `qa` | Read-only post-deploy QA sweep |
| `diff` | Prototype ↔ build fidelity probes |

The platform-agnostic core (`extract` → `direct` → `prototype` → `migrate`)
never leaks EDS concepts; the delivery skills consume its output.

## Hands-off production mode

For production migrations the whole chain runs end-to-end without
conversational gates: decisions that would normally pause for the user are
resolved from the captured evidence and logged, run status streams to
`stardust/status.jsonl`, and every run appends to a **learnings ledger** whose
general findings are folded back into the skills. Much of what the skills
know today — chrome crop gates, sizing-model lifts, editability contracts,
link localization, glyph-noise floors — came in through that loop.

## Optional integrations

Used when present, degrade gracefully when absent:

- **refero MCP** — real-site reference research for `direct`.
- **modern-web-guidance** — current platform best practices.
- **marketing-skills** — `seo-audit`, `schema`, `ai-seo` and
  `site-architecture` feed `audit` and rollout's optimize gate.

## Hard dependency

Stardust requires impeccable and ships no fallbacks. The dependency is
deliberately **unpinned** — the design craft should always be the current
release — and the setup step prints a one-line hint when a newer impeccable
is available than the one installed.

## Status

`v0.19.x` — a series of field harvests from same-design migrations folded
into the skills: element-anchored chrome crop gates, computed-style
chrome-parity and row-profile instruments, rendered-DOM capture, link
localization as a deploy stage, dropped-content and script-text detectors,
sibling variance probing, and the impeccable update hint. See
[CHANGELOG.md](CHANGELOG.md) for the full breakdown.

## License

Apache-2.0
