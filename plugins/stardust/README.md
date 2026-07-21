# stardust

> Redesign an existing website to make it better.

Stardust is a Claude Code plugin that drives a guided redesign of an existing
website. It is a higher-level skill built **on top of
[impeccable](https://github.com/pbakaus/impeccable)**: impeccable owns *how* to
design well; stardust owns the specific job of taking a site that exists and
turning it into a site that is better — and, when asked, shipping the result.

Stardust is opinionated about what "better" means but the user has the final
say. The default definition of *better* is rooted in impeccable's critique and
audit, the absence of AI-slop patterns, and a reference-grounded expressive
direction. Every redesign decision is reasoned in the open before code runs.

## Two layers

**Platform-agnostic core** — captures, directs, and renders the redesign as
static HTML, with no CMS assumptions:

```
extract  →  direct  →  prototype  →  migrate
```

1. **extract** — crawl the existing site (capped, multi-page) and seed
   `stardust/current/` with `PRODUCT.md`, `DESIGN.md`, `DESIGN.json`, a
   per-page inventory, and the consolidated brand surface. Supports cross-site
   same-brand capture (`--brand-source` / `--design-source`, sibling
   discovery) and verifies its own captures with vision gates.
2. **direct** — resolve the user's intent ("make it more expressive for a
   young audience") into a target `PRODUCT.md` + `DESIGN.md`, grounded in
   real-site reference research when available, with the full reasoning trace
   at `stardust/direction.md`.
3. **prototype** — render before/after static-HTML prototypes per page and
   iterate via `$impeccable craft`, with vision-verified checkpoints.
4. **migrate** — apply the approved design to every page in the inventory,
   with declared fidelity tiers. Per-page state makes it incremental and
   resumable.

Four more core entry points sit alongside the pipeline: **uplift** (one-shot
brand-faithful presales redesign — URL in, three differentiated variants out),
**audit** (design + SEO + LLM-visibility audit of any site, producing a
scored HTML report), **replica** (same-design migration — recreate the site's
key pages near pixel-perfect as clean re-authored HTML, verified by a measured
source-fidelity gate, the only permitted design changes being an explicit
inconsistency register; the design stays, the platform changes), and
**reskin** (byte-faithful content from one site re-laid-out onto a
separately-defined donor design system — another live site or local
prototypes — with dual content/design-adoption gates).

**EDS delivery** — optional second half that ships the migrated site to AEM
Edge Delivery Services via Document Authoring: **deploy** (one page →
blocks + content), **rollout** (whole site: delivery ledger, block dedup,
runtime-contract probe, atomic per-page verify, link audit), **diff**
(pixel + structural fidelity reconciliation against the prototype), and
**prepare-migration** (the migrate-prep cascade). The core never leaks EDS
concepts; the delivery skills consume its platform-agnostic output.

## Hands-off production mode

For production migrations, `skills/stardust/SKILL.md § Hands-off mode` runs
the whole chain end-to-end without conversational gates: decisions that would
normally pause for the user are resolved from the captured evidence and
logged, run status is streamed to `stardust/status.jsonl`, and each run
appends to a learnings ledger so the next run starts smarter. What used to be
an external "master migration prompt" is now folded into the skills.

## Optional integrations

Each of these is used when present and degrades gracefully when absent:

- **refero MCP** — `direct` grounds its direction research in real-site
  references from refero; without it, the curated seed roll is the fallback.
- **modern-web-guidance** — consulted for current platform best practices;
  without it, the skills rely on their own baked-in guidance.
- **marketing-skills** — `audit` borrows the `seo-audit` / `ai-seo`
  methodology when installed; without it, the audit runs on its built-in
  heuristics.

## Hard dependency

Stardust requires impeccable to be installed. There are no fallbacks. On every
invocation stardust verifies the impeccable skill is reachable and aborts
otherwise with a clear install hint.

## Status

`v0.16.1` — container-width (`--max-width`) sizing guidance in the token
contract. Previously in `v0.16.0` — two new entry points: `replica` (same-design migration with a
measured source-fidelity gate) and `reskin` (byte-faithful content onto a
donor design system), both field-tested and hardened, plus the shared
live-measurement module (`diff/scripts/live-session.mjs`) and diff-probe
flags. See [CHANGELOG.md](CHANGELOG.md) for the full breakdown; prior
versions live in git history.

## License

Apache-2.0
