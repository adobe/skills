# The four template modes

`stardust:aem-import-site` assigns one of four modes to every template
during Phase 1. The mode decides where the design comes from and what
review surface the user reviews. All four modes converge on the same
downstream phases (fill script + batch migrate).

## Mode A — Import existing prototype

**Input:** `stardust/prototypes/<slug>-proposed.html` (already authored
and approved via `stardust:prototype`).

**Steps:**
1. The skill invokes `stardust:aem-import <slug>` against the prototype.
2. Theme CSS, chrome fragments, motion JS, DA content are generated.
3. User reviews the EDS preview URL; iterates as needed.
4. On approval, the template is locked and the fill script for the rest
   of the cluster is authored in Phase 3.

**Review surface:** static prototype HTML + EDS preview URL. Two
artifacts to compare.

**Best for:**
- Home, hero landing pages, brand-critical surfaces
- Pages reviewed by non-EDS stakeholders (the static HTML is portable)
- Templates with high visual stakes where you want offline iteration

**Trade-off:** highest upfront cost (you authored the prototype already)
but lowest risk — both review artifacts confirm what the migrated page
looks like.

**Example from the wheelercat engagement:** home, customer-value-agreements,
service, new. All four were prototyped first, then imported.

---

## Mode B — New prototype first, then import

**Input:** none yet, but the user wants a static prototype before any
EDS work.

**Steps:**
1. The skill invokes `stardust:prototype <slug>` to author the static
   prototype + shape brief.
2. User reviews + approves the prototype.
3. The skill switches to Mode A flow with the newly-authored prototype.

**Review surface:** same as Mode A.

**Best for:**
- Medium-stakes templates where you want a portable artifact
- Templates whose design hasn't been decided yet
- Cases where the prototype's review will inform decisions about other
  pages in the template

**Trade-off:** highest TOTAL cost (prototype + import + iterate) but
gives you the most artifacts to reason from.

**Example from the wheelercat engagement:** none — we used either A or
C for every template. B would have been right for `industries` if we
wanted a prototype before committing to its EDS rendering.

---

## Mode C — Build direct

**Input:** none. No prototype, no plan to author one.

**Steps:**
1. The skill (an LLM) authors:
   - Per-theme CSS (extending the project's canonical theme — chrome,
     tokens, fonts via inheritance; per-template variants in
     `@layer variant`)
   - Chrome fragments (typically copied from the canonical theme)
   - DA content for the representative page
2. PUT to DA, trigger preview.
3. User reviews the EDS preview URL directly; iterates.
4. On approval, the template is locked.

**Review surface:** EDS preview URL only. One artifact.

**Best for:**
- Long-tail templates (equipment detail, attachment detail, blog posts)
- Templates where iteration cost matters more than artifact portability
- Cases where the canonical theme already provides 80% of the design
  language

**Trade-off:** lowest cost per template but no offline review artifact.
If the EDS pipeline breaks, you can't review without it.

**Example from the wheelercat engagement:** equipment-detail-used (the
2022 Cat 304 C3 THA template). No static prototype was authored — the
template was iterated directly on the EDS preview URL.

---

## Mode D — Skip

**Input:** template excluded from migration.

**Steps:** none.

**Best for:**
- One-off pages (sitemap, 404, terms-of-service variants)
- Deprecated content (`/service-old/*`)
- Pages manually curated outside the migration

**Trade-off:** the pages won't exist on the EDS site unless added later
by hand. The skill records them in `templates.json` as `mode: "D"` so
re-runs don't propose them again.

---

## Default recommendations the skill makes

When Phase 1 enumerates templates, the skill suggests a default mode
based on heuristics:

| Template type / hint | Default mode |
|---|---|
| Has prototype available | A |
| No prototype + 1–10 pages | B |
| No prototype + 10–100 pages | C |
| No prototype + > 100 pages | C |
| URL pattern contains `old`, `legacy`, `archive` | D |
| URL is a one-off (only 1 page, no siblings) and no prototype | D |

The user overrides any default. Defaults are conservative — they bias
toward "review-friendly" modes (A > B > C > D) for low-page-count
templates and toward "scale-friendly" modes (C) for high-page-count
templates.

## Picking between A and C when you have a prototype

Sometimes you have a prototype but the template is long-tail (e.g.,
the prototype was authored as a representative, but the template covers
500 pages). In this case:

- **Mode A is still preferred** — having a prototype means you've
  already done the static-review work. Don't waste it.
- Mode C would mean re-authoring the same design without the prototype's
  benefit.

The prototype existence doesn't constrain the fill script; the fill
script works the same in both modes. The prototype is just the design
reference.

## What gets locked at template approval

Regardless of mode, on approval the skill records in `templates.json`:

```json
{
  "name": "equipment-detail-used",
  "mode": "C",
  "theme": "wheelercat-equipment-used-v2",
  "representativeSlug": "used-equipment__track-excavators__2022-cat-304-c3-tha",
  "representativeUrl": "https://main--<repo>--<owner>.aem.page/used-304-c3-tha",
  "slotMap": {
    "model.name":    { "source": "h1", "required": true },
    "model.year":    { "source": "regex:/^(\\d{4})/ on h1", "required": true },
    "price":         { "source": "regex:/Price:\\s*\\$([\\d,]+)/", "required": false },
    "hours":         { "source": "regex:/Hours\\s*\\n+\\s*(\\d+)/", "required": false },
    ...
  },
  "status": "approved",
  "approvedAt": "2026-05-31T..."
}
```

The slot map is the contract between the captured content and the
template's DA shape. The fill script (Phase 3) consumes it directly.
