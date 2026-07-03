# Prep mode (`--prep`)

**Read when:** `prototype` is invoked with `--prep` (typically via the
`prepare-migration` orchestrator). Default (non-prep) runs are
unchanged by this file: per-slug shape brief, render via
`$impeccable craft`, open in browser, iterate, approve.

When invoked with `--prep`, prototype runs an extended pass that
fills page-type gaps and writes canon. `--prep` adds three things on
top of the standard procedure:

## 1. Fill page-type gaps

Identify every page type in `state.json.pages[].type` that doesn't
yet have an approved archetype. For each gap, prototype one
representative page (the user picks which slug, or the first page of
that type by default):

- `article`-typed pages with no approved article: prototype one
- `listing`-typed pages with no approved listing: prototype one
- `program`, `form`, `static` — same pattern
- `landing` — the home; prototyped first if not already done
- `unique`-typed pages — these don't get archetypes; they're
  rendered as one-offs at migrate time

The user picks one variant per type. Subsequent pages of the same
type are migrated by forking that approval (Path A′ in
`skills/migrate/SKILL.md`).

## 2. Canon write-back on first approval

The first prototype approved (default the home; override with
`--canon-from <slug>`) becomes the **canon-author**. On approval,
extract canon and write back per `reference/canon-extraction.md`:

1. Chrome HTML → `stardust/canon/header.html`,
   `stardust/canon/footer.html`, optional regions.
2. Compound CSS → `stardust/canon/canon.css`.
3. Pinned tokens → `DESIGN.json.extensions.canon.pinned`.
4. Module canonical renderings →
   `stardust/canon/modules/<id>.html`.
5. Compositional moves (LLM-authored, 3–7 lines) →
   `DESIGN.json.extensions.canon.compositionalMoves`.

Reference all extracted files via `{ path, sha }` in
`DESIGN.json.extensions.canon.files`. Each canon file carries a
`stardust:canon` provenance comment naming source slug, source
prototype, and region.

## 3. Canon write-back on subsequent approvals

For non-canon-author template approvals (article, listing, etc.),
canon-extraction runs in **diff mode** per
`reference/canon-extraction.md` § Conflict resolution:

- **Net-new items** (a module not yet in canon, a new compound CSS
  class, a new compositional move) → append to canon additively.
  Add a history entry naming what was added.
- **Match canon byte-for-byte** → no-op.
- **Conflict with canon** → default is **log as deviation**: the
  migrated/prototyped page carries the deviation inline marked with
  `data-deviation="<reason>"`, and the page's `migrationDecisions[]`
  records a `canon-deviation` entry. Canon stays unchanged.

Override the default per-conflict via the prep summary if the user
wants to promote the new variant to canon (which stale-flags
downstream pages that consumed the changed item) or reject and
re-iterate the prototype. Without an explicit override, the conflict
logs as deviation and approval proceeds.

## Prep summary

```
prototype --prep complete
=========================

Approved archetypes:
  landing   home (V01 Polish)            canon-author
  article   news/post-housing-summit
  listing   news (the index)
  program   programs/shelter
  form      donate
  static    about

Canon: stardust/canon/ + DESIGN.json.extensions.canon
  Sources:  home → article (1 deviation logged), listing (clean),
            program (1 deviation logged), form (clean), static (clean)
  Modules:  8 confirmed; canonical renderings written
  Pinned:   sectionPadding, densityTier, typeScale set

Next: $stardust migrate  (apply canon to every page in inventory)
```

Default mode is unchanged.
