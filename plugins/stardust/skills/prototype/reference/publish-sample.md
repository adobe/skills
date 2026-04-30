# Publish a sample to the showcase

The procedure for `$stardust prototype --publish-sample <slug>`.
Stages a new sample folder in the stardust source repo, opens a
PR, and lands the sample in the showcase published at
`https://{owner}.github.io/stardust-2/`.

The flow assumes:

- The user's stardust project is at the current working directory,
  with a state.json containing the slug and the slug's status is
  `approved` (or `prototyped` with the user's explicit
  acknowledgement that they want to publish a non-approved
  prototype — the publish flow surfaces this as a warning, not
  a block).
- The user has the GitHub CLI (`gh`) installed and authenticated.
  `gh auth status` exits zero.
- The stardust source repo is reachable (default upstream:
  `paolomoz/stardust-2`; configurable via `--upstream <owner/repo>`).

The user does **not** need write access to the upstream repo —
`gh pr create` will fork on the user's behalf if needed.

---

## Inputs

- `<slug>` — required positional. The page slug to publish. The
  proposed file must exist at
  `stardust/prototypes/<slug>-proposed.html` (single-variant) or
  `stardust/prototypes/<slug>-proposed-A.html` (multi-variant).
- `--upstream <owner/repo>` — optional. Override the upstream repo
  the PR targets. Default `paolomoz/stardust-2`.
- `--variants <list>` — optional. Comma-separated variant ids to
  include (e.g. `A,B,C`). Default: every variant on disk for the
  slug.
- `--sample-slug <slug>` — optional. The slug to use in the
  showcase (defaults to the page slug, lowercased and
  hyphen-normalised, prefixed with the source domain when needed
  to disambiguate — e.g. a `home` page from
  `aurora-coffee.example.com` becomes `aurora-coffee`).
- `--dry-run` — optional. Run all the checks and stage the files
  in a temporary directory; print the planned PR title, body, and
  file list; do **not** push or open the PR.

---

## Procedure

### Phase 1 — Eligibility checks

Before touching any files, refuse to proceed if any of the
following fails. Surface the specific check that failed; do not
combine into a single "not eligible" message.

1. **`gh` is installed and authenticated.**
   - `gh --version` resolves.
   - `gh auth status` exits zero.
   - If either fails: tell the user how to install / authenticate
     and stop.
2. **The page exists in `stardust/state.json`.**
   - Slug entry present.
   - Status is `approved` (or `prototyped` with explicit user
     acknowledgement via the prompt: "publish a non-approved
     prototype? (y/n)" — record the answer in the PR body so the
     reviewer sees it).
3. **The proposed file(s) exist** for the slug. The expected
   filename pattern is `<slug>-proposed.html` (single-variant) or
   `<slug>-proposed-<id>.html` (multi-variant), but the publish
   flow does **not** rely on the filename pattern. Discovery is by
   provenance:

   - Scan `stardust/prototypes/*.html`.
   - For each file, parse the `<!-- stardust:provenance -->`
     comment block in `<head>`.
   - A file is a candidate variant for the named slug if its
     `page:` field equals `<slug>` and it is **not** the viewer
     (the viewer's `writtenBy:` says `stardust:prototype`'s
     viewer pass, while a proposed file's `writtenBy:` is plain
     `stardust:prototype` or `stardust:prototype/iterate`; the
     viewer also lacks a top-level `<!DOCTYPE html><html>` body
     section because it's iframe-shelled. The cheaper detection
     is the absence of `<iframe` tags in the body).
   - Variant id resolution: read the file's `<head>` `<meta
     name="variant" content="A">` if present; else read the
     filename for a single uppercase letter token (matches
     `home-proposed-A.html`, `home-variant-A-proposed.html`,
     `home-A-proposed.html`); else fall back to the file's
     position in the sorted candidate list (A, B, C, ...).
   - If `--variants <list>` was passed, restrict to the named
     ids and refuse if any named id has no candidate file.

   This tolerance lets older or differently-named projects
   publish without renaming. The spec example uses the canonical
   `<slug>-proposed-<id>.html` form, but the flow accepts any
   convention as long as the provenance and variant-id discovery
   resolve unambiguously.
4. **Placeholder content is allowed.** The showcase is a **visual
   demonstration** of the redesign — composition, palette,
   typography, layout, motion — not a deployable site. Placeholders
   are deliberately visible per the F-002 PLACEHOLDER signature
   contract (dashed outline + monospace eyebrow + surface-alt
   tint). A showcase reader can tell at a glance what's sourced
   and what's illustrative; that's the protection.

   Procedure:
   - Read each proposed file's `<!-- stardust:provenance -->`
     block and parse `unsourcedContent[]`.
   - If any is non-empty: surface the unsourced list to the user
     ("3 placeholders across 2 variants — publish anyway? [y/n]")
     and **default yes**. Record the list verbatim in the PR body
     under § Unsourced content so reviewers see what's sourced
     vs illustrative without opening the files.
   - The publish flow does **not** refuse on placeholders.

   `migrate`'s placeholder guard is **unchanged**: deploying a
   public site with placeholder content is still refused there
   (`migrate/SKILL.md § Failure modes`). The showcase publish is
   a different flow — different audience (designers reviewing a
   visual sample vs. end-users browsing a deployed site),
   different stakes (design demonstration vs. production claim),
   different gate. Don't conflate them.
5. **No outstanding P0/P1 critique findings.** Read each proposed
   file's `_provenance.critique[]`.

   - If the field exists and contains any P0 or P1 finding without
     a recorded user acknowledgement: refuse. The user runs Phase
     2.5 (Validate via critique) and either fixes or acknowledges
     before publishing.
   - If the field is **absent entirely**: that means critique was
     not run on this file (typical for prototypes from before P-3
     landed in the spec). This is **not** a publish blocker — the
     spec treats absence as "no findings." But the PR body
     records `critique: not run` so the reviewer knows to run it
     before merging, and the publish flow surfaces a one-line
     warning to the user: "critique not run on N variant(s);
     reviewer will see this in the PR."
6. **Anti-toolbox audit clean.** Read
   `DESIGN.json#extensions.divergence.anti_toolbox_hits[]`. Every
   hit must have a brand-specific justification (per
   `divergence-toolkit.md` § 1). If any is unjustified or empty,
   refuse.
7. **Direction artefacts present.** `direction.md`,
   `_brand-extraction.json`, and `current/PRODUCT.md` exist in the
   project — these are the inputs the publish flow reads to
   author `meta.json`.

### Phase 1.5 — Backup originals (mandatory before any transform)

If Phase 2 is going to **modify** the user's project files (rename
variants to canonical names by writing in place, strip placeholder
markup at the user's request, regenerate provenance, etc.), copy
the originals first to a per-publish backup directory **inside the
user's project**:

```
<user-project>/stardust/_pre-publish-backup/<showcase-slug>/<ts>/
  ├── home-variant-a-proposed.html       (original, byte-for-byte)
  ├── home-variant-b-proposed.html
  ├── home-variant-c-proposed.html
  └── _backup-manifest.json               (timestamps + sha256 + reason)
```

`<ts>` is an ISO date-and-second timestamp so multiple publish
attempts on the same slug each get their own backup.

The backup is **mandatory** because:

1. Many user projects are not git-tracked. The publish flow
   cannot rely on `git stash` / `git checkout` to recover.
2. Errors in the publish flow (or the user changing their mind
   mid-way) need a recovery path that doesn't depend on the
   agent's conversation log being intact.

The flow does **not** delete the backup at the end of a successful
publish. The user can inspect, diff, or restore. Backups older than
30 days can be cleaned up by the user manually; the publish flow
never deletes them on its own.

**Default no-op path.** When Phase 2 only *reads* from the user's
project (file copy into a worktree of the upstream stardust repo;
no in-place modifications) — which is the typical case — the
backup step is still run for symmetry but produces a small
`_backup-manifest.json` with `transformsApplied: []`. The
`pre-publish-backup/` folder always exists after a publish; the
manifest documents whether anything was actually transformed.

This Phase exists because of a real recurrence risk
(`STARDUST-FEEDBACK.md F-018` — the destructive-edit incident
during the fiserv-com publish dry-run). The agent attempted to
clear `[data-placeholder]` elements in place; the project was
not git-tracked; the originals were lost. Backup-first prevents
this class of failure.

### Phase 2 — Stage the sample

Compute the showcase slug per `--sample-slug` rules:

- Default: lowercase the brand name from
  `current/PRODUCT.md#site.name` (or `_brand-extraction.json#site.name`),
  ASCII, replace whitespace with `-`, drop punctuation. Aurora
  Coffee → `aurora-coffee`.
- Disambiguation: if the upstream's `samples/index.json` already
  contains the slug, suffix `-2`, `-3`, etc. (the user can override
  with `--sample-slug`).

Clone the upstream into a working directory:

```
gh repo clone <upstream> <tmp>
cd <tmp>
git checkout -b add-sample-<showcase-slug>
mkdir -p samples/<showcase-slug>
```

Copy files from the user's project:

| user project file | sample destination |
|---|---|
| `stardust/prototypes/<slug>-proposed.html` (single-variant) | `samples/<showcase-slug>/proposed-A.html` |
| `stardust/prototypes/<slug>-proposed-<id>.html` for each variant id | `samples/<showcase-slug>/proposed-<id>.html` |
| `stardust/current/current-rendering.html` if present (or render fresh from `current/pages/<slug>.json`) | `samples/<showcase-slug>/current.html` |
| `stardust/direction.md` | `samples/<showcase-slug>/direction.md` |
| `stardust/current/assets/screenshots/<slug>.png` | `samples/<showcase-slug>/thumbnail.png` (the existing extract-time screenshot is the right cover for the *primary* variant; secondary variants get per-variant thumbnails only when the user supplies them via `--variant-thumbnail <id>:<path>`) |

Author `meta.json` from the user's project state, following
`samples/sample-format.md`:

- `slug` from the showcase slug.
- `title` from `current/PRODUCT.md#site.name` + a one-line
  positioning derived from the resolved direction.
- `tagline` short — generated by re-stating the resolved
  direction as a "from X to Y" arc. Author limits this to 16
  words; longer taglines require user editing before submit.
- `source.url` from `state.json#site.originUrl`.
- `source.register` from `current/PRODUCT.md#register`.
- `source.category` left empty for the user to fill in the PR
  comment if they want — never invent.
- `source.extractedAt` from `state.json#site.extractedAt`.
- `direction.phrase` verbatim from `direction.md` § Phrase.
- `direction.movements[]` from `direction.md` § Movements (each
  rendered as `axis: from → to`).
- `direction.seed` mirroring `DESIGN.json.extensions.divergence.seed`.
- `direction.fontDeck` mirroring
  `DESIGN.json.extensions.divergence.font_deck`.
- `direction.palette` mirroring
  `DESIGN.json.extensions.divergence.palette_source.picked_palette`,
  with `pickedBy` reflecting `picked_by` and the
  `brandFaithfulInversions[]` list from
  `DESIGN.json.extensions.divergence.brand_faithful_inversions[].rule`.
- `direction.antiToolbox` from the `anti_toolbox_count` plus the
  count of justified hits.
- `variants[]` — one entry per included variant. The single-
  variant case has `variants: [{ id: "A", isPrimary: true,
  proposedFile: "proposed-A.html" }]`.
  - `name` derived from the variant's frontmatter
    (`<slug>-shape-<id>.md#variant`) when present; else
    "Variant <id>".
  - `dominantDimension` from the brief's `dominantDimension`
    field (per `divergence-toolkit § 2.5`); when missing,
    leave null and surface in the PR body for the user to fill.
  - `thesis` from the brief's first compositional paragraph;
    when missing, leave null.
- `current.renderingFile` set to `current.html` only when that
  file exists.
- `createdAt` = today's ISO date.
- `stardustVersion` from the project's `stardust/state.json#stardustVersion`
  (or the loaded plugin version as a fallback).
- `submittedBy` from `gh api user` `.login`.
- `license: "Apache-2.0"` (the showcase's blanket license; the
  user is asserting they have rights to publish the sample).

Append to `samples/index.json` keeping the array sorted
alphabetically.

### Phase 3 — Commit and PR

Run the workflow's local manifest validator before pushing — same
script as `.github/workflows/showcase-pages.yml`. Refuse to push
if it fails (means the staging step produced an invalid
`meta.json` — bug in the publish flow worth surfacing rather than
papering over).

```
git add samples/<showcase-slug>/ samples/index.json
git commit -m "samples: add <showcase-slug>"
gh pr create --title "samples: add <showcase-slug>" --body "$(...)"
```

Use the **PR body template** in § PR body template below. Capture
the resulting PR URL and surface it to the user in the final
report.

### Phase 4 — Final report

Print a one-screen summary:

```
Sample published as PR.

  showcase slug: aurora-coffee
  source:        https://aurora-coffee.example.com/
  variants:      A (primary)

  PR:            https://github.com/paolomoz/stardust-2/pull/42

The sample lands in the showcase at
https://paolomoz.github.io/stardust-2/ once the PR merges and the
showcase-pages workflow redeploys (~1 minute after merge).

The PR carries an opinionated body summarising the run. Review it
before requesting merge — the auto-generated tagline and category
are best-guess; refine them in the PR before the maintainer
reviews.
```

---

## PR body template

The publish flow generates the PR body from this template. Fields
in `{braces}` are filled at submit-time.

```markdown
## Adding sample: `{showcase-slug}`

Source: {source.url}  ·  register: {source.register}  ·  extracted {source.extractedAt}

> {direction.phrase}

### Resolved direction

| field | value |
|---|---|
| seed | {seed.decade} × {seed.craft} × {seed.register} × {seed.groundFamily} ({seed.pickedBy}) |
| font deck | {fontDeck.name} ({fontDeck.pickedBy}) |
| palette | [{palette.name}]({palette.source}) (anchor {palette.anchor}, {palette.pickedBy}) |
| anti-toolbox | {antiToolbox.justified} of {antiToolbox.hits} hits justified |
| brand-faithful inversions | {palette.brandFaithfulInversions joined by " · "} |

### Variants ({variants.length} total)

{For each variant:}
- **{id} · {name}** — dominant dimension: `{dominantDimension}`. {thesis}

### Unsourced content {Render this section only when at least one variant has non-empty unsourcedContent[]; omit otherwise.}

The showcase is a visual demonstration; placeholders are
deliberately visible per the F-002 PLACEHOLDER signature
contract. Listed here so reviewers know what's illustrative.

{For each variant with placeholders:}
- **{id}** ({n} placeholder{s}):
{For each entry in variant._provenance.unsourcedContent[]:}
  - `{selector}` — type: `{type}` — {reason}

### Submitter checklist

The publish flow already verified these — reviewer can spot-check.

- [{x|⚠}] Placeholder content. {Render `[x] no placeholders` when
      every variant's unsourcedContent[] is empty; render `[⚠ N
      placeholders across M variants — see § Unsourced content
      above]` otherwise. Placeholders are allowed in the showcase
      per the visual-demonstration policy; the listing makes them
      visible to reviewers without opening files.}
- [{x|⚠}] No outstanding P0/P1 critique findings. {Render `[x]`
      when critique[] is present with no P0/P1; render `[⚠]
      critique: not run` when critique[] is absent on any variant
      — the reviewer should run `$impeccable critique` before
      merging.}
- [x] All anti-toolbox hits carry brand-specific justifications.
- [x] Every `meta.json#direction.seed.pickedBy` accurately records
      why each dimension landed where it did.
- [x] `meta.json#direction.palette.source` resolves to the picked
      palette.
- [x] Every `proposed-*.html` file is self-contained per
      `before-after-shell.md` § Required structure.

### Reviewer checklist

- [ ] Open `samples/{showcase-slug}/proposed-A.html` (and any
      additional variants) — does the rendered output read as
      claimed by the variant thesis?
- [ ] Skim `direction.md` — does the reasoning trace match what
      `meta.json` advertises?
- [ ] Confirm the source brand allows republication (or the
      sample is a fictional fixture).
- [ ] Confirm the showcase card renders correctly (load
      `samples/index.html` locally or wait for the Pages
      preview).

### Showcase URL after merge

`https://{owner}.github.io/stardust-2/`

The `showcase-pages` workflow redeploys on merge to main; the
sample is visible within ~1 minute.

---

🤖 Generated by `$stardust prototype --publish-sample {slug}` ·
stardust v{stardustVersion}
```

The two checklists — submitter and reviewer — are deliberate. The
submitter list is pre-checked because the publish flow verified
them. The reviewer list is unchecked so the maintainer's review
has a structured shape.

---

## Failure modes

- **Eligibility check fails.** Surface the specific check that
  failed and stop. Do not stage anything; do not touch the
  upstream repo.
- **`gh` not installed.** Tell the user how to install and stop.
- **`gh auth` not configured.** Walk the user through
  `gh auth login` in a one-line tip and stop.
- **Upstream repo unreachable.** (Network / private / typo.) Stop
  and surface the underlying `gh` error.
- **Manifest validation fails after staging.** This is a publish-
  flow bug — surface the validator output and the staged files.
  Do not push.
- **Branch already exists on the user's fork.** Suffix the branch
  name with `-2`, `-3`, etc.
- **PR creation fails after the branch is pushed.** Surface the
  `gh pr create` error and the branch URL so the user can open
  the PR manually.

The flow is **idempotent at the file-staging level** but not at
the PR level: re-running on the same slug after a merged PR will
hit "branch already exists" and bump to `-2`, which is correct.
Re-running on the same slug while a prior PR is open should be
caught earlier (the slug exists in upstream's
`samples/index.json` already; the disambiguation rule kicks in).

---

## What this does NOT do

- **Does not auto-merge.** The PR waits for human review.
- **Does not configure GitHub Pages.** That's a one-time repo
  settings step (Settings → Pages → Source: GitHub Actions),
  documented in `.github/workflows/showcase-pages.yml`.
- **Does not modify upstream `main` directly.** Always works
  through a PR, even when the user has write access.
- **Does not validate the sample's design quality.** Curation
  happens in the PR review (per `samples/README.md` § What makes
  a good sample). The publish flow only validates structural
  contracts (placeholders, critique, anti-toolbox, manifest
  shape).
- **Does not capture variants the user hasn't already
  prototyped.** If you want a 3-variant sample, render the
  variants first (per the multi-variant prototype flow when
  shipped — `STARDUST-FEEDBACK.md P-1`); the publish flow only
  ports what's on disk.
