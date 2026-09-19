# Decision register — `stardust/decisions.md`

## When to read what

- § File — before writing or reading a row: the columns, the status enum, the provenance block.
- § How phases use it — when a phase discovers a decision, when the plan gate asks, and what hands-off does with an open row.
- § Default rows — the questions every migration meets, each with the default a run applies without asking.
- § Owner-only rows — the three questions no default may answer.
- § Consumers — where the pointers live, so the rule stays in this one file.

Every migration meets the same dozen questions — deploy target, branch,
publish timing, fonts, link boundary, locale layout, martech, crawl
pacing, credentials, copy fidelity, scope. Each has a derivable default.
Asked one at a time, mid-flow, they cost hours of idle per project; asked
never, they become silent assumptions. The register makes them one batch
at plan time and one file afterwards: **every phase reads it, no phase
re-asks it.** It generalises the dynamics decision batch
(`skills/dynamics/reference/triage.md` § Decision batch), whose rows are
*not* duplicated here — the register carries one pointer row to them.

---

## File: `stardust/decisions.md`

Tracked (artifact-map § Versioning). Markdown provenance block first
(artifact-map § Provenance shapes), then one table:

```markdown
# Decisions — <site>

| id | question | default | rationale | status | decided-by | evidence |
|---|---|---|---|---|---|---|
| target | deploy target | `<org>/sdt-<slug>`, private, DA folder of the same name | precedent repo in the org | default-applied | default | `stardust/direction.md` 2026-… |
| publish | when do pages go live | preview; live on gate PASS | D1/D16 | owner-decided | owner | plan reply 2026-… |
| dyn | dynamic-surface rows | — | see `dynamic-features.md` § Decision batch | — | — | — |
```

| column | contents |
|---|---|
| `id` | short kebab-case key; the default rows below have fixed ids, project rows add their own |
| `question` | one line, phrased as the owner would read it |
| `default` | what the run does when nobody answers — filled for every row except § Owner-only rows (`—`) |
| `rationale` | why that default: the shipped rule, the precedent, or the decision number (D1, D9, D16) |
| `status` | `default-applied` \| `owner-decided` \| `owner-only-pending` |
| `decided-by` | `default` \| `owner` \| `<phase>` (a phase that derived the answer from evidence, e.g. `extract` for locale layout) |
| `evidence` | where the answer is recorded or came from: a file path, a reply timestamp, a captured page |

Rows are appended, never deleted; a changed answer is a new row with the
same `id` and the later row wins (append-only, like the journal). An
`owner-only-pending` row is the only row that may hold `—` in `default`.

---

## How phases use it

1. **Any phase appends on discovery.** The moment a phase meets a
   question the register does not hold, it appends the row with the
   default it intends to apply and continues — it does not stop to ask.
2. **The plan gate asks once.** `prepare-migration` § Final report,
   `replica` Phase 2 and `rollout` Phase A present every row that is
   not yet `owner-decided` as **one message to the owner**: a numbered
   list, one line per row, the default stated on each line, answerable
   by "all defaults" or by row id. Rows the owner confirms or changes
   become `owner-decided`; the rest stay `default-applied`.
3. **Later phases read, never re-ask.** `deploy`, `rollout`, `migrate`
   and `dynamics` take the answer from the row. A phase that finds itself
   composing a question whose id is in the register has a routing defect:
   read the row instead.
4. **Hands-off** (master § Hands-off mode) applies every default and
   marks the row `default-applied`; it halts — `event: "blocked"` in
   `stardust/status.jsonl`, the row named in `detail` — only on an
   `owner-only-pending` row, and only for the work that row gates. The
   first reply of a hands-off run prints the open rows with their
   defaults so the owner can override any of them later without being
   asked.
5. **`state.json` carries no decision keys.** The register is the file;
   the state report prints its open rows (§ State report in
   `state-machine.md`).

---

## Default rows

| id | question | default | rationale |
|---|---|---|---|
| `target` | where does the code go | `<org>/sdt-<slug>`, **private**, with a DA folder of the same name; `<org>` from a precedent repo in the org or the run's `gh` identity — the plugin ships the shape, never an org name | one convention across projects; private until the owner says otherwise |
| `branch` | which branch serves | `main` | boilerplate default; Code Sync builds it |
| `commit` | when does stardust commit | at the end of each phase — hands-off only; outside hands-off the owner's ask-before-commit preference stands, stated at activation | master § Hands-off mode |
| `publish` | when do pages go live | **preview**; live publish on gate PASS (D1) or when this row is owner-decided `live` (D16); hands-off never publishes without one of the two, and live publish is its own explicit command (`deploy-batch.mjs --publish`), never joined to a preview run | D1, D16 |
| `fonts` | how are web fonts served | self-host every family and write `fonts/LICENSING.md` (`skills/deploy/reference/fonts-and-cls.md`); a family whose licence forbids redistribution gets a metric-matched substitute and opens the `fonts-public` owner-only row | brand-faithful default with a loud licence trail |
| `links` | where does an internal link stop being internal | root-relative for every target in the migrated tree, absolute source-host for targets outside the current wave, counted per wave in the report (`localize-links.mjs` lists them) | D9; the off-wave count is the honest integration boundary |
| `locale` | how are languages laid out | one folder per locale **including the default** (`/en/`, `/de/`, …), root redirects to the default locale | symmetric trees; a root-level default locale breaks every later locale |
| `martech` | do tags and analytics ship | kept, **host-gated** — loaded only on the production host, inert on preview and local | parity without polluting the owner's analytics during the migration |
| `crawl` | how fast does extract crawl | honour `robots.txt` `Crawl-delay`; print the resulting ETA in the plan | politeness is measurable; the ETA lets the owner trade time for pace |
| `credentials` | which third-party credentials does the plan need | list every one (search index, forms backend, media, tag manager) with its owner; proceed on the static path without them | the list is the ask; the static path never waits on it |
| `copy` | is copy rewritten (redesign flow only) | **verbatim** — copy fidelity kept; rewrite only where the brief names it | the customer notices copy before layout |
| `scope` | which pages, in which order | when the brief implies a wave plan (a section, a page count, "the full site"), write it as wave 1 of a plan with a stop point, record it, proceed, and offer to change it in the first report | scope is a proposal to correct, not a question to wait on |
| `dyn` | the dynamic surface (APIs, search, forms, modals, media, tags) | — pointer row: rows live in `stardust/dynamic-features.md` § Decision batch, same status vocabulary | one decision batch, two files, no duplicate rows |

---

## Owner-only rows

Never defaulted; `default` is `—`, `status` starts `owner-only-pending`.
Hands-off halts the gated work on these and nothing else:

| id | question | why no default |
|---|---|---|
| `chrome-inline` | may header/footer chrome be inlined into page documents | changes the authoring model for every page (B2) |
| `pii-forms` | may a form collecting regulated personal data be migrated live | compliance is the owner's, not the run's (B13) |
| `fonts-public` | may a licensed font be published to a public origin | licence obligation; the metric-matched substitute ships meanwhile |

---

## Consumers

Pointers only — the rule is this file: master `SKILL.md` § Hands-off mode
(gate row); `state-machine.md` § State report (open rows); `artifact-map.md`
(tree + § Versioning); `prepare-migration` § Final report, `replica`
Phase 2, `rollout` Phase A (the plan gate); `skills/dynamics/reference/triage.md`
§ Decision batch (back-pointer); the deploy protocol's boilerplate-document
rule (an existing DA document matching the boilerplate fingerprints is
overwritable and logged; only non-boilerplate content opens a row).
