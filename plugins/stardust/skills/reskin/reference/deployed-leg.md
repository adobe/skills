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

1. **Deploy, preview-only.** `deploy` Steps 1–9 with `stardust/reskin/pages/<slug>.html` as the prototype: the content
   page `content/<ns>/<slug>.html`, in a shared repo both chrome documents, and `eds-schema/<slug>.json` (Step 2b,
   `qa-gate`'s input). `deploy` authors the content page (Step 9); generating it from the model is not built, so
   its differences are declared in the delta file. This leg replaces only Step 10's automated reconciliation, the
   reskin page its reference (step 7 keeps the rest).
   `block-roundtrip`'s default `--map` (`section.<name>`, `[data-section]`, `.<name>`) cannot pair a reskin page:
   `.cards` matches the inner grids, `.tabs` the tab row. Give one `--map <block>=section[data-slot=sNN][,section[data-slot=sMM]…]`
   per block (Phase 4's `data-slot`, a class is not general), the instances in page order. It compares CTA text by
   `textContent`: a block that moves children into wrappers keeps a whitespace text node between them.
2. **Push the branch, force Code Sync** and poll until an edited block file is served
   (`../../deploy/da-deploy-protocol.md` § Deploy, step 0).
3. **Write the documents to DA and preview them, never publish:**
   `DA_TOKEN=… node skills/deploy/scripts/deploy-batch.mjs --org <o> --repo <r> --branch <b> --content content --paths <paths.txt> --no-publish --force --ledger stardust/.work/reskin/deploy-ledger.json`.
   `<paths.txt>` is a file, one web path per line (the page and both namespaced chrome documents; in a sandbox the
   page), each without extension, like `/<ns>/<slug>`; `--force` because a page already live is skipped; the
   dedicated ledger keeps the run apart from `content/.deploy-ledger.json`. Exit 3 is a token halt: refresh the
   token, re-run the same command; never a FAIL. On a protected preview add `--site-token-env <NAME>`: the delivered
   check reads `.plain.html` from the preview (`--token-env` names the DA token).
4. **`deployed-gate preview`** polls until the preview answers, checks isolation and writes `preview.json`.
5. **The delta file.** Run `deployed-gate content` with none, then write `reskin/deltas/<slug>.json` from what fails,
   one entry per real difference with its why, starting with `"blocking": false`: the text check stays advisory until
   the page's differences are measured. A Figma-only page starts from the file `figma-donor.mjs content` seeded
   (`metadata.absent`); its `content` step runs `figma-text-gate` in place of `dom-equality` (no live source),
   with `text-ops.json` beside the model. On the preview EDS may emit a description or canonical the design has
   none of: move such a key from `metadata.absent` to `metadata.ignore`, with the why in `mapping.md`.
6. **`deployed-gate all` under `run-bg`;** copy `summary.json`'s `ledgerFragment` into the ledger. On a protected preview
   give the command `--token-env <NAME>`, never `--auth-header` (`run-bg` saves and prints its command).
   Then **gate (a′) on the preview**: `source-coverage.mjs --model … --target <preview-url> --declared
   stardust/reskin/coverage/<slug>.json` (`gates.md` § (a′)). A breadcrumb or section sidebar that EDS builds as page
   chrome, or a feed block that renders client-side, exists only here; the local page cannot prove it.
7. **Step 10's deployed checks stay mandatory before handoff**, run as `deploy` specifies, not re-built here: the
   desktop and mobile eyeball, the delayed-font/nav CLS probe (CLS < 0.1; `deployed-gate` and `qa-gate` measure settled
   pages) and the header-behavior checks `chrome` (A6) does not cover. Record each result, or `unresolved: <why>`, under
   `gates.step10` (§ The ledger). An eyeball `pass` is refused while `deployed.chrome` fails.

A preview is protected when it refuses the first request `preview` makes, which carries no token (`preview.json`
`auth: true`). It takes `--auth-header "<value>"` or `--token-env <NAME>` on every step (a value starting with neither
`token ` nor `bearer ` gets `token ` put in front). Without one `preview` stops with exit 2 rather than poll, and every
later step does before it measures anything; a token it refuses (401 or 403 once sent) is exit 2 too, not a poll to 124.
The token goes to the preview
origin only (not a font or image host, not the local reskin page), to child processes by environment (`--token-env`,
`--auth-origin` the preview) and never argv, output, records or the ledger; a public preview is sent none
(`tokenUnused: true` when one was offered). The token never crosses a redirect: one inside the preview's origin fails
(measure the final URL), one to another origin is followed without it. A sandbox repo's preview is public by
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
  "sanity": { "verdict": "PASS", "hard": true }, "inherited": "PASS", "chrome": { "verdict": "PASS", "hard": true },
  "figma": { "regime": "preview" },
  "invocation": "deployed-gate.mjs all --page <slug> …" }
```

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
`invocation` is the exact argument list, `--auth-header`'s value `[redacted]` (`--token-env`'s is a variable name, kept). A residual's `class` is
`deployed.content`, `.tokens`, `.parity`, `.sanity`, `.inherited` or `.chrome` (M2b's are `figma.*`); a
`deployed.sanity` or `deployed.chrome` residual is never `accepted`, and a header or footer one (`step10.header`, …)
only with `--by <owner>`, never an agent's name (`reskin-ledger.mjs` refuses; a hands-off run records `needs-owner`).

## The fix budget

One reconcile round per family on the preview: content (`content`, `inherited`), design (`tokens`, `parity`,
`sanity`, `chrome`), Figma fidelity. A round costs a push, a Code Sync, a re-preview and a propagation poll, so a fix re-runs
only what it can move; what still fails afterwards is logged as a residual.

| Fix | Re-run |
|---|---|
| CSS or block | push, Code Sync, then `parity`, `tokens`, `sanity`, `chrome`, `figma` |
| content page | `deploy-batch`, then `content`, `inherited`, `figma` |

Each step is `deployed-gate <step> --page <slug>`; `figma` is `node stardust/scripts/reskin/figma-gate.mjs all --page <slug> --url <preview url>
--target preview --reskin stardust/reskin/pages/<slug>.html [--auth-header "<value>" | --token-env <NAME>]`, where
`<preview url>` is `preview.json`'s `url` (it needs `figma-checks/<slug>.json`; `deployed-gate all` runs it too).

The matrix is for iterating: close each round with one `deployed-gate all` (step 6); a single step's verdict is never what
the ledger records.
A fix counts only once served: `curl --compressed <css url> | grep <marker>` finds it on the preview; on a protected
one, with the token out of argv (bash, curl ≥ 7.55; `printf` is a builtin, so no process's argv holds the value):
`curl --compressed -H @<(printf 'Authorization: token %s\n' "$SITE_TOKEN") <css url> | grep <marker>`. A run with no
verdict (exit 124, or an instrument that did not run) does not count: re-run once; the same 124 twice is a
`needs-owner` residual; exit 3 is neither a FAIL nor an iteration.

## Defaults

- **Fonts.** A Figma donor supplies no font files, so nothing is metric-matched: `<brand>-fallback` is the token's
  second family at `size-adjust: 100%`, unless the user supplies files (`deploy`'s own rule). `tokens` asserts every
  `:root` token verbatim, so `--body-font-family` / `--heading-font-family` stay the token string and the rendered stack
  (`"<Brand>", "<brand>-fallback", <generic>`) goes in its own property, e.g. `--font-stack`. "Font not served" is a
  declared difference, never a failure: `tokens` compares the first family, the Figma pixel check records `served: false`.
