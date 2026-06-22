# Phase 6 — Reflect

Goal: capture findings from this run so the next run is better.
This phase does NOT close the iteration — closure is a separate,
user-initiated action.

## 6.1 — Update the project's `notes.md`

Append a `## Phase: Round-trip` and (if relevant) `## Phase: Reflect`
section summarizing what happened in each phase. Include:
- Local round-trip outcome (sections present, slot count,
  console errors, screenshot inventory)
- Production round-trip outcome (URLs, sanity-probe codes, Media Bus
  behavior)
- Anything that surfaced as a project-specific finding (e.g. "this
  source had a unique X pattern")
- Anything that surfaced as a CROSS-PROJECT finding (e.g. "a new
  pipeline behavior we should encode in the methodology")

## 6.2 — Update the project's `learnings.md`

Create or append to `<projectsDir>/<NNN>-<slug>/learnings.md`.
Each entry is dated `## YYYY-MM-DD — short title` with sections:
- Context (one paragraph)
- Visible symptom (if a bug)
- Fix applied to this project
- Generic rule (if promotable)

Mark cross-project items with `[promoted]` so a reader can scan for
the ones that landed in the skill knowledge.

## 6.3 — Promote cross-project findings

For every finding marked `[promoted]`:

1. Add an entry to the target repo's
   `experiments/knowledge/learnings.md` (the project-local cross-
   project learnings file). Top of the file, dated, with full context.
2. If the finding is a rule the methodology should enforce, update
   the target repo's `experiments/knowledge/methodology.md` —
   specifically the phase the rule applies to (Generate / Round-trip
   / etc.).
3. If the finding contradicts or extends the substrate documentation,
   update `experiments/knowledge/architecture.md` too.

These updates land in the SAME commit that closes the run, when the
user asks for closure. Until then, they're staged but uncommitted.

### Promote to the skill bundle itself

If the finding is generic enough to live in the skill (not project-
specific), it should also be PR'd to the skill repo (this repo). The
agent CAN propose this via a separate worktree on the skill repo —
or, if that's friction, just collect candidates in `notes.md` under
a "promote-to-skill" heading and let the user raise the PR when
convenient. Hosts that don't make `git` cheap can default to the
latter.

## 6.4 — Run a timing summary (optional but helpful)

If the run captured per-phase timestamps in state.json, summarize:

```
phase             duration    notes
capture           <s>
analyze           <s>
generate          <s>         largest single phase, usually
wire              <s>
roundtrip-local   <s>
roundtrip-prod    <s>
reflect           <s>
```

Add this to `notes.md` under a "Timings" section. Helps tune future
runs.

## 6.5 — Auto-memory updates (host-dependent)

If the host supports persistent memory across sessions (Claude Code
auto-memory, similar primitives elsewhere) and the run surfaced a
user-feedback rule (something about the user's preferences, not
about the conversion), save it. Examples from prior runs:
- "User wants closure to be explicit, not agent-initiated."
- "User wants to be asked before phases are skipped."

Skip this on hosts that don't have a memory primitive.

## 6.6 — Stop. Do NOT close the iteration.

The skill's job ends here. Closure (`iter-<NNN>-close` tag,
fast-forward of the integration trunk) requires the user to say
"close this iteration" or equivalent. The agent presents the run as
ready-for-close, lists what would happen on close, and waits.

When the user gives the explicit go-ahead, run:

```bash
# Resolve branch + trunk + tag conventions from config (with defaults)
BRANCH_PREFIX=$(jq -r '.branchPrefix // "snowflake-"' \
  .snowflake/config.json 2>/dev/null || echo "snowflake-")
TRUNK=$(jq -r '.trunkBranch // "main"' \
  .snowflake/config.json 2>/dev/null || echo "main")
TAG_PREFIX=$(jq -r '.tagPrefix // "snowflake-"' \
  .snowflake/config.json 2>/dev/null || echo "snowflake-")

BRANCH="${BRANCH_PREFIX}${NNN}"
TAG="${TAG_PREFIX}${NNN}-close"

git checkout "$BRANCH"
git tag "$TAG"
git checkout "$TRUNK"
git merge --ff-only "$BRANCH"
git push origin "$TRUNK"
git push origin "$BRANCH"
git push origin "$TAG"

# Update the project README's Status section to:
#   "Closed YYYY-MM-DD (tag $TAG)"
```

The defaults match a typical EDS site repo (`main` as trunk,
`snowflake/NNN` as run branches, `snowflake-NNN-close` as closure
tags). The R&D project the skill was distilled from used different
conventions; if a repo wants those, set them in
`.snowflake/config.json`.

Then update state.json one last time: `state.phase = "closed"`,
`state.phaseStatus = "complete"`, `state.closedAt = "<timestamp>"`.
