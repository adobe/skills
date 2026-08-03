# stardust — implementation notes

Running list of things to implement. Captured in-session; not yet acted on.
Each entry records the idea, findings from a look at the current code, and a
recommendation, so the work can start without re-deriving the context.

---

## Standing requirement — applies to every note below

**The skills own memory-keeping. The user never has to know it is something
they need to keep track of.**

The requirement is about *initiative*, not about avoiding prompts. Asking
permission is fine — a prompt is itself how the user learns the memory exists.
What must never happen is memory getting written only because the user thought
to ask for it, or going stale because nobody remembered to update it. The
user's mental model should be "stardust keeps its own notes", never "I need to
remember to have it write these down."

Concretely:

- **The skill raises it, always.** A skill that produces a durable artifact
  either writes the corresponding memory or asks to — in the same run, every
  run. Never conditional on the user bringing it up.
- **Maintain, not just create.** Memory is refreshed whenever the thing it
  describes changes, not only at first creation. This is the half that is easy
  to forget, and the half that decides whether the memory is trustworthy a
  year in.
- **Prompt where it is a real choice, act where it is not.** Creating a file
  in the user's repo for the first time is a real choice — ask. Updating
  stardust's own managed block or a generated registry is not — just do it.
  Rule of thumb: ask once per artifact at creation, never again for upkeep.
- **Enforce, don't rely on intent.** "The skill should remember to do this" is
  not a mechanism. Each memory artifact needs either a declared rule the agent
  reads every session (the journal-rule pattern, proven in adobecom per
  `CHANGELOG-redesign-adobecom.md:183`) or a script gate that fails when
  memory is missing or stale. Prefer the gate where the artifact is
  machine-checkable.
- **Say what was written.** Name the memory artifacts touched in the run
  summary. Silent upkeep is how users end up not knowing the memory is there
  to be read.

Never overwrite user-authored content unprompted. Managed blocks and generated
files exist precisely so that upkeep is additive and needs no permission.

---

## 1. Write a project-side `CLAUDE.md` from the stardust skills

**Idea.** Have the stardust skills write a `CLAUDE.md` into the project they
run against, so the project itself carries instructions covering what has been
done and the design / implementation specifications.

### Findings

- `skills/stardust/reference/journal-format.md:138` (§ Project-side CLAUDE.md
  companion) already *assumes* the project has a CLAUDE.md carrying the journal
  rule — but no skill ever writes it. Today it's an instruction to the human
  that quietly doesn't happen.
- `CHANGELOG-redesign-adobecom.md:183-184` records that in the adobecom
  project, the project-side CLAUDE.md was load-bearing: it declared both the
  journal rule and the recursive validate-and-fix loop, and both were credited
  with catching real bugs. So the pattern is proven — it was just done by hand.
- The gap CLAUDE.md uniquely fills: it is the only file read automatically at
  session start with no skill invoked. `stardust/state.json`,
  `stardust/journal.md`, `PRODUCT.md`, `DESIGN.md`, `DESIGN.json` all require
  an agent that already knows to look for them. A fresh session — or a
  teammate without the plugin installed — currently has no entry point.

### Recommendation: rules-and-map, not a state snapshot

**Include** (durable across the project lifetime, written ~once):

- Artifact map + which file is authoritative for what:
  - `stardust/state.json` — what is (per-page state machine)
  - `stardust/journal.md` — how the project got here (chronological)
  - `PRODUCT.md` / `DESIGN.md` / `DESIGN.json` — the target spec
  - `stardust/current/` — extracted source-of-truth content
  - `stardust/prototypes/` — generated, do not hand-edit
- Session-start read order (state.json first, then last 3-5 journal entries —
  mirrors `journal-format.md` § Reading the journal at session start).
- The journal rule (verbatim from `journal-format.md:143-146`).
- The recursive validate-and-fix loop rule (render → check → fix → re-render).
- Don't-hand-edit warnings for generated artifacts.

**Exclude:**

- "What has been done." Already `state.json` + `journal.md` + provenance,
  updated transactionally by each skill. A CLAUDE.md copy is stale after the
  next command; rewriting it every turn just builds a worse journal.
- Design specs restated. `DESIGN.md` / `DESIGN.json` are the spec. A paraphrase
  becomes a second source of truth that silently diverges.

Rule of thumb: CLAUDE.md points *at* the artifacts and states the rules for
working with them. It never duplicates their contents.

### Mechanics to settle

- **Managed block.** Wrap stardust's content in
  `<!-- stardust:begin -->` … `<!-- stardust:end -->`. Re-runs rewrite only
  that block; anything outside is user territory and is never touched. Leave an
  explicit "project-specific extensions" heading below the block — this is the
  seam `journal-format.md:148-151` describes, where projects bind the default
  rule plus their own extensions.
- **Owner: `extract`.** First skill to run, already scaffolds `stardust/` and
  writes the initial `state.json`. Alternative is a shared step in the master
  skill's § Setup, which would cover projects entered mid-pipeline — worth
  considering if any skill can legitimately run before `extract`.
- **Existing file.** Append the managed block; never overwrite anything outside
  it. No prompt needed — the block is stardust's own territory.
- **No existing file.** Ask before creating — dropping a CLAUDE.md into
  someone's repo unannounced is a real intrusion, and the ask is also how the
  user learns the file exists and what it is for. The ask is the skill's
  initiative, raised every first run; it is never something the user has to
  request. Phrase it as a one-line confirmation with a default, not an
  open question. Same treatment for open question 4 in
  `CHANGELOG-redesign-adobecom.md:222` (auto-seeding `stardust/journal.md` on
  extract): offer it once, unprompted, then never ask again.
- **Keeping it current.** The block is deliberately spec-independent, so it
  should need rewriting only when the artifact map itself changes (a new
  stardust directory, a renamed spec file). Regenerate-and-compare on every
  run: if the block stardust would write differs from what's on disk, rewrite
  it and note it in the run summary. Cheap enough to do unconditionally, and
  it means a plugin upgrade propagates to existing projects with no user
  action.
- **Re-runs / `--re-direct`.** Block content is spec-independent, so a
  direction change shouldn't need to touch it. Confirm this holds once the
  block contents are final — if anything direction-specific creeps in, it
  belongs in `DESIGN.md` instead.

---

## 2. Where project implementation memory should live (EDS skills)

**Idea.** As more archetypes and blocks get implemented, where should project
implementation memory be written, so users can build new site functionality
aligned with what has already been designed and implemented?

### Findings — what exists today

- `stardust/eds-conversion-log.md` is the only implementation memory. It is
  referenced exactly twice in the whole plugin, both loosely:
  - `deploy/SKILL.md:244` — "Lock the answers in writing (in
    `stardust/eds-conversion-log.md` or similar)"
  - `deploy/SKILL.md:957` — "Update ... (or create one) with: final block
    inventory, decisions locked, anti-patterns avoided this run"
  Free-form prose, no fixed path, no schema, and **no defined reader** — no
  step in any skill specifies reading it back.
- The Step 7 parallel-agent brief needs a list that has no source:
  `deploy/SKILL.md:588` — "**Existing blocks — REUSE, do not recreate**: [list
  with one-line authoring shape per block]". Today the orchestrator re-derives
  this by reading `blocks/` on every run. That re-derivation is exactly the
  thing that drifts.
- `stardust/eds-schema/<page>.json` (Step 2b) is the real ENCODE/DECODE
  contract — but it is keyed by **page**, not by block. Answering "what is the
  authoring shape of `cards`?" means locating some earlier page that used it.
- Nothing captures **page archetype composition** at all.

### Core call: memory belongs in the EDS repo, not in `stardust/`

`stardust/` is the redesign workspace — the right home for the *why* of a
one-time conversion. But someone adding a feature months later clones the EDS
repo and may not have `stardust/` at all. Implementation memory has to ship
with the code it describes.

### Proposed layers

**1. `blocks/<name>/README.md` — per-block contract (source of truth).**
Authoring shape (row/cell table), variant classes and what each does, decode
tier (template-slotted vs reconstructive, per `deploy/SKILL.md:246`),
component-model shape (simple / key-value / container), block-specific
gotchas. Co-location is the point: an agent opening `blocks/cards/` to reuse
the block gets the contract for free, and deleting the block deletes its doc.
Structurally cannot drift from the code.

**2. `blocks/registry.json` + generated `blocks/BLOCKS.md` — the index.**
Generated by a script from layer 1; never hand-maintained. Two payoffs:
- The Step 7 brief's "Existing blocks — REUSE" list becomes generated instead
  of improvised.
- One read answers "what do we already have" for any new work.
Consider a `--check` mode (CI/gate) asserting every `blocks/*/` has a README
and the registry is current.

**3. `stardust/eds-conversion-log.md` — unchanged, narrowed.**
Keeps the chronological *why*: naming ceremony answers locked, decisions,
anti-patterns hit this run. It is the journal, not the reference. Much of its
current drift comes from being asked to be both at once.

**4. Archetype map — the layer most likely to be missed.**
A block registry cannot express "a service page is `service-hero` →
`approach` → `closing`". Record archetype → ordered block composition + a
pointer to the reference content page that exemplifies it. "Build a new
service page" then resolves to "copy this one", which is what actually keeps
new work aligned. Home could be `content/ARCHETYPES.md`, or an `archetypes`
section in `registry.json` (generated from the deployed content pages).

### Connections

- Ties directly to note 1: the CLAUDE.md managed block should point at the
  registry and the archetype map. That is what makes any of this discoverable
  to a session that never invokes a stardust skill.
- `deploy/SKILL.md:236` ("scale the naming ceremony to the number of pages")
  gets easier with a registry: on a repeat run the reuse-vs-new question is
  answered from the registry instead of from the user.

### Proactive maintenance — non-negotiable per the standing requirement

Creation and maintenance are separate problems; layers 1-2 above only solve
creation. Both need to happen with no user prompting.

- **On write (creation).** The per-block agent in Step 7 writes
  `blocks/<name>/README.md` as part of the block's done-criteria, from a fixed
  template in the brief — same standing as "the block is not done until
  `block-roundtrip.mjs` exits 0" (`deploy/SKILL.md:590`). No prompt here: this
  is stardust documenting code it is writing in the same run, so there is no
  real choice to put to the user. Regenerate the registry at the end of the
  run and name it in the summary.
- **On change (maintenance) — the harder half, currently unaddressed.** When a
  later session edits `blocks/cards/cards.js` (adds a variant, changes the row
  contract), the README must move with it. Options, roughly in order of
  strength:
  - A **gate script** comparing each block's README against the block source
    (at minimum: variant classes named in the CSS vs variants documented; row
    indices read in `decorate()` vs the documented authoring shape). Fails
    loud on divergence. Strongest, because it does not depend on the editing
    agent knowing the convention.
  - A **rule in the CLAUDE.md managed block** (note 1): "when you change a
    block's decode contract or variants, update its README in the same
    change." Cheap, catches the agent-edited case, useless for hand edits.
  - **Registry `--check` in CI** — catches missing READMEs and a stale index,
    but not a README that is present and wrong.
  Recommend the gate + the CLAUDE.md rule together: the rule makes it happen,
  the gate makes it verifiable. The registry generator should also stamp a
  source hash per block so staleness is detectable rather than inferred.
- **Archetype map on change.** Same problem, weaker tooling: adding a page
  that introduces a new composition should update the archetype map in the
  same run. Probably falls out of regenerating the map from deployed content
  pages rather than maintaining it by hand — worth preferring generation here
  for exactly that reason.

### Open questions

- Registry generation from source vs from per-block READMEs. Generating the
  authoring shape directly from block source + section schema would make it
  self-maintaining (no drift possible), but some of layer 1 is genuinely
  prose (gotchas, why-this-shape) and cannot be derived. Likely split:
  generated fields + a hand-written prose section, with the gate covering
  only the generated half.
- Does the registry go in `blocks/` or repo root? `blocks/` keeps it adjacent
  to what it indexes; root is more discoverable. Leaning `blocks/`, with the
  CLAUDE.md pointing at it.
- Should `stardust/eds-schema/<page>.json` gain a by-block index, or is the
  per-block README enough? Possible that the README's authoring-shape table
  should be generated from the schema rather than written by hand.

---

## 3. Folder structure — skill-named artifact tree, and where it lives

**Idea.**

- For stardust CMS-agnostic work: build a folder structure under a folder
  called `stardust/`, where the structure reflects **the skill names that
  produced the artifacts**.
- For EDS projects: the skill registers the **EDS project GitHub URL**, the
  **DA folder URL**, and the **`da_token` location**.
- Stardust artifacts are maintained **inside the EDS project**, under a
  `stardust/` folder.

### Findings — the current tree is organised by artifact type, not by producer

Today's layout mixes conventions, and one skill already does it the proposed
way (`audit/`):

| Current path                       | Produced by            | Skill-named target        |
|------------------------------------|------------------------|---------------------------|
| `stardust/current/`                | `extract`              | `stardust/extract/current/` |
| `stardust/canon-source/`           | `extract --design-source` | `stardust/extract/canon-source/` |
| `stardust/direction.md`            | `direct`               | `stardust/direct/direction.md` |
| `stardust/prototypes/`             | `prototype`            | `stardust/prototype/`     |
| `stardust/canon/`                  | `prototype --prep`     | `stardust/prototype/canon/` |
| `stardust/migrated/`               | `migrate`              | `stardust/migrate/`       |
| `stardust/eds-schema/`             | `deploy`               | `stardust/deploy/schema/` |
| `stardust/eds-conversion-log.md`   | `deploy`               | `stardust/deploy/conversion-log.md` |
| `stardust/runtime-contract.json`   | `deploy`               | `stardust/deploy/runtime-contract.json` |
| `stardust/audit/<domain-slug>/`    | `audit`                | already correct           |
| `stardust/dynamic-blocks-map.md`   | (confirm producer)     | TBD                       |

**Cross-cutting files stay at `stardust/` root** — they belong to no single
skill and every skill reads/writes them: `state.json`, `journal.md`,
`learnings.md`. Proposed rule: *skill-produced artifacts live under
`stardust/<skill>/`; only cross-cutting state sits at the root.*

Note that `canon/` is written by `prototype --prep` but consumed by `migrate`
(`migrate/SKILL.md:73-88`, including the auto-bootstrap path where **migrate**
writes canon itself). Producer-based naming puts it under `prototype/` even
though migrate can author it. Either accept that, or carve out a
`stardust/canon/` shared-artifact exception alongside the root state files.
Worth deciding explicitly — it is the one case where the rule is ambiguous.

### Migration cost — real, and the reason to do it once, properly

Path references across `skills/` today:

| Path                   | Refs |
|------------------------|------|
| `stardust/current`     | 167  |
| `stardust/migrated`    | 84   |
| `stardust/prototypes`  | 56   |
| `stardust/canon`       | 54   |
| `stardust/direction.md`| 47   |
| `stardust/audit`       | 11   |
| `stardust/eds-schema`  | 5    |

64 files touch these paths. Implications:

- This is a **breaking change** for projects already on disk. Needs either a
  compat shim (read old path if new is absent, migrate on next write) or a
  clean break with a version bump + a one-shot migration script. Recommend the
  migration script — a shim doubles every path lookup forever.
- Do **not** hand-sweep 64 files a second time. Introduce a single paths
  reference (`skills/stardust/reference/paths.md`, or better a
  `paths.json` the scripts import) so the next rename is one edit. The current
  sprawl is itself the argument for the restructure.
- The eval fixtures (`evals/*/fixture/stardust/`) encode paths too — include
  them in the sweep or the evals go red.

### EDS project registration

Register once, at first deploy, into `stardust/deploy/project.json`:

```json
{
  "github":  "https://github.com/<org>/<repo>",
  "branch":  "main",
  "da":      "https://da.live/#/<org>/<repo>",
  "daToken": { "source": ".env", "key": "DA_TOKEN" }
}
```

**Record the token's *location*, never its value.** This file will be
committed (it lives inside the EDS repo — see below), so it must be safe by
construction: a pointer to `.env#DA_TOKEN`, never the secret. Reinforces the
existing token hygiene rule at `deploy/SKILL.md:89` (`.gitignore` must cover
`.env`, `.env.*`, `qa/`) — the registration file is the natural place to
assert that gitignore state at write time and fail loudly if `.env` is
tracked.

Payoff: `deploy`, `rollout`, and `diff` currently re-derive `$ORG`/`$REPO`/
`$BRANCH` per run (`da-deploy-protocol.md:15-65` builds every preview/live URL
from them). Registering once makes the branch preview URL, DA edit URL, and
live URL derivable rather than re-asked.

### Artifacts inside the EDS project — decide what is committed

Putting `stardust/` inside the EDS repo makes the memory travel with the code
(good, and it is what makes note 2's registry and note 1's CLAUDE.md coherent
as one system). But some of the tree is heavy and generated:

- **Commit**: `direct/direction.md`, `deploy/` (schema, conversion log,
  runtime-contract, project.json), `state.json`, `journal.md`, `learnings.md`,
  `prototype/canon/`. Small, textual, and the actual memory.
- **Gitignore, probably**: `extract/current/assets/` (downloaded media,
  screenshots), `migrate/` (a full static site copy — large, regenerable),
  `extract/canon-source/`. These are reproducible captures, not memory.

Ship a `stardust/.gitignore` written by the same skill that creates the tree,
so this is decided once rather than per project.

### Interaction with note 2 — one argument there needs revising

Note 2 argued implementation memory belongs in the EDS repo "not `stardust/`",
partly because *"someone adding a feature months later clones the EDS repo and
may not have `stardust/` at all."* If `stardust/` lives **inside** the EDS
project and is committed, that specific argument dissolves.

The rest of note 2 still holds, on different grounds: `blocks/<name>/README.md`
wins because it is co-located with the code it describes (an agent opening the
block directory gets the contract for free; deleting the block deletes its
doc), not because `stardust/` is unavailable. Reconcile the wording in note 2
when implementing — as written the two notes appear to disagree.

---

## 4. `prepare-rollout` — deep EDS analysis and contributable implementation plan

**Idea.** For EDS-specific migration, run an initial very deep and broad
analysis of the site and turn it into a **full implementation plan other users
can follow to contribute to the migration**. Coverage required:

1. Full list of URLs of the site
2. Full coverage of page archetypes needed for full migration
3. Full coverage of dynamic capabilities — item lists, **search**
4. Full map of EDS indexes
5. API integrations, reverse-engineered from the live site
6. Martech reimplementation — what makes sense to carry over
7. **100% IA fidelity**

### Findings — `prepare-migration` covers about half of this

The five-phase cascade in `skills/prepare-migration/SKILL.md` is the closest
existing thing. Scoring the seven asks against it:

| # | Ask | Status today |
|---|-----|--------------|
| 1 | URL inventory | **Good.** `extract/reference/ia-extraction.md` — sitemap → recursive sitemap-index → `robots.txt` → BFS fallback, with URL normalization and relative-`<loc>` resolution. `--prep` lifts the page cap. |
| 2 | Page archetypes | **Good.** Phase 1 types every page; Phase 3 approves one archetype prototype per type + writes canon. |
| 3a | Item lists | **Good, genuinely strong.** Phase 4.5 maps every listing block and classifies each needed field Tier 1 (page-intrinsic DOM) / Tier 2 (page metadata, must be emitted at author time) / Tier 3 (relationships — stays static until modeled). Ordering before bulk import is deliberate. |
| 3b | **Search** | **Missing entirely.** No mention anywhere in the plugin. |
| 4 | EDS indexes | **Partial.** Phase 4.5 authors `helix-query.yaml` scoped indexes from the metadata contract, but scoped to listing blocks — not a full site index map. |
| 5 | **API integrations** | **Missing.** Nothing catalogs the live site's XHR/fetch endpoints. |
| 6 | **Martech** | **Missing — and currently inverted.** Martech is treated as *noise to remove*, not capability to port: `extract` dismisses consent banners (`playwright-recipe.md:234-238`, OneTrust/Cookiebot/Didomi/osano), `diff` dismisses overlays. Nothing records what tags were on the page or decides their fate. |
| 7 | 100% IA fidelity | **Partial, and back-to-front.** Redirects only appear late, as a byproduct of `rollout` Phase C's path-safety gate (`rollout/SKILL.md:149` writes `stardust/redirects.tsv`). No coverage ledger reconciling discovered URLs against delivered ones. |

**The bigger structural gap: there is no contributable plan.** Grepping
`rollout` and `prepare-migration` for contributor / team / work-partition
concepts returns nothing. The cascade is confirmation-gated for **one
operator** at a keyboard and terminates in `Next: $stardust migrate`. What is
being asked for here is a different deliverable: a written plan that partitions
the migration into independent units other people can pick up.

### Placement — a new `prepare-rollout`, EDS-specific, run early

**`prepare-migration` is EDS-agnostic; this plan is EDS-specific.** That
boundary is already in the code: `migrate/SKILL.md:16` describes its own
output as "agnostic HTML — downstream conversion (AEM EDS, a CMS, a …)" and
`migrate/SKILL.md:466` explicitly excludes generating EDS. The agnostic/EDS
seam is `migrate` | `rollout`.

**Phase 4.5 is currently on the wrong side of that seam.** It reasons about
EDS query-indexes (`prepare-migration/SKILL.md:245`) and authors
`helix-query.yaml` into the "EDS project root" (`:314`) — the single
EDS-specific step inside the agnostic cascade. Moving it into
`prepare-rollout` purifies `prepare-migration`; its Phase 4.5 becomes a
*check* ("targeting EDS? `prepare-rollout` must have run before migrating at
scale") rather than an implementation.

**Own skill, not folded into `rollout`.** `rollout`'s Setup gates on
`stardust/migrated/` already existing (`rollout/SKILL.md:36`) — it runs late by
construction. But the blueprint's highest-value outputs (metadata contract,
index map) must exist *before* migrate runs at scale; that ordering constraint
is the whole reason Phase 4.5 sits where it does. Putting the blueprint inside
`rollout` would recreate the retrofit problem Phase 4.5 was designed to
prevent.

So: **`stardust:prepare-rollout`**, positioned flexibly between `extract` and
`rollout`, re-runnable and incremental — each section fills in as its upstream
data becomes available:

| Section | Earliest runnable after |
|---|---|
| URL inventory + coverage ledger | `extract` |
| API integration catalog | `extract` (needs the crawl's network log) |
| Martech inventory + verdicts | `extract` |
| Dynamic capabilities + index map | `extract` (typing) |
| Archetype coverage | `direct` / `prototype` |
| Work packages | once archetypes + block plan exist |

Per note 3 it lands at `stardust/prepare-rollout/`; per the standing
requirement it is written and refreshed without the user asking.

**Keep raw capture agnostic, keep interpretation EDS-specific.** Two of the
asks need data collected during the crawl, which is `extract`'s job and must
stay CMS-agnostic. Split them:

- `extract` records the **network log** and the **third-party tag inventory**
  as raw evidence — agnostic facts about the live site, useful to any target.
- `prepare-rollout` **interprets** them: porting verdicts per endpoint
  (reimplement as block JS / replace with a query-index / proxy / drop) and
  keep-replace-drop per tag against EDS capabilities (e.g. EDS ships RUM
  natively, making some analytics redundant).

This keeps the seam clean and solves the ordering constraint below — the
capture rides along with the crawl that already happens.

Section-by-section, with where each comes from:

- **§ URL inventory + coverage ledger (asks 1, 7).** Every discovered URL with
  its disposition: `migrate` (→ target path) / `redirect` (→ target) /
  `drop` (with a reason). This ledger IS the definition of 100% IA fidelity —
  fidelity is provable when every discovered URL has a disposition and every
  `migrate` row is delivered. Derive the redirect map **here, upfront**, from
  the IA, rather than discovering it in `rollout` Phase C. Feed
  `stardust/redirects.tsv` from the ledger instead of the other way round.
- **§ Archetype coverage (ask 2).** Type → page count → representative page →
  archetype status. Explicitly lists which types have **no** approved
  archetype yet — that gap list is the contributor work queue.
- **§ Dynamic capabilities (ask 3).** Extend Phase 4.5's tier model beyond
  listings to cover **search** — which is distinct: an EDS site search is
  typically a full-content query-index plus client-side filtering, with its
  own index scope, its own metadata needs, and a decision about
  fuzzy/facets/pagination. Also worth cataloguing: filters/facets,
  sort/pagination, forms, gated content, personalization surfaces.
- **§ EDS index map (ask 4).** One table of every index: scope glob, target
  path, properties, which blocks consume it, and estimated row count.
  `helix-query.yaml` is generated from this table, so the map is the source
  and the config is the artifact.
- **§ API integrations (ask 5).** *This is nearly free and should be built
  first.* `extract`'s Playwright recipe already routes every request through
  an interception layer (`playwright-recipe.md:134`, `:154`, `:175`) — the
  plumbing exists, nothing records it. Add a network-capture pass during the
  prep crawl that logs XHR/fetch per page and catalogs: endpoint, method,
  request/response shape, auth mechanism, which UI surface consumes it,
  whether it is third-party or first-party, and a porting verdict (reimplement
  as EDS block JS / replace with a query-index / proxy / drop).
- **§ Martech (ask 6).** Inventory what is actually on the live pages —
  analytics (Adobe Launch/Analytics, GTM/GA4), consent management (the vendors
  the dismissal code already detects are a free signal), tag managers, A/B
  testing, personalization, chat, forms/marketing automation. Then a per-tag
  verdict: **keep** (reimplement on EDS — note EDS ships RUM natively, so some
  analytics is redundant), **replace**, or **drop**, each with a reason. "What
  makes sense" is a judgement call per tag, so the plan records the reasoning,
  not just the outcome. Consent especially needs an explicit decision because
  today it is auto-dismissed and thus invisible.
- **§ Work packages (the contributable part).** Partition into units sized for
  one contributor: which pages, which blocks, which archetype, dependencies
  ("needs `cards` block from package 3"), and done-criteria per package
  (round-trip gate exits 0, David's-Model lint clean). This is the section
  that makes the document a plan rather than a report, and it is what
  `deploy` Step 7's parallel-agent brief (`deploy/SKILL.md:560`, one agent per
  archetype cluster) already gestures at for agents — the same partition works
  for humans.

### Notes / open questions

- **Sequencing.** Ask 5 (API capture) must ride along with the prep crawl —
  retrofitting means re-crawling the whole site. If only one piece of this
  gets built first, build the network-capture pass, because it is the only one
  with a hard ordering constraint.
- **Cost.** A very deep analysis of a large site is expensive. Worth a
  `--depth` control, or sampling by archetype (analyse N representatives per
  type) rather than every URL for the expensive passes — while keeping ask 1
  exhaustive, since the URL list must be complete for fidelity to mean
  anything.
- **Plan staleness.** The blueprint describes a moving target — as packages
  land it must reflect that. Either regenerate the status columns from
  `state.json` on every run (preferred; the plan stays a view over live state)
  or accept it as a point-in-time document and date it. Do **not** hand-
  maintain checkboxes.
- **Overlap with `rollout`.** `rollout` Phase A already builds a coverage
  inventory and Phase B a block-dedup plan. Decide whether `prepare-rollout`
  *feeds* rollout or duplicates its front half — most likely it owns the
  planning and rollout consumes it, with Phase A/B reduced to reading the
  plan. This is the main design question left on this note.
- **Naming.** `prepare-rollout` mirrors `prepare-migration` and states the
  pairing (agnostic prep → agnostic migrate; EDS prep → EDS rollout). Check it
  does not read as "prepare *for* rollout only" — it is also the document
  contributors work from throughout, not just a pre-flight.
- **Migration of Phase 4.5.** Moving it is a behaviour change for anyone
  mid-cascade. Needs the same treatment as note 3's path moves: relocate, and
  leave `prepare-migration` Phase 4.5 as a gate that points at the new skill
  rather than silently dropping the step.
