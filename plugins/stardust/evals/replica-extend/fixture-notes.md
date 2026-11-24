# Fixture provenance and known limitations

`fixture/` is a replica project after `replica handoff end` on the fixture site
(`../fixture-site/`) with one page delivered, its home page. The capture
`stardust/current/pages/index.json` and `index.html` (and
`assets/favicon.svg`) come from a run of `crawl.mjs --url
http://localhost:8780/ --pages / --max 1 --dynamics`; the full-page screenshot
the record names is not included (180 KB, not read by the scenario). Everything
else — state, ledger, spec, progress files, the foundation and its manifest —
is written by hand in the shapes the skills document; the first pass's
`_crawl-log.json` records `discovery.capSource: "--cap"` (a user-named cap of
1), so the next page is chosen link-first. No delivery target exists.

What the documented commands do on it, run from a copy after `setup.sh` with
Playwright installed:

- `ledger.mjs last replica` → the `handoff end` line; `ledger.mjs replica
  extend start --track x1 --detail "extend-next 1" --strict` exits 0.
- `foundation-freeze.mjs freeze --paths-if-present <the six spec files> --out
  stardust/replica/extend/x1/spec-freeze.json` → `frozen 6 files`;
  `freeze --from stardust/rollout/foundation-freeze.json` → `frozen 3 files`,
  paths `styles/`, `head.html`, `blocks/header/`.
- `crawl.mjs --url http://localhost:8780 --max 1 --link-first --skip-captured
  stardust/state.json --select-only` prints `http://localhost:8780/visit/` and
  writes nothing.
- `crawl.mjs --url http://localhost:8780 --pages http://localhost:8780/visit/
  --dynamics --skip-captured stardust/state.json` captures `visit` only;
  `index.json` and `index.html` are unchanged and the spec check exits 0. The
  crawl rewrites `_crawl-log.json`'s `discovery` (no `capSource` afterwards):
  the order is read before it, into `stardust/replica/extend/order.txt`.

The visit page has a map, opening hours and an address: a run types it
`static` (or `unique`), which has no archetype in `replica/progress.json`, so
the expected decision is Phases 3–4 for that type. A run that types it
`landing` passes `type_split` only if it then routes it to the sibling tier of
`index` consistently.
