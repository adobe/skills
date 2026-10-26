# The deployed leg — a reskin page on its aem.page preview

Phase 5 (e), any donor: what `deploy` made of the page, held to the local reskin page and the donor on
`https://<branch>--<repo>--<org>.aem.page`. It never publishes to aem.live. Bars: `gates.md` § (e). Command lines:
SKILL.md Phase 5 (e). Flags, evidence and exit codes: `deployed-gate.mjs --help`.

## When it runs

Only in an aem-boilerplate project: `stardust/runtime-contract.json` (`deploy`'s runtime probe), `head.html` and
`scripts/aem.js` at the repo root. Otherwise `deployed-gate preview` records a skip, exit 0, and every later step is
`not run: skipped`. It also needs a GitHub push right, a DA token for
`deploy-batch` (`da-auth`) and a branch whose host label `<branch>--<repo>--<org>` is at most 63 characters.

## Isolation

Code is branch-scoped; DA content is not: a `PUT` has no branch, so a branch preview that writes `/nav` rewrites it
for every branch. Either **`--sandbox`**, a repo of one's own (the safest; waives the rules below, recorded), or
**`--namespace <ns>`** in a shared repo: every path the leg writes starts with `/<ns>/` (the page, `/<ns>/nav`,
`/<ns>/footer`, DA media under `--scope <ns>`), the page's `metadata` block carries `nav` and `footer` rows naming
`/<ns>/nav` and `/<ns>/footer`, and both chrome documents are on the publish roster or the chrome 404s. `preview` enforces
the rows (read from the delivered head) and the path: rules in `deployed-gate.mjs --help`. One new page path in the
site's own repo on its existing chrome (`nav`/`footer` left at `/nav`, `/footer`, no chrome document written) is
`--sandbox`: `--namespace` refuses it for want of the `/<ns>/` path and rows. `--sandbox` waives those checks
(recorded in `preview.json`), so make sure the path is new.

## Recipe

1. **Deploy, preview-only.** `deploy` Steps 1–9 with `stardust/reskin/pages/<slug>.html` (the page Phase 5 gated) as
   the prototype: the content page `content/<ns>/<slug>.html`, in a shared repo both chrome documents, and
   `eds-schema/<slug>.json` (Step 2b, `qa-gate`'s input). The content page is `deploy`'s own conversion of that page's
   `<main>`, no custom converter: one block per `section[data-slot]` in page order, named for its `mapping.json`
   module — `blocks.<module id>`, else the id lower-cased (`mapping-json.md` § `blocks`); a slot with no module is
   default content. What still differs from the source is declared in the delta file. This leg replaces only
   Step 10's automated reconciliation, the reskin page its reference (step 7 keeps the rest).
   `block-roundtrip`'s default `--map` (`section.<name>`, `[data-section]`, `.<name>`) cannot pair a reskin page
   (`.cards` matches the inner grids, `.tabs` the tab row); pass the arguments
   `node stardust/scripts/reskin/stream-render.mjs <slug> --deploy-map` prints — one
   `--map '<block>=section[data-slot="sNN"],…'` per block, its instances in page order. It compares CTA text by
   `textContent`: a block that moves children into wrappers keeps a whitespace text node between them.
   **A design change found in review** (the eyeball, a gate, the preview) is made in `mapping.json` or
   `donor-tokens.json`, then the page re-rendered (`stream-render --register`), re-gated (Phase 5, `reskin-ledger
   record`) and re-deployed — never in the EDS blocks or CSS alone: the reskin page is the reference every sibling
   renders from, and `reskin-preflight` fails deployed evidence whose `codeStamp` no longer matches the code. A
   block or CSS fix that makes EDS match the unchanged reskin page is a fix round (§ The fix budget).
2. **Push the branch, force Code Sync** and poll until an edited block file is served
   (`../../deploy/da-deploy-protocol.md` § Deploy, step 0).
3. **Write the documents to DA and preview them, never publish:**
   `DA_TOKEN=… node skills/deploy/scripts/deploy-batch.mjs --org <o> --repo <r> --branch <b> --content content --paths <paths.txt> --no-publish --force --ledger stardust/.work/reskin/deploy-ledger.json`.
   `<paths.txt>` is a file, one web path per line (the page and both namespaced chrome documents; in a sandbox the
   page), each without extension, like `/<ns>/<slug>`; `--force` because a page already live is skipped; the
   dedicated ledger keeps the run apart from `content/.deploy-ledger.json`. Exit 3 is a token halt: refresh the
   token, re-run the same command; never a FAIL.
4. **`deployed-gate preview`** polls until the preview answers, checks isolation and writes `preview.json`.
5. **The delta file.** Run `deployed-gate content` with none, then write `reskin/deltas/<slug>.json` from what fails,
   one entry per real difference with its why, starting with `"blocking": false`: the text check stays advisory until
   the page's differences are measured.
6. **`deployed-gate all` under `run-bg`;** copy `summary.json`'s `ledgerFragment` into the ledger.
7. **Step 10's deployed checks stay mandatory before handoff**, run as `deploy` specifies, not re-built here: the
   desktop and mobile eyeball, the delayed-font/nav CLS probe (CLS < 0.1; `deployed-gate` and `qa-gate` measure settled
   pages) and the applicable header-behavior checks. Record each result, or `unresolved: <why>`, under `gates.step10`
   (§ The ledger).

The preview must be reachable without auth: a protected preview is out of scope. `preview` stops with exit 2 on a
401 or 403 rather than poll, and the gates send no Authorization header. A sandbox repo's preview is public by
default.

## The delta file

`reskin/deltas/<slug>.json` (tracked): the page's declared source → preview differences (`mapping.md`'s Deltas block
declares source → local render changes: `mapping-brief.md` § Deltas block), read by `dom-equality` and
`slot-coverage` through `--deltas`. An invalid file or an unknown key is exit 2, every problem listed.

```json
{
  "version": 1,
  "blocking": false,
  "text": { "allow": [ { "id": "t1", "from": "Contact us", "to": "Contact", "why": "deploy retitled the CTA" } ] },
  "images": "count+alt+width",
  "links": { "localize": { "sourceHost": "src.test" } },
  "metadata": { "ignore": ["canonical", "og:url"], "jsonLd": "count-only", "absent": [] }
}
```

- `version`: required, `1`; any other value, or none, is an invalid file.
- `blocking`: `false` makes a failed check advisory (exit 0, `ADVISORY`); left out it is `true`, as with no file.
- `text.allow`: `id` (unique), `from` and `why` required, `to` defaults to `""`. Each entry replaces its literal
  `from` on the source side (slot text and CTA text), in file order, every occurrence. Only these entries carry a
  `why`: record the why of an `images`, `metadata` or `jsonLd` choice in the page's ledger `residuals[]` (`detail`,
  verdict `accepted`).
- `images`: `"count+alt+width"`, the only mode, replaces the host+path comparison: same count, same alt in order,
  every rendered width above 0. `slot-coverage` attributes images to slots positionally by cumulative count, so an
  image moved across a slot boundary with the order kept, or replaced by one with the same alt, goes undetected; its
  `images total` check counts every visible image in scope, so an image the delivered page adds fails it, and the
  schema cannot declare one.
- `links.localize.sourceHost`: a bare host; a CTA's href also matches as `deploy` localizes it onto the preview origin.
- `metadata`: `ignore` keys (`title`, `description`, `canonical`, `og:…`, `twitter:…`) skip their check, `absent` keys
  must not be carried, `jsonLd` is `"count-only"` (the default: the block count) or `"ignore"`.

Applied entries are reported (a "Declared deltas" section, a `deltas applied:` line); one that matched nothing is
`WARNING unused delta <id>`: stale or aimed at the wrong string, fix or remove it.

## The ledger

`pages.<slug>.gates.deployed`, copied from `summary.json`'s `ledgerFragment`:

```json
{ "regime": "preview", "url": "<preview url>", "content": "PASS", "tokens": "PASS", "parity": "FAIL 1/8",
  "sanity": { "verdict": "PASS", "hard": true }, "inherited": "PASS", "figma": { "regime": "preview" },
  "codeStamp": "<16 hex>", "invocation": "deployed-gate.mjs all --page <slug> …" }
```

`codeStamp` hashes the project's `blocks/`, `styles/`, `scripts/` and `head.html` as the run starts. Before handoff,
`deployed-gate stamp --page <slug>` prints `current`, or `stale: summary <a>, now <b>` (exit 1): a block or CSS change
after review invalidates the evidence, so re-run the leg (step 6).

The test hook `DEPLOY_VERIFY_ORIGIN` is recorded as `originOverride: { env, origin }` in `preview.json`, `summary.json` and
the fragment.

Step 7's results go beside the fragment, in `pages.<slug>.gates.step10`, e.g.
`{ "eyeball": "adopted", "cls": "0.04", "header": "n/a: no header contract" }`; a check not run is
`unresolved: <why>` and a `residuals[]` entry (`needs-owner`).

A value is `PASS`, `PASS (n/a: <checks>)` (passed, those checks not measured; the reasons are in `summary.json`'s
`steps.<step>.detail`), `FAIL k/n`, `FAIL stalled decoration: <what>` (a gate stalled on the preview's decoration and
measured nothing: the step fails and the run goes on, `sanity` records its own hard decoration FAIL),
`ADVISORY <gates> (deltas.blocking false)`, `not run: <why>` or
`ERROR (exit N): <why>`; `figma` is figma-gate's own fragment, or one of those (`not run: no figma checks`).
`invocation` is the exact argument list. A residual's `class` is
`deployed.content`, `.tokens`, `.parity`, `.sanity` or `.inherited` (M2b's are `figma.*`); a `deployed.sanity`
residual is never `accepted`.

## The fix budget

One reconcile round per family on the preview: content (`content`, `inherited`), design (`tokens`, `parity`,
`sanity`), Figma fidelity. A round costs a push, a Code Sync, a re-preview and a propagation poll, so a fix re-runs
only what it can move; what still fails afterwards is logged as a residual.

| Fix | Re-run |
|---|---|
| CSS or block | push, Code Sync, then `parity`, `tokens`, `sanity`, `figma` |
| content page | `deploy-batch`, then `content`, `inherited`, `figma` |

Each step is `deployed-gate <step> --page <slug>`; `figma` is `node stardust/scripts/reskin/figma-gate.mjs all --page <slug> --url <preview url>
--target preview --reskin stardust/reskin/pages/<slug>.html`, where
`<preview url>` is `preview.json`'s `url` (it needs `figma-checks/<slug>.json`; `deployed-gate all` runs it too).

The matrix is for iterating: close each round with one `deployed-gate all` (step 6); a single step's verdict is never what
the ledger records.
A fix counts only once served: `curl --compressed <css url> | grep <marker>` finds it on the preview. A run with no
verdict (exit 124, or an instrument that did not run) does not count: re-run once; the same 124 twice is a
`needs-owner` residual; exit 3 is neither a FAIL nor an iteration.

## Defaults

- **Fonts.** A Figma donor supplies no font files, so nothing is metric-matched: `<brand>-fallback` is the token's
  second family at `size-adjust: 100%`, unless the user supplies files (`deploy`'s own rule). `tokens` asserts every
  `:root` token verbatim, so `--body-font-family` / `--heading-font-family` stay the token string and the rendered stack
  (`"<Brand>", "<brand>-fallback", <generic>`) goes in its own property, e.g. `--font-stack`. "Font not served" is a
  declared difference, never a failure: `tokens` compares the first family, the Figma pixel check records `served: false`.
