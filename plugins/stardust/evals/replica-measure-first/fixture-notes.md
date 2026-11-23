# Fixture provenance and known limitations

`fixture/` is the replica project of `../replica-round-cap/fixture/` at the
end of Phase 2: the crawl output of `extract/scripts/crawl.mjs --url
http://localhost:8780/visit/ --max 1` with its screenshot (the favicon it
names is not kept), the hand-written `state.json` (page `visit` in status
`extracted`), `direction.md` and the empty register. No prototype, no spec,
no gate directory: the run writes them.

What the instruments do on the fixture site (`../fixture-site/`), as run when
the fixture was built:

- `source-spec.mjs capture http://localhost:8780/visit/ --slug visit --widths
  1440,360` exits 0 in about 50 seconds and writes
  `stardust/replica/spec/visit-1440.json`, `visit-360.json` and the two
  header and footer inventories.
- `source-spec.mjs compare <spec> http://localhost:8780/visit/` (the page
  against itself) exits 0 at both widths: `0 section(s) with a height delta,
  total offset 0px, 0 node(s) off, 0 missing, 0 extra`. The band the server
  repaints does not move a box.
- The same compare against a re-authored prototype whose opening-hours cells
  have 8 px of padding where the source has 12 px exits 2 and names the three
  rows (`total offset 24px, 6 node(s) off`): the defect a first gate round
  would otherwise spend a round on.

The page is small on purpose (a header, one section with a table, an image
and a band, a footer), but authoring it, clearing compare at two widths and
running two rounds is more than the default budget of `scripts/skill-eval.mjs`
(30 turns, 600 seconds): give it `--max-turns 80 --timeout 1800`. The run
installs the gate's dependencies and Chromium itself (the skill's Setup,
step 2). No run of an agent on this scenario was made when it was written.

`setup.sh` starts the fixture site and copies the plugin's scripts in both
runs of a comparison. The site's source files stay in the checkout and are
not in the work directory; `stardust/current/pages/visit.html`, the rendered
DOM, is, as in every replica run. The system fonts the site names (Georgia,
Helvetica) resolve to what the machine has, the same on both sides of a
comparison.
