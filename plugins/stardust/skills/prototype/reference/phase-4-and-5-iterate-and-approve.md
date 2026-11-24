# stardust:prototype: phases 4 and 5, iterate and approve

The text of this part of `skills/prototype/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 4 — Open and iterate

(Phase numbering skips 3; the former Phase 3 — *Compose the viewer*
— was removed when the per-page before/after viewer was dropped.
Cross-references throughout the docs still name Phases 4, 5, 5.5.)

1. Open the just-written or just-updated `<slug>-proposed.html` (or
   the user-chosen variant suffix when N > 1) in the browser using
   the `open <vfs-path>` shell command. This routes VFS paths through
   the preview service worker — **do not use `playwright-cli open`**
   for local prototype files, as it bypasses the preview service worker
   and produces a FILE NOT FOUND error. Skip in pipeline-automation mode.
2. Mark the page `prototyped` in `state.json` — **gated on the
   Phase 2.5 critique + Phase 2.6 audit + Phase 2.7 adapt +
   Phase 2.8 motion validation (when fired) result** (Discipline 9).
   If any of the four returned ≥ 1 P0 or P1 finding (after the
   brand-faithful inversion auto-dismiss) and the user has not
   acknowledged, the page stays `directed` (not `prototyped`);
   surface the findings in the report grouped by source
   (`critique:` / `audit:` / `adapt:` / `motion:`) and recommend
   either fixing the issue or acknowledging explicitly. The
   transition itself does not require *approval* (a separate
   later step) — but it does require all gates to clear, since
   shipping a `prototyped` flag on work that fails P0/P1 on any
   gate misleads downstream consumers (migrate, the dashboard)
   about the prototype's quality.
3. Report the prototype path and stop. Iteration happens via
   chat-driven impeccable commands or direct invocation (see
   § Iteration paths below).

#### Iteration paths

Refinement after the initial render takes one of two forms. They
are not mutually exclusive — a single page can move through both
across its lifetime.

1. **Chat-driven (default).** The user gives a refinement phrase
   in chat — *"make the hero bolder for home"*, *"tighten the
   cup-note grid"*, *"less corporate"*. The agent:
   - Reads the phrase against
     `skills/stardust/reference/intent-dimensions.md` to identify
     which axes it moves.
   - Consults
     `skills/stardust/reference/impeccable-command-map.md` to pick
     the matching impeccable command (often `bolder`, `quieter`,
     `distill`, `typeset`, `colorize`, or `layout`).
   - Shows the resolved plan to the user before executing.
   - Runs the chosen command against `<slug>-proposed.html` (or a
     specific section within it, when the phrase scopes one).
   - Re-validates per Phase 2 (`:root` block, data attributes,
     anti-toolbox audit clean, impeccable hard rules) and updates
     the proposed file's provenance.

2. **Direct impeccable invocation.** The user runs an impeccable
   command directly — `$impeccable bolder
   stardust/prototypes/home-proposed.html`. Stardust isn't in the
   loop; the browser tab reloads whatever's on disk. This is fine
   and documented as a supported escape hatch. (Includes
   `$impeccable live` against the proposed file when the user
   wants in-browser picker iteration — that's an external tool
   they invoke directly; stardust does not drive its poll loop.)

The "open and reasoned" principle from the master skill applies to
path 1: the agent reasons publicly about the phrase before running
any command, and never silently maps a refinement to a fixed
command.

### Phase 5 — Approval (+ fold-back, Part III)

Approval is **explicit**. Stardust does not auto-approve.

The user signals approval by saying **"approve <slug>"** or simply
**"approve"** in the conversation. The agent confirms the slug
before writing state, then proceeds.

On approval:

1. Verify the proposed file's provenance block lists the *current
   active* `direction.md` (defensive check — if the direction changed
   during iteration, the user must re-prototype against the new
   direction first).
2. **Run approval fold-back** per
   `reference/approval-fold-back.md` (Part III of the merged spec).
   When the approved variant is non-A AND `ia-fidelity` is
   `reimagined`, the prototype reads the approved file's
   `_provenance.differentiationFromA[andB]` block plus the brief's
   `compositionDelta`, diffs against the active direction, and
   proposes folding any structural moves. The user picks
   `fold site-wide` (default) / `fold page-local` / `don't fold`.
   Under `ia-fidelity: verbatim` the fold-back is a no-op by
   construction (A1/A2/A3 are surface forks; nothing structural to
   fold). Flags: `--auto-fold` skips the gate; `--no-fold` opts out
   entirely.
3. Mark the page `approved` in `state.json`. Append a
   `{ status: "approved", at: <ts> }` history entry.
4. Clear any `stale` flag on the page.
5. Print:
   ```
   home: approved
     proposed: stardust/prototypes/home-proposed.html
     mobile:   adapted at Phase 2.7 (4 @media rules at 640/768/1024/1280)
     fold-back: page-local (substrate-keyed-zine pattern stays on /beers)

   Next: $stardust migrate home  (write final redesigned static HTML)
   ```

Adapt no longer runs at approval time — it ran at Phase 2.7 as a
pre-`prototyped` gate. The `mobile:` line reports the Phase 2.7
result for review continuity.

If multiple pages are in flight, approval is per-page; the user can
approve some and continue iterating on others.
