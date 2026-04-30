# stardust

> Redesign an existing website to make it better.

Stardust is a Claude Code plugin that drives a guided redesign of an existing
website. It is a higher-level skill built **on top of
[impeccable](https://github.com/pbakaus/impeccable)**: impeccable owns *how* to
design well; stardust owns the specific job of taking a site that exists and
turning it into a site that is better.

Stardust is opinionated about what "better" means but the user has the final
say. The default definition of *better* is rooted in impeccable's critique and
audit, the absence of AI-slop patterns, and a user-selected expressive
direction. Every redesign decision is reasoned in the open before code runs.

## Pipeline

```
extract  →  direct  →  prototype  →  migrate
```

1. **extract** — crawl the existing site (capped, multi-page) and seed a
   description of its current state in impeccable's own format
   (`stardust/current/PRODUCT.md` + `DESIGN.md`).
2. **direct** — capture the user's intent ("make it better", "make it more
   expressive for a young audience") as an open phrase, reason about what it
   means in stardust's dimensional vocabulary, ask up to two clarifying
   questions, and write a target `PRODUCT.md` + `DESIGN.md` at the project root
   plus a `stardust/direction.md` with the full reasoning trace.
3. **prototype** — render before/after static-HTML prototypes per page and
   iterate via `$impeccable craft` and `$impeccable live`.
4. **migrate** — apply the approved target `DESIGN.md` to every page in the
   inventory. Per-page state means migration is incremental and resumable.

## Surface

```
$stardust                  # state report + freeform intent reasoning
$stardust extract [url]    # ingest existing site
$stardust direct           # resolve intent → target PRODUCT.md / DESIGN.md
$stardust prototype [page] # before/after prototype, delegates to impeccable
$stardust migrate [page]   # render redesigned static HTML (incremental)
```

`$stardust` with no argument runs a read-only state report and shows the
recommended next step. `$stardust` with a freeform phrase runs the intent
reasoning procedure (`reference/intent-reasoning.md`) and proposes a plan
before executing anything.

## Hard dependency

Stardust requires impeccable to be installed. There are no fallbacks. On every
invocation stardust verifies the impeccable skill is reachable and aborts
otherwise with a clear install hint.

## What stardust does NOT ship

- **No design language of its own.** All design opinions are impeccable's. Stardust adds *redesign-specific* opinions (the divergence toolkit, the palette library, the before/after model, the migration target).
- **No production CMS output.** The migration target is platform-agnostic static HTML. Conversion to AEM EDS, another CMS, or a framework is a separate downstream effort and out of scope for this plugin.
- **No closed intent vocabulary.** The user phrase is open. The agent reasons about it in public.

## Status

`v0.3.0` — complete refactor. v1 (the four-stage greenfield design tool) is
preserved at the [`stardust--v0.1.0`](https://github.com/adobe/skills/tree/stardust--v0.1.0/plugins/stardust)
tag and is unrelated to this version's surface.

## License

Apache-2.0
