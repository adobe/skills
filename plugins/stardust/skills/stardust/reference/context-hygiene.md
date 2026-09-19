# Context hygiene — what enters the conversation

Rules for what a coordinator lets into its own context: runner output,
delegated-agent output, file re-reads and the point at which a long run
hands itself off to a fresh session. The image-read budget is the
companion section. Field counts live in the CHANGELOG, not here.

## When to read what

- § Runner reports and session hand-off — before running any batch instrument (verify, qa, gate sweeps, deploy-batch) and at every phase boundary of a multi-phase run.

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
