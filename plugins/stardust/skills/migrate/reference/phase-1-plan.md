# stardust:migrate: phase 1, plan

The text of this part of `skills/migrate/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 1 — Plan

**Dynamic-surface precondition (safety net).** If
`stardust/dynamic-features.md` is missing, the hand-run flow
(`extract → direct → prototype → migrate`) never passed a pre-import
gate: run the stardust `dynamics` skill Phases 1–3 now (`extract --dynamics`
for reach if needed, detector on the archetypes, triage draft, curate)
before rendering any page. Never import a site as static without a
decision per dynamic row. Per page, rows of the inventory that touch it
become `contentDeviations[]` `kind: "dynamic-dependency"` entries
(`reference/content-preservation.md § Dynamic dependencies`).

**Gated-archetype precondition (`flow: replica`).** Before rendering any
`sibling`-tier page, read `stardust/replica/progress.json`: the page
type's archetype must have a gate result at every configured breakpoint
that is `pass: true`, or over the bar with every residual carrying a
`cause` (`../replica/reference/source-fidelity-gate.md` § Residual
logging format — a documented residual is a pass with an asterisk). An
archetype never gated, or over the bar with no residual entries, blocks
its page type: report the archetype slug and `$stardust replica
<archetype>`, and render nothing for that type. The same rule guards
`rollout` Setup; the published-origin re-gate is unchanged. Thresholds
are the gate's.

Print the plan and wait for confirmation when the scope is large:

```
migrate plan
============

In scope: 127 pages
  Path A  (approved)                6 pages: home, news/post-housing-summit, news, ...
  Path A' (template-applied)      118 pages: 84 article, 5 listing, 11 program, 2 form, 16 static
  Path B  (unique)                  3 pages: 404, search, faq

Skipped:  0 stale, 0 unscoped

DESIGN.md sha:    1a2b3c4
DESIGN.json sha:  5d6e7f8
Canon shas:       header:7g8h9i  footer:9i0j1k  css:1k2l3m

Output:           stardust/migrated/  +  per-page _meta.json sidecars
Idempotent skip:  enabled (run with --force to override)

Reply "go" to proceed.
```

For 1-3 pages or `<slug>` invocation, skip the confirmation.
