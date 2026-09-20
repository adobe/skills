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
| `publish` | when do pages go live | **preview**; live publish on gate PASS (D1) or when this row is owner-decided `live` (D16); hands-off never publishes without one of the two, and live publish is its own explicit run (`deploy-batch.mjs --publish`), never joined to a preview run; PASS = `gate-publish.mjs --report` → `gate-report.json` `pages[].latest.pass` | D1, D16 |
| `lockdown` | is the target locked before the hand-off | **on** — private repo + `access/site.json` allow list `*@<operator domain>` (from `git config user.email`) with a site token, by `skills/deploy/scripts/lockdown.mjs` after the last anonymous gate and before the hand-off (`skills/deploy/reference/site-lockdown.md`); `off` only owner-decided with the reason (`internal demo`, `public by design`) | a served site is public until locked; the operator's domain is what the plan gate prints — the customer's is a later owner answer on this row |
| `fonts` | how are web fonts served | self-host every family and write `fonts/LICENSING.md` (`skills/deploy/reference/fonts-and-cls.md`); a family whose licence forbids redistribution gets a metric-matched substitute and opens the `fonts-public` owner-only row | brand-faithful default with a loud licence trail |
| `links` | where does an internal link stop being internal | root-relative for every target in the migrated tree; a target no page serves is **bounced** to the source host (`localize-links.mjs --unmigrated bounce`), counted per wave in the report; the alternative `list` — leave the href, list the gap in `stardust/link-gaps.tsv`, `--check` passes — is **owner-decided** only, never picked by hands-off | D9; the bounce count is the honest integration boundary; `list` is the one escape and it is a decision, not a flag an agent chooses |
| `locale` | how are languages laid out | one folder per locale **including the default** (`/en/`, `/de/`, …), root redirects to the default locale | symmetric trees; a root-level default locale breaks every later locale |
| `martech` | do tags and analytics ship | kept, **host-gated** — loaded only on the production host, inert on preview and local | parity without polluting the owner's analytics during the migration |
| `crawl` | how fast does extract crawl | honour `robots.txt` `Crawl-delay`; print the resulting ETA in the plan | politeness is measurable; the ETA lets the owner trade time for pace |
| `credentials` | which third-party credentials does the plan need | list every one (search index, forms backend, media, tag manager) with its owner; proceed on the static path without them | the list is the ask; the static path never waits on it |
| `runtime` | may the run install its own browser tooling | **yes**, without asking — `npm i --prefix stardust` and the Chromium download, both under stardust's write roots; never the EDS repo's devDependencies (the `lint unavailable` line names the `npm ci` the agent runs itself) | instrument class — `runtime-preflight.md` § Contract |
| `deps` | where do plugin scripts resolve `playwright` / `pixelmatch` / `pngjs` | `stardust/node_modules` via `stardust/package.json`, from any working directory (`runtime-preflight.md` § Resolution chain); never `npm i … --no-save` in the EDS repo | one dependency dir the repo's `npm i` cannot prune |
| `tracking` | where is progress tracked outside the session | `none` — the recap is written to `stardust/rollout/report/`; the owner's value is an issue URL, one comment per wave close updated in place (`handoff-report.md` § Tracking issue) | one home for progress; a URL is the owner's to give |
| `copy` | is copy rewritten (redesign flow only) | **verbatim** — copy fidelity kept; rewrite only where the brief names it | the customer notices copy before layout |
| `scope` | which pages, in which order | when the brief implies a wave plan (a section, a page count, "the full site"), write it as wave 1 of a plan with a stop point, record it, proceed, and offer to change it in the first report | scope is a proposal to correct, not a question to wait on |
| `media` | are authored external images rehosted to DA media | **`rehost-blocked`** — `skills/deploy/scripts/rehost-media.mjs` rehosts only what the preview ingester cannot ingest (401/403 to its plain fetch, HTML-200 fallbacks, > 1 MB rasters, persisting `about:error`); every other fetchable `<img>` stays a hotlink the ingester hashes into Media Bus itself. `rehost-all` (every external image onto DA) and `keep` (hotlinks stay; a 403'd image is still rehosted) are **owner-decided**; the choice is `state.json` `media.policy` and the lint row `hotlinked-media` reads it | the ingester's own rehost is the baseline (`deploy/da-deploy-protocol.md` § 2b); flipping the whole site's imagery onto DA changes the authoring model, so it is a decision, not a script default |
| `dyn` | the dynamic surface (APIs, search, forms, modals, media, tags) | — pointer row: rows live in `stardust/dynamic-features.md` § Decision batch, same status vocabulary | one decision batch, two files, no duplicate rows |
| `chrome-variant` | how does a second header/footer variant ship | a **template body class** or a `nav:`/`footer:` document per variant — never page-local CSS (`body:has()`, per-page chrome overrides); one gated chrome archetype row per variant (`skills/replica/reference/chrome-states.md` § Chrome variants) before that variant's pages fan out | one chrome mechanism per site; the gate proves each variant once, the pages inherit it |
| `index-registration` | when is the query index registered | before the first index-backed row: `skills/rollout/scripts/query-index.mjs` exits 0 (config route or repo `helix-query.yaml`, proven by read-back); exit 3 → the rows `scaffolded-awaiting-owner` with the decision named; exit 4 under hands-off preview-only → `interim` with `unverified: preview-only`, not a blocker (`skills/dynamics/reference/listings.md` § Mechanics, Registration gate) | D13 — the read-back decides, never the route's status; a preview-only run has an empty index by design |

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
§ Decision batch (back-pointer); `skills/deploy/da-deploy-protocol.md` (the
boilerplate-document paragraph: a matching DA document is overwritten and
logged, only non-boilerplate content opens a row);
`skills/deploy/reference/ship-script.md` (reads `target`, `branch`, `publish`).
