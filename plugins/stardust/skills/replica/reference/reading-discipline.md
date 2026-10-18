# Reading and inspection discipline — the context is the budget

Read from the replica card (`../SKILL.md § Setup`) when a step is about to
read a file, a capture or an instrument's output.

Everything a step prints stays in the agent's context for the rest of the
session and is re-read on every model call. Recorded in one hands-off
session (2026-09-18, 77 minutes): 172 steps carried 750k characters of tool
output into a 535k-token context; three whole reference documents `cat`ed
at once overflowed and were then read again in full (157k characters for
text paid for twice); 21 ad-hoc `node -e` dumps of capture JSON cost 141k,
`sed -n` line ranges of a pretty-printed stylesheet 102k. The helpers below
print the part that matters, capped, and say what they left out:

- **Reference docs**: `node stardust/scripts/replica/section.mjs <doc> --list`
  for the outline, then `section.mjs <doc> '<heading>'` for the one section
  the current step needs — never the whole file (a heading the pattern
  misses is retried by its words; a total miss prints the outline on stdout,
  exit 2). **One section per call**:
  a recorded call for five sections returned 82 KB that stayed in context
  for 160 turns (`--all` over several sections is capped at 20 KB now).
- **Phase 5 briefs**: a cluster or archetype brief names its read-set
  (`reference/handoff-contract.md` § 3. Rollout; its Brief read-set bullet)
  — sections only, never a whole SKILL.md or a full-page PNG.
- **Captured CSS**: `css-rules.mjs <sheet> '<selector regex>' [--media <re>]
  [--decl <re>]` — the rule blocks, each with its media condition, instead
  of line ranges of the sheet.
- **Capture JSON** (computed styles, content trees, motion checks, crawl
  logs — their shape is the run's own): `json-query.mjs <file>` for the
  shape, `--path <p> --keys` to learn an array's fields, then `--path <p>
  --match <key>=<re> --fields <a,b> --max 40` for a bounded table; values
  that feed a command (URLs, slugs, selectors) come from `--tsv` or
  `--path <record>.<field>`, never from the table — its cells are capped.
- **Captured HTML**: `html-slice.mjs <page.html> header|footer|main|.class
  [--text]` — one element, attributes stripped to the structural few,
  scripts and inline SVG removed, capped.
- **Instrument output**: never `cat` a log or a capture; gate rounds run
  through `run-bg.mjs` (Phase 4) and are read back with `wait` summaries
  and `log --grep`.
- **Questions → instruments.** The recorded runs wrote 16–40 screenshot
  inspections, box probes and DOM-skeleton dumps each, 40 of them pixel
  measures in an image library; each question below has one shipped call,
  capped. Measure with these, never with an image library or an evaluate you
  wrote: a hand-rolled number is not reproducible by the next session or the gate.

  | Question | Instrument |
  |---|---|
  | where an element sits and how big (x/y/w/h, display, position); a section's DOM skeleton or text outline; both for two documents | `dom-probe.mjs <url\|file> [--selector <css>] [--width <px>] [--compare <url\|file>]` |
  | computed values of a few selectors, live against prototype, per width | `measure.mjs <live-url> --against <prototype-url> --selectors "<css>,…" [--width 1440,360]` (Phase 3) |
  | what a gate image shows in its failing band | `inspect-image.mjs <png> --y <top> --height <h>` |
  | how far two captures differ, and where | the gate's lines: `pixel-compare.mjs`, `crop-compare.mjs` bands |
  | any other look: click, evaluate, screenshot | `page-probe.mjs <url> [--hide <sel>] [--click <sel>] [--eval <expr>] [--shot <png>]`, `--sbs <a> <b> <out>` — the gate's navigation and consent handling, capped JPEGs; for looking, never gate evidence |
- **Editing a tracked file** is the edit/write tool's job, never an
  interpreter's: an inline `python3`, `node -e` or heredoc script may read and
  print, never rewrite a tracked file (recorded: 56–120 such whole-file
  rewrites of CSS and JS per run, none reviewable as a change). A mechanical
  change over many files is one edit per file or a shipped script.
- **Images**: one crop per fact, never a full stitched page (it is
  downscaled past legibility and costs a step), never the live/build/diff
  triplet — the diff crop of the first hot band (`crop-compare.mjs`) is the
  one image a round needs. Recorded: 21 image reads in one run, most of
  them full pages or triplets, for facts the verdict lines already held.
  Look only at capped copies: `crop-compare.mjs` JPEGs, or an
  `inspect-image.mjs` band (table above) — never a whole page.
  Step 10's eyeball of the DEPLOYED page is the published `gate.sh --full`
  round plus header/footer `crop-compare.mjs` bands (gate doc § Pass bar,
  item 5), not a full-page image.
  The one exception is the brand-gestalt read at extract, which uses the
  shipped `thumb.mjs` (`skills/extract/scripts/thumb.mjs`, box-filtered to
  480 px or narrower under its size cap; a line with a crop share below
  100 is followed by its `--offset` slice) — the whole page per archetype,
  never the raw capture.
- **Script flags**: every shipped CLI script answers `--help` (and `-h`) with
  its usage header — flags, exit codes, a `Writes:` block — before it touches
  anything; the full invocation shape per deploy and rollout script is the
  Phase 5 card's usage table (`reference/handoff-contract.md` § 4). Never
  `sed`/`head`/`grep` a script's source to learn its flags (16 such reads in
  one recorded session). **Index first:** `../stardust/reference/scripts-index.md`
  has every shipped script on one line (what, key flags) — ask `--help` only for
  a flag it does not name (a recorded run asked `--help` 78 times).

Write anything you will need again to a file under `stardust/` (a lifted
value table, a section map) and read the file back by query, not the
instrument's output by scroll.
