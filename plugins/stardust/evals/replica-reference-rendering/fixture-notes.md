# Fixture provenance and known limitations

`fixture/` is a replica project of the fixture site's board page
(`../fixture-site/site/board/`) at the start of Phase 4: the crawl output of
`extract/scripts/crawl.mjs --url http://localhost:8780/board/ --max 1`
(without its screenshot and favicon), the 1440 source spec of
`source-spec.mjs capture http://localhost:8780/board/ --slug board --widths
1440` (its header and footer inventory not kept), the hand-written
`state.json` (page `board` in status `prototyped`), `direction.md`, the empty
register, and a re-authored prototype. No `stardust/replica/gates/`.

The board is scroll-jacked: `html` and `body` clip, and a script moves the
content on wheel, keys and touch, so `window.scrollTo` is a no-op while the
document reports 1925 px. The page links its static page mode for screen
readers, `/board/?page-mode=static`: the same items as a table in normal flow,
another layout (a 40 px heading instead of 56 px, a table instead of tiles,
1728 px tall). The crawl's full-page screenshot of the board stops after the
first viewport.

What the instruments do on the fixture site, as run when the fixture was
built (Playwright 1.65, macOS):

- `source-spec.mjs compare stardust/replica/spec/board-1440.json
  <prototype>` exits 0 (`0 section(s) with a height delta, total offset 0px,
  0 node(s) off`), and content-diff and visual-diff of the prototype against
  `http://localhost:8780/board/` at 1440 report no finding: the prototype is
  not what the scenario is about.
- `gate.sh board http://localhost:8780/board/ <prototype> 1440 iter1` starts
  to freeze the reference; the priming capture stalls twice (`stitch-shot
  error: scroll stall at chunk target 900px: window scroll is a no-op …`) and
  the round ends with exit 1, no verdict, not counted. About 20 seconds.
- `gate.sh board "http://localhost:8780/board/?page-mode=static" <prototype>
  1440 iter2` ends with exit 7 before anything is captured: `gate.sh:
  reference: REFUSED for board: … query page-mode=static added`. With the
  gate.sh of before the reference check, the same round froze the static
  rendering and gave a verdict (FAIL, aligned 14.58 %, offsets 197 px): a
  number against a page visitors never see.

`setup.sh` starts the fixture site and copies the plugin's scripts in both
runs of a comparison. The run installs the gate's dependencies and Chromium
itself (the skill's Setup, step 2): about two minutes, and it needs the npm
registry and the browser download. No run of an agent on this scenario was
made when it was written.
