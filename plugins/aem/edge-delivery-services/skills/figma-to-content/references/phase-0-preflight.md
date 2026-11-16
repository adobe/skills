# figma-to-content: phase 0, preflight

The text of this part of `SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

## Phase 0 — Preflight (fail fast, before any read or write)

Verify the run can actually complete **before** reading the design or writing to
DA — a missing prerequisite caught here is one actionable message; caught mid-run
it is a confusing, half-built page. Run these checks in order and, on the first
that fails, **stop with the specific remediation below** — do not proceed on a
guess or a partial capability.

1. **Figma MCP reachable.** Confirm a Figma MCP is connected and responds via a
   cheap call (e.g. `whoami`, or listing its tools). If **no Figma MCP tool is
   available at all**, stop: *"No Figma MCP is connected. Connect one (Claude
   desktop Dev Mode, an IDE Figma integration, or a remote Figma MCP) and
   re-run."* Record the authenticated identity (`whoami`) for the next check.
2. **Access to the specific file.** Make one lightweight call against the target
   `fileKey` (e.g. `get_metadata` scoped to the frame, or `get_design_context`
   on the node). A **permission / not-found** error (`403`/`404`/"no access")
   means the file is not shared with the authenticated account → stop: *"Figma
   reports no access to `<fileKey>` as `<whoami>`. Share the file with that
   account, switch accounts, or provide a file you can open."* **Distinguish this
   from a transport cap** — a truncated, garbled, or JSON-parse-error response is
   the size cap (see Phase 1), **not** an access failure: retry narrower, do not
   report it as no access.
3. **DA write path available.** Confirm a `DA_TOKEN` is obtainable via **da-auth**
   — prefer the `$DA_TOKEN` it exports into the session, else its cache at
   `~/.aem/da-token.json`, else freshly minted. **If the cache exists but can't be
   read because this execution sandbox has no `$HOME` access**, the token is not
   missing — it is *unreachable*; do **not** loop re-minting. Stop with that
   distinction spelled out: *"A DA token exists but this sandbox can't read
   `~/.aem/da-token.json` — run where the cache is readable, or provide the token
   as `$DA_TOKEN` (or a readable path)."* If no token can be obtained at all,
   stop: *"Can't obtain a DA token (da-auth) — authenticate to DA and re-run."*
   Either way, don't spend a full Figma read only to fail at the deploy step.
4. **Project checkout + orchestrated skills present.** The target repo is checked
   out locally (needed to see `blocks/` and to add new-block code) and the skills
   this one orchestrates (**da-auth**, **da-content**, the block skills) are
   available. If the checkout path is unknown, ask for it.

On all-pass, print a one-line preflight summary — Figma identity, the file/frame,
and the DA `org/repo` + `branch` you will write to — then proceed to Phase 1.
