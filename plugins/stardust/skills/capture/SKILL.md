---
name: capture
description: Submit one capture (source + one sentence) to the stardust learning corpus. Frictionless by design — no taxonomy, no classification, no verdict.
license: Apache-2.0
---

# stardust:capture

Submit a single capture — *"I saw something striking, and here's the
one-line note about why"* — into the stardust learning corpus. Captures
are raw signal that the curator pass later abstracts into named moves
(per `plugins/stardust/design/learning-system.md` §4).

This skill is **intentionally minimal**. The schema is `source + one
sentence`, nothing more, by design. Frictionless contribution is
load-bearing for the learning system; any field added here costs
contributions.

## Inputs

```
$stardust capture <source> [-- <sentence>]
$stardust capture <source> [-- <sentence>] --upstream
```

- `<source>` — required positional. A URL, file path, Figma frame ref,
  PDF path, or video reference. Format is detected automatically; no
  `--kind` flag.
- `<sentence>` — required. The one-line *"what is this doing that's
  different?"* If omitted from the command line, the skill prompts for
  it interactively.
- `--upstream` — optional. Write the capture to the plugin-side
  staging queue (`plugins/stardust/captures/`) instead of the
  project-side default (`<user-project>/stardust/captures/`). Used
  by contributors operating against this repo. Without the flag,
  captures are local to the user's project and stay there until the
  user PRs them upstream.
- `--new-contributor` — optional. Run the first-time-contributor
  walkthrough: a short explainer of what's about to happen, why the
  schema is minimal, and what the curator will do with the
  submission. After the walkthrough, the normal capture flow runs
  interactively (prompts for source and sentence). Subsequent
  captures don't need the flag; use it once per contributor.

## Setup

1. **Verify the source is reachable.** For URL: HEAD request returns
   2xx or 3xx. For file path / Figma ref / PDF / video: file exists
   or the ref is parseable. If unreachable, tell the user and stop.
2. **Detect the source kind** from shape:
   - Starts with `http(s)://` → `url`
   - Starts with `figma://` or matches `*.figma.com/file/` → `figma`
   - Path ending in `.png|.jpg|.jpeg|.webp|.gif|.svg` → `image`
   - Path ending in `.pdf` → `pdf`
   - Path ending in `.mp4|.mov|.webm` or starts with a video URL → `video`
3. **Resolve write target:**
   - With `--upstream`: `plugins/stardust/captures/`
   - Without: `<user-project>/stardust/captures/` (create if absent)

## Procedure

1. **Generate id.** `<ISO-8601-date>-<slug>` where `<slug>` is the
   first 4–6 lowercased alphanumeric words of the sentence, joined
   by `-`, capped at 40 chars. Example:
   `2026-05-02-asymmetric-grid-with-photographic-bleed`.
2. **Write the YAML file** at `<target>/<id>.yaml`:

   ```yaml
   source:
     kind: <detected kind>
     ref:  <verbatim source string>
   sentence:     <verbatim user sentence>
   submitted_by: <handle from git config or environment>
   submitted_at: <ISO-8601 now>
   ```

   Nothing else. **Do not** add tags, axis, verdict, brand_axes, or
   any classification field. Do not run vision or analysis on the
   source. Do not auto-suggest a move id. The whole point is that
   capture stays at this level of abstraction.

3. **Print confirmation:**

   ```
   captured
   ========

   id:        2026-05-02-asymmetric-grid-with-photographic-bleed
   source:    https://example.com/page (kind: url)
   sentence:  "the way the grid breaks under the masthead and lets
              the photo bleed past the column line"
   wrote:     stardust/captures/2026-05-02-asymmetric-grid-with-photographic-bleed.yaml
   ```

4. **Print one-line next step.** No celebration, no extended
   explanation:

   - Without `--upstream`: *"Local capture. PR to `adobe/skills` to
     promote upstream when ready."*
   - With `--upstream`: *"Plugin-side capture. Will land in the
     curator pass queue."*

## First-time contributor walkthrough (`--new-contributor`)

When the user passes `--new-contributor`, run the capture flow with a
brief explainer block printed first. The explainer is verbatim:

```
Welcome. A capture is the lowest-friction contribution to stardust's
learning corpus: a source (URL, image, Figma frame) plus one sentence
about what's distinctive.

We do not ask for tags, axes, verdicts, or classification — those
come later from the curator pass. The schema is intentionally minimal.

Your capture will:
  1. Land in the queue (project-side, or plugin-side with --upstream).
  2. Wait for company. Lone captures wait; clusters of ≥2 become
     candidate moves.
  3. Surface to you for signoff if your capture originated a cluster.

For a guided session that adapts to what you've done before and what
the corpus currently needs, just say "I am a contributor" — that
gives you a live plan rather than a CLI walkthrough.

Let's do your first one.
```

Then prompt for `source` and `sentence` interactively (per the normal
flow), write the file, and print the standard confirmation block. End
the session with one extra line:

```
This was your first capture. Subsequent runs don't need
--new-contributor; just $stardust capture <source> -- "<sentence>".
```

Use the flag at most once per contributor. The walkthrough is for
orientation, not for repeated use.

## Inline capture (during a session)

When the user says *"capture this"* (or similar) during an active
stardust session, treat it as a `$stardust capture` invocation
against the most recent source the session has discussed (URL viewed,
file referenced, Figma frame opened). Prompt for the sentence.

If the most recent source is ambiguous (multiple URLs in scope, no
clear referent), ask the user to specify. Never guess.

## Outputs

| Path                                          | Purpose                            |
|-----------------------------------------------|------------------------------------|
| `<target>/<id>.yaml`                          | The capture, frictionless schema.  |

No state.json updates. No direction.md updates. Captures are
side-channel to the redesign workflow; they don't alter the project's
own state.

## Failure modes

- **Source unreachable.** Stop. Tell the user. Do not write a partial
  file or attempt a fallback (no "best-effort" capture without a
  verified source).
- **Sentence empty or whitespace-only.** Re-prompt once. If still
  empty, abort. The sentence is the load-bearing field.
- **Slug collision** (someone captured something with the same first
  words on the same day). Append `-2`, `-3`, etc. to the slug.
- **Write target doesn't exist** (`stardust/captures/` missing in
  user project). Create it on demand; this is the first capture.

## What capture deliberately does NOT do

- **Classify.** No axis tag, no verdict, no `brand_axes`, no move
  id. The curator pass adds those later.
- **Validate the design quality.** Capture is an act of noticing,
  not an act of judgment. The verdict comes when (or if) the capture
  becomes part of an exemplar entry.
- **Promote.** A captured file lives in the staging queue (or
  project-side) until the curator pass abstracts it into a candidate
  move and a PR lands the move in `divergence-toolkit.md` §1a.
- **Auto-cluster.** Captures are individual; clustering happens at
  curator-pass time. Stardust does not "merge" or "deduplicate"
  captures at submission.
- **Enrich.** No vision-on-image, no Figma API calls, no metadata
  extraction. The source ref is the source ref; the sentence is the
  sentence.

## References

- `plugins/stardust/design/learning-system.md` §4 — the move
  contribution pipeline this capture feeds into.
- `plugins/stardust/captures/README.md` — the schema, contribution
  process, and what does NOT belong in the capture queue.
- `plugins/stardust/skills/stardust/reference/learning-system.md`
  — runtime contract; capture write paths are listed under "What
  stardust writes."

## Hard rules

- Never add fields to the capture schema. Frictionless is the point.
- Never auto-classify a capture. Classification belongs to the
  curator pass and the originating designer's signoff.
- Never promote a capture without designer signoff per §4 of the
  design doc.
- Never run analysis (vision, NLP, Figma API) on the source at
  submission. The capture is a pointer + a thought, not a derived
  artifact.
