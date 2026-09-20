# Hand-off report — what a phase close hands the owner

## When to read what

- § Gate table first — before writing any close-out message: the table every hand-off opens with and its provenance fields.
- § Reporting KPI — when a summary needs one fidelity number: what it is, what it is not.
- § Before / after evidence — when a fix round is reported: the triptych and the before origin.
- § Source → target — when listing delivered pages: the pair every page prints.
- § Residuals, links, report check — the three pointers and the honesty line.
- § Customer-facing summaries — when the same run is written up for a non-operator.
- § Tracking issue — when progress is reported outside the session: the one place, the update-in-place rule, what a denial does.

A hand-off that says "ready for review" while gate rows fail, or that
quotes three different fidelity numbers across a run, costs the owner a
round of prompts to find out what is true. The report below is the one
shape every phase close uses — `replica` Phase 5, `deploy` § When you
finish, `rollout` Phase H, and the master's phase-end commit under
hands-off. Instruments render it where they exist (the status renderer,
the close checklist); this file is the definition they implement.

---

## Gate table first

The first block of the hand-off is the gate table — never the counts,
never the prose. One row per archetype (or page) per breakpoint:

```
| page / archetype | bp   | verdict | pixel % | residual (cause → inherits) | at                | regime           | build   | when            |
|------------------|------|---------|---------|-----------------------------|-------------------|------------------|---------|-----------------|
| home             | 1440 | PASS    | 6.9     | footer 4.8 glyph-aa → user  | 2026-09-16T19:02Z | published-origin | a1b2c3d | this run        |
| home             | 360  | FAIL    | 12.4    | hero 9.1 unexplained        | 2026-09-16T19:04Z | published-origin | a1b2c3d | this run        |
| product          | 1440 | PASS    | 1.3     | —                           | 2026-09-11T03:41Z | prototype        | 9f8e7d6 | recorded earlier |
```

- `verdict` is the gate's own PASS/FAIL (`stardust/replica/progress.json`
  `pass`); a residual over the bar without a cause is a FAIL row, not a
  PASS with a footnote.
- `at`, `regime` (`prototype` | `published-origin`) and `build` (the code
  commit the number was taken against) come from the ledger row —
  schema in `skills/replica/reference/source-fidelity-gate.md`
  § Residual logging format. A number without `regime` is not printed;
  a prototype-regime number is never compared to a published-origin one.
- `when` says `this run` or `recorded earlier` from `at` against the
  run's first `status.jsonl` line. Recorded-earlier rows stay in the
  table; they are not re-measured silently and not presented as fresh.
- "N/N verified" totals, when printed, come *after* the table and count
  only PASS rows in the published-origin regime.
- The table's last line is the site's access state from the register row
  `lockdown`: `site: locked (lockdown.mjs exit 0 <at>)` · `site: open (row
  lockdown off — <reason>)` · `site: open (blocked on owner)` — the third
  form means the hand-off leads with `Blocked on owner:` and carries the
  printed `gh repo edit …` (`skills/deploy/reference/site-lockdown.md`).

---

## Reporting KPI

One number per template, defined here so a run quotes the same one every
time: a **neutral whole-page pixel difference** — no residual policy, no
ignore zones — of the published origin against the live source, at
**1440 and 360**, source and build captured within minutes of each other.
Per template the report prints median, p90 and the share of pages under
10 %; the field name is `neutralDiff`, produced by `gate-publish.mjs --report`
(`gate-report.json`); without that report the line prints `neutralDiff: not
measured` — never a substitute taken from the gate. It is a **reporting number, not a pass bar** (B29): the gate's
verdict and residual semantics are unchanged by it.

---

## Before / after evidence

Per defect class fixed in the run, one triptych of URLs — **live source |
before | after** — so the owner can open all three without asking:

- **before** is the branch preview pinned at the pre-fix commit
  (`<pre-fix-branch>--<repo>--<org>.aem.page/<path>`); a fix round that
  did not pin a branch has no before URL and says so.
- **after** is the delivered URL; each fix round carries its deploy
  timestamp (`.deploy-ledger.json` entry) so "applied now or during the
  run" is a lookup, not a question.
- The owner reads defect classes, not diffs: one line each — what was
  wrong, how many pages, the triptych.

---

## Source → target

Every delivered page prints its pair: `<source URL> → <target URL>`,
siblings included. The conversion-log header (`stardust/eds-conversion-log.md`)
lists the source URL for every page it covers, so "what was the original
page for X" is answered by the log, not by memory.

---

## Residuals, links, report check

- **Residual list per page type** — the format and the "gate passed
  cannot hide passed-with-unexplained" rule live in
  `skills/replica/reference/source-fidelity-gate.md` § Residual logging
  format; the hand-off reproduces that list, it does not restate the rule.
- **DA edit links** use the one form in `skills/deploy/da-deploy-protocol.md`
  (§ URLs line: edit · preview · live). No second form.
- **Usage row (optional)** — one line from `stardust/usage.md`
  (`skills/stardust/scripts/token-ledger.mjs`, advisory): the wave's
  requests, cache read, output and, with prices supplied, the estimate;
  `usage: unknown` is an allowed value, never a blocker.
- **Report check** — the last line before the signature:
  `report-check: <n> paths ls-verified · <m> counts re-read from
  progress.json/coverage`. Every path in the report was listed with `ls`
  and every count was re-read from its artifact immediately before
  printing; a report that cannot say so does not ship.
  `node skills/stardust/scripts/status.mjs --markdown` renders the gate
  table, the recap table and this line; the close checklist fails on a
  missing gate table or provenance field.

---

## Tracking issue

Progress outside the session has **one** home: the `tracking` row of
`stardust/decisions.md` (default `none` — the recap is written to
`stardust/rollout/report/`; the owner's value is an issue URL). When set:

- one comment per wave close, **updated in place** (`gh issue comment
  --edit-last`-style) — the body is `status.mjs --markdown`; blockers are
  a comment the moment they stop a wave; the hand-off returns the link;
- `ship-script.md` `ISSUE=` is sourced from the row — no second key;
- a denied `gh` call is `Blocked on owner:` with `owner: "gh issue
  comment …"` (master § Hands-off mode); the run continues. No token
  ever appears in a URL or body.

---

## Customer-facing summaries

A summary written for the customer derives from the same data as the
operator report — never from memory of the run:

- qualitative by default; every number it does carry links to the ledger
  row or gate table that holds it, and carries its regime;
- the operator report's gate table is the source of truth when the two
  disagree — fix the summary;
- before hand-off, run `$impeccable critique` on the summary page and a
  copy-slop pass over its text when impeccable is available (master
  § Setup step 1 level); a summary the owner has to call "AI-sloppy" is a
  defect of this step, not of taste.
