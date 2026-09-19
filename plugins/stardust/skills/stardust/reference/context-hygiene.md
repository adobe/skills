# Context hygiene — what enters the conversation

Rules for what a coordinator lets into its own context: images, runner
output, delegated-agent output, file re-reads and the point at which a
long run hands itself off to a fresh session. Field counts live in the
CHANGELOG, not here.

## When to read what

- § Image reads — before any screenshot, capture or diff image is opened (gate rounds, capture checks, vision gates, QA triage).
- § Runner reports and session hand-off — before running any batch instrument (verify, qa, gate sweeps, deploy-batch) and at every phase boundary of a multi-phase run.

## Image reads

- **Numbers first.** `pixel-compare --json`, `crop-compare --json`,
  `anchor` and `row-profile` name the hot bands; only then open an
  image — at most one per named hot band, and at most 10 image reads
  per gate round.
- **Never read a stitched capture whole** — `live.png`, `proto.png`,
  `diff*.png`, `assets/screenshots/<slug>.png`. The viewer caps an image
  at 2,000 px tall, so a 1440-px-wide page taller than ~3,000 px is shown
  under 1,000 px wide and its text is not legible; the cost is paid, the
  information is not received. Read a band instead —
  `crop-compare --y <px> --height <px> --out <file>`, at most 1,500 px
  tall — or a downscaled whole-page view.
- **One image per turn; never re-read an image already in context**
  (crop a different band or re-run the instrument instead).
- **No image reads once the context passes ~80 % of its window** —
  finish the round on the numbers and hand off (§ Runner reports and
  session hand-off); an image-heavy request at the end of a long
  session is what kills the transcript.
- **Vision stays authoritative where a skill says so** — extract's
  Phase 2.5 `suspect` verdict opens the full page, prototype's brand-fit
  read uses a downscaled whole-page view, qa's `bands` evidence points
  the crop. The budget bounds *how* an image is read, never *whether*
  a required check runs.

## Runner reports and session hand-off

- **Batch runners report a ranked class table**, not a page list: class
  → count → worst example → file pointer, at most 60 lines, and they
  write `summary.json` + `summary.md` under `stardust/<skill>/`. Triage
  proceeds per class from `summary.md`; the per-page rows live in the
  files. (rollout `verify.mjs` and qa's `qa.mjs` write these files; a
  runner that does not yet is wrapped so that its stdout goes to a file
  and only the class roll-up is read.)
- **Nothing per-page is pasted into the conversation**: no page
  listings, probe dumps, persisted tool-result files, or a delegated
  agent's full output. Delegated agents hand back by pointer
  (`fan-out.md` § Worker contract); the coordinator reads their ledger
  and log, not their transcript.
- **After an edit, re-read the changed range only** — never the whole
  file to confirm a patch; the card-first rule (master § Hands-off mode,
  "Delegate by file pointer") already forbids whole reads over 20 KB.
- **Hand off at observable boundaries.** A multi-phase run ends the
  session at every phase boundary — the phase-close block, the journal
  `Next:` and `state.json` make it resumable (`run-status.md` § Phase
  close) — and after the first compaction summary appears; never work
  past a second compaction. The resumed session reads `state.json`, the
  last journal entry and the class report — not the persisted tool
  results of the previous session.
