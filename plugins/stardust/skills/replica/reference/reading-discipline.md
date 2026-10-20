# Reading and inspection discipline — the context is the budget

Read from the replica card (`../SKILL.md § Setup`) when a step is about to
read a file, a capture or an instrument's output, or to change a tracked file.

Everything a step prints stays in the context and is re-read on every later
model call: one recorded session carried 750k characters of tool output into
a 535k-token context; one call for five reference sections returned 82 KB
that stayed for 160 turns. Each instrument below prints the part that
matters, capped, and says what it left out. Measure with them, never with
an image library or an evaluate you wrote: a hand-rolled number is not
reproducible by the next session or the gate.

| I want to … | Use |
|---|---|
| change text in a tracked file | the edit tool, or `replace.mjs <file…> --from <old> --to <new> [--regex] [--all\|--count <n>]` — literal by default, exactly one match per file unless `--all` (≥ 1) or `--count <n>`; a missed count refuses and writes nothing; atomic |
| change a JSON value | `json-edit.mjs <file> set\|merge\|append\|delete <path> [<value>]` (value: JSON, else text; `a."b.c"` is one key; `--create` for a new file); a progress ledger: `progress.mjs unit …`; page status: `state.mjs` — `replace.mjs` and `json-edit.mjs` refuse a file that has its own writer |
| read JSON | `json-query.mjs <file>` for the shape, `--path <p> --keys` for an array's fields, `--match <k>=<re> --fields <a,b> --max 40` for a bounded table; a value that feeds a command from `--tsv` or `--path <record>.<field>`, never the table (its cells are capped) |
| read a reference doc | `section.mjs <doc> --list`, then `section.mjs <doc> '<heading>'` — one section per call, never the whole file |
| read captured CSS or HTML | `css-rules.mjs <sheet> '<selector re>' [--media <re>]`; `html-slice.mjs <page.html> header\|footer\|main\|.class [--text]` |
| where an element sits, a DOM skeleton or text outline, for one or two documents | `dom-probe.mjs <url\|file> [--selector <css>] [--compare <url\|file>]` |
| computed values, live against prototype, per width | `measure.mjs <live-url> --against <prototype-url> --selectors "<css>,…" [--width 1440,360]` (Phase 3) |
| look at a screenshot or a gate image's failing band | `inspect-image.mjs <png> --y <top> --height <h>` |
| how far two captures differ, and where | the gate's lines; `pixel-compare.mjs`, `crop-compare.mjs` bands |
| any other look at a page: click, evaluate, screenshot | `page-probe.mjs <url>` — for looking, never gate evidence |
| wait for a background job | `run-bg.mjs wait` (bounded), then `log <job> --grep <re>`; never `cat` a log or a capture |
| what a script is for, and its flags | `../stardust/reference/scripts-index.md` for the purpose, `--help` for the flags; never the source |

**An inline interpreter may read and print; it never writes a tracked file.**
Four recorded runs wrote ~150 python programs that read a tracked HTML or
CSS file, replaced a string and wrote it back, and 18 that edited JSON
ledgers in place; the earlier rule "edit tool, not an interpreter" alone did
not change that (the edit tool ran 1–18 times per run). `replace.mjs`
handles several occurrences, files and a regex in one call and counts
before it writes.

- **Images**: one crop per fact — never a stitched page (downscaled past
  legibility) or the live/build/diff triplet; the diff crop of the first
  hot band (`crop-compare.mjs`) is the one image a round needs — look only
  at capped copies (those JPEGs, an `inspect-image.mjs` band). Step 10's
  eyeball of the deployed page is the published
  `gate.sh --full` round plus header/footer `crop-compare.mjs` bands (gate
  doc § Pass bar, item 5). The one exception: the brand-gestalt read at
  extract, the whole page per archetype through `thumb.mjs`
  (`skills/extract/scripts/thumb.mjs`), never the raw capture.
- **Phase 5 briefs** name their read-set (`reference/handoff-contract.md`
  § 3. Rollout) — sections only, never a whole SKILL.md or a full-page PNG.
- Write anything you will need again to a file under `stardust/` (a lifted
  value table, a section map) and read it back by query, not the
  instrument's output by scroll.
