# The deployed leg — a reskin page on its aem.page preview

Phase 5 (e), any donor: what `deploy` made of the page, held to the local reskin page and the donor on
`https://<branch>--<repo>--<org>.aem.page`. It never publishes to aem.live. Bars: `gates.md` § (e). Command lines:
SKILL.md Phase 5 (e). Flags, evidence and exit codes: `deployed-gate.mjs --help`.

## When it runs

Only in an aem-boilerplate project: `stardust/runtime-contract.json` (`deploy`'s runtime probe), `head.html` and
`scripts/aem.js` at the repo root. Otherwise `deployed-gate preview` prints `SKIPPED deployed leg: <reason>`, records
it and exits 0, and every later step is `not run: skipped`. It also needs a GitHub push right, a DA token for
`deploy-batch` (`da-auth`) and a branch whose host label `<branch>--<repo>--<org>` is at most 63 characters.

## Isolation

Code is branch-scoped; DA content is not: a `PUT` has no branch, so a branch preview that writes `/nav` rewrites it
for every branch. Either **`--sandbox`**, a repo of one's own (the safest; waives the rules below, recorded), or
**`--namespace <ns>`** in a shared repo: every path the leg writes starts with `/<ns>/` (the page, `/<ns>/nav`,
`/<ns>/footer`, DA media under `--scope <ns>`), the page's `metadata` block carries `nav` and `footer` rows naming
`/<ns>/nav` and `/<ns>/footer`, and both chrome documents are on the publish roster or the chrome 404s. `preview`
reads the rows from the delivered head (`<meta name="nav">`, `<meta name="footer">`: EDS turns the block into head
metas), not from the `.plain.html`, and fails a path outside `/<ns>/` or holding `%`, `\`, `.`, `..` or an empty
segment.

## Recipe

1. **Deploy, preview-only.** `deploy` Steps 1–9 with `stardust/reskin/pages/<slug>.html` as the prototype: the content
   page `content/<ns>/<slug>.html`, in a shared repo both chrome documents, and `eds-schema/<slug>.json` (Step 2b,
   `qa-gate`'s input). `deploy` authors the content page (Step 9); generating it from the model is not built, so
   its differences are declared in the delta file. Step 10's reconcile is this leg, the reskin page its reference.
2. **Push the branch, force Code Sync** and poll until an edited block file is served
   (`../../deploy/da-deploy-protocol.md` § Deploy, step 0).
3. **Write the documents to DA and preview them, never publish:**
   `DA_TOKEN=… node skills/deploy/scripts/deploy-batch.mjs --org <o> --repo <r> --branch <b> --content content --paths <paths.txt> --no-publish --force --ledger stardust/.work/reskin/deploy-ledger.json`.
   `<paths.txt>` is a file, one web path per line (the page and both namespaced chrome documents; in a sandbox the
   page), each without extension, like `/<ns>/<slug>`; `--force` because a page already live is skipped; the
   dedicated ledger keeps the run apart from `content/.deploy-ledger.json`. Exit 3 is a token halt: refresh the
   token, re-run the same command; never a FAIL.
4. **`deployed-gate preview`** polls until the preview answers (`ERROR (exit 124)` after `--max-wait`: re-run once),
   checks isolation and writes `preview.json`.
5. **The delta file.** Run `deployed-gate content` with none, then write `reskin/deltas/<slug>.json` from what fails,
   one entry per real difference with its why, starting with `"blocking": false`: the text check stays advisory until
   the page's differences are measured.
6. **`deployed-gate all` under `run-bg`;** copy `summary.json`'s `ledgerFragment` into the ledger. On a protected preview
   give the command `--token-env <NAME>`, never `--auth-header`: `run-bg` saves the command it runs, argument values
   included, in its state file and prints it.

A preview is protected when it refuses the first request `preview` makes, which carries no token (`preview.json`
`auth: true`). A protected preview takes `--auth-header "<value>"` or `--token-env <NAME>` on `preview`, `content`,
`tokens`, `inherited` and `all`; a value starting with neither `token ` nor `bearer ` gets `token ` put in front. Without
one, `preview`, `content` and `all` stop with exit 2 (`the preview needs a site token`) rather than poll or crawl the
source first. A token a public preview never asked for is not sent (`tokenUnused: true`) and changes nothing: `parity`,
`sanity` and the rest run as on any public preview. The token reaches the preview origin only, child processes by
environment, and never argv, output, records or the ledger; under `run-bg` use `--token-env` only, as the header value
would be in the saved command. A sandbox repo's preview is public by default.

## The delta file

`reskin/deltas/<slug>.json` (tracked): the page's declared source → preview differences, read by `dom-equality` and
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
  `from` on the source side (slot text and CTA text), in file order, every occurrence.
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
  "invocation": "deployed-gate.mjs all --page <slug> …" }
```

A value is `PASS`, `PASS (n/a: <checks>)` (passed, those checks not measured; the reasons are in `summary.json`'s
`steps.<step>.detail`), `FAIL k/n`, `FAIL stalled decoration: <what>` (a gate stalled on the preview's decoration and
measured nothing: the step fails and the run goes on, `sanity` records its own hard decoration FAIL),
`ADVISORY <gates> (deltas.blocking false)`, `n/a: <why>`, `not run: <why>` or
`ERROR (exit N): <why>`; `figma` is figma-gate's own fragment, or one of those (`not run: no figma checks`).
`invocation` is the exact argument list, a token flag's value `[redacted]`. A residual's `class` is
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

Each step is `deployed-gate <step> --page <slug>` (`content`, `tokens` and `inherited` take the token flag on a
protected preview); `figma` is `node stardust/scripts/reskin/figma-gate.mjs all --page <slug> --url <preview url>
--target preview --reskin stardust/reskin/pages/<slug>.html [--auth-header "<value>" | --token-env <NAME>]`, where
`<preview url>` is `preview.json`'s `url` (it needs `figma-checks/<slug>.json`; `deployed-gate all` runs it too).

The matrix is for iterating. Only `all` writes `summary.json`, and it clears every step's previous record and re-runs
every step, so close each round with one `deployed-gate all` and copy its `ledgerFragment` into
`pages.<slug>.gates.deployed`: a single step's verdict is never what the ledger records.
A fix counts only once served: `curl --compressed <css url> | grep <marker>` finds it on the preview. A run with no
verdict (exit 124, or an instrument that did not run) does not count: re-run once; the same 124 twice is a
`needs-owner` residual. Exit 3 (bot challenge, token halt) is neither a FAIL nor an iteration.

## Defaults

- **Fonts.** A Figma donor supplies no font files: `deploy` writes only the metric-matched `<brand>-fallback` face and
  the first family stays the token string. "Font not served" is a declared difference, never a failure: `tokens`
  compares the first family, the Figma pixel check records `served: false`. Licensed files the user supplies stay
  possible through `deploy`'s own rule.
- **Text.** Advisory while the page's delta file says `"blocking": false`; measured pages decide when it turns blocking.
