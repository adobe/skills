# Skill Contract

Every stardust skill declares three things in a `## Contract` section:

- **Needs** — upstream artifacts the skill reads *if present*. Never required.
- **Produces** — the single artifact (or folder) the user will edit directly after.
- **If missing** — what the skill synthesizes when a Need is absent, plus where provenance is recorded.

## Provenance

When a skill synthesizes any input, it stamps a provenance block at the top of
the produced artifact. No separate log file.

### HTML artifacts

```html
<!-- stardust:provenance
  generated_by: design
  date: 2026-04-13
  synthesized_inputs:
    - brand-profile.json (missing — neutral defaults used)
    - briefings/home.md #Copy (missing — copy generated on-brand)
  note: these values are placeholders. Edit the artifact or re-run the upstream skill to replace them.
-->
```

Place as the first child of `<head>`.

### Markdown artifacts

```markdown
<!-- stardust:provenance
  generated_by: briefings
  date: 2026-04-13
  synthesized_inputs:
    - user prompt: "landing page for the product launch"
  note: structured from a one-line prompt. Edit freely.
-->
```

Place as the first line of the file, above frontmatter.

### JSON artifacts

A `"_provenance"` key at the top of the object:

```json
{
  "_provenance": {
    "generated_by": "brand",
    "date": "2026-04-13",
    "synthesized_inputs": ["user conversation (no URL or PDF supplied)"],
    "note": "neutral defaults used. Replace by re-running /stardust:brand with a URL or PDF."
  },
  "name": "Untitled"
}
```

## Writeback

Skills never automatically write to upstream artifacts. If the user asks
("also save this headline to the briefing"), the skill performs a single,
targeted writeback and reports what it changed. That is the only
cross-artifact write allowed.

## One artifact per skill

A new skill is justified only if its artifact earns its own iteration loop.
If an output is edited jointly with another artifact or never edited on its
own, fold it into an existing skill instead of creating a new one.

## Opening HTML artifacts

Every HTML artifact a stardust skill produces — the brand board, the
palette pick UI, wireframes, prototypes — **must be opened in the
designer's default browser immediately after it's written**. No "tell
the designer to open the file" step — the skill opens it.

### Invocation

Run the platform-appropriate open command via Bash immediately after
the `Write` tool call succeeds:

- **macOS** (`darwin`): `open "<absolute-path-to-file>"`
- **Linux**: `xdg-open "<absolute-path-to-file>" &`
- **Windows**: `start "" "<absolute-path-to-file>"`

The skill detects the platform from its environment (e.g. `Platform:
darwin` in the system prompt) and picks the matching command. If the
platform is unknown, try `open` first, then `xdg-open` on failure.

### When to open

Open immediately after the file is written, not at the end of the
phase. Every fresh HTML artifact triggers one open. Re-writes during
iteration (same file, new content) re-open the file so the browser
refreshes. If the browser auto-reloads on file change, one open is
enough — rely on the user's default behaviour.

### Artifact scope

These are the HTML artifacts currently in scope:

- `stardust/brand-board.html` — emitted by `brand` Phase 4
- `stardust/_palette-pick.html` — emitted by `brand` Phase 2 Step D
- `stardust/wireframes/<page>.html` — emitted by `wireframes`
- `stardust/prototypes/<page>.html` (single-variant) or
  `stardust/prototypes/<page>-<letter>.html` (multi-variant) — emitted
  by `prototype`

For multi-variant prototype mode, **open all variants at once** so the
designer can tab between them.

### Exceptions

- In **pipeline-automation mode** (end-to-end auto-approve run where
  the designer is not present), skip the open — nobody's there to
  look. Write the file, skip `open`, continue.
- If Bash is unavailable in the current environment, fall back to
  telling the designer the file path and recommending `open <path>`.
