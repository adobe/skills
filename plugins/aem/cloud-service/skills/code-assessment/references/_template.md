# Expert-skill template — `<pattern-name>`

> Copy this directory shape to add a pattern: `code-assessment/<pattern-name>/guide.md`
> (control plane) + optional detail files. A new pattern gets a `guide.md`, not a `SKILL.md`:
> clients never load a `SKILL.md` below `skills/<skill>/`, and CI fails a pull request that adds
> one. Patterns added before this rule keep their nested `SKILL.md` (with frontmatter) until
> they are changed. A `guide.md` has no frontmatter.

## guide.md body sections (lean control plane)

- **Runbook pointer** (blockquote right under the H1) — "This pattern is executed by the
  code-assessment runbook — follow [`../references/runbook.md`](../references/runbook.md) for
  the full flow (preflight → plan → apply → verify, run log). This skill supplies the detection +
  recipe the runbook applies." Keeps the pattern self-sufficient if invoked directly.
- **Overview** — what the antipattern is and why it matters (2–4 lines).
- **Classification** — how to confirm a request maps to this pattern; path selection if the
  pattern has variants.
- **Discovery** — how to self-detect: `rg` / `grep` / glob patterns, scope (workspace
  roots only), exclusions. If the pattern is NOT self-discoverable, say so explicitly and state
  what input it requires.
- **Resolution contract** — where fix parameters come from. One of:
  `self-evident` | `user-supplied` | `live-lookup`. Be explicit about what input is required.
- **Review checklist** — per-pattern correctness checks (`- [ ]` items).
- **Troubleshooting fingerprints / common pitfalls** — optional but encouraged.
- **Recipe pointer** — "Read `recipe.md` fully before editing" (or `path-a.md`/`path-b.md` for
  multi-path patterns).

**Detection vs remediation (keep the seam).** The **Discovery** section is *detection* (how
instances are found); the recipe is *remediation* (how they're fixed). Both produce/consume the
standard **findings shape** (`pattern`, `file`, `line`, `snippet` — see
[`runbook.md`](runbook.md)). Keeping them separable means a pattern can later swap LLM `scan`
detection for a deterministic `analyzer` (see [`../scripts/README.md`](../scripts/README.md))
without touching its recipe.

## Catalog metadata

Every pattern declares one row in [`patterns.md`](patterns.md) — the single source of truth (do
**not** duplicate these into the pattern's guide):

- `pattern` (slug, = directory name) · `description` (one line) · `severity` (`high|medium|low`)
- `status` (`ready|planned`) · `detection` (`scan|analyzer`) · `fix` (`mechanical|guided`, or `-` while `planned`)

## Detail file(s)

- **Single-path pattern** → `recipe.md`: input contract, locator, edit recipe, unlocatable
  reason strings, editing strategy, before/after example.
- **Multi-path pattern** → `path-a.md`, `path-b.md`, … (one detail file per path).

## Wiring a new pattern in

1. Add a row to [`patterns.md`](patterns.md) (`status: planned` until built).
2. Create the directory + `guide.md` + detail file(s) using this shape; flip the row to `status: ready`.
3. Add a row to the **Manual Pattern Hints** table in [`../SKILL.md`](../SKILL.md).
4. Run `npm run validate` from the repo root — must pass.

*Optional:* a recipe may name a runtime/log signal to confirm the fix beyond `mvn compile`, where one exists.
