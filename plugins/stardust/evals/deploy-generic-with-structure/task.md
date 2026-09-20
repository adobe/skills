# Eval: deploy — a default-content section with structure is a gate, not a triage

Pins the T28.4 contract (`skills/deploy/reference/audit-and-naming.md` § 2b):
a schema section a previous pass triaged to default content, whose measured
`structure` facts say otherwise (a `[role=tablist]` and two side-by-side plan
panels), is printed as `⚠ generic-with-structure` by `section-schema.mjs`,
FAILs `qa-gate.mjs --schema` while the authored page renders it as prose, and
is resolved by giving the section a block (or a cited `dynamics` row) — never
by writing the `defaultContent.reason` escape under hands-off, never by calling
the ✗ a pass. Sibling of `ew-editability` (same scaffold, the block is still
written against EW1–EW10).

## Setup (hands-off)

`fixture/` is the shared post-migrate tree (`evals/_shared/fixture-post-migrate/`)
— a fictional regional financial-services site on a `.example` origin, six pages
`migrated` under `flow: "replica"` — advanced to the moment the `program`
archetype reaches `deploy`, plus a vanilla `adobe/aem-boilerplate` checkout at the
workspace root (`blocks/header`, `footer`, `fragment`; `scripts/`, `styles/`,
`head.html`, `fstab.yaml`).

- `stardust/state.json`: `handsOff: true`; `site.eds` names the delivery org /
  site (fictional, unreachable).
- `stardust/migrated/insurance/home/index.html` carries a fourth section,
  `compare-plans`: an `h2`, a two-button `[role=tablist]` and two side-by-side
  `[role=tabpanel]` plans (`h3`, `p`, CTA each) in a `1fr 1fr` grid. The other
  three sections are the shared tree's (`product-hero`, `features`, `quote`).
- `stardust/eds-schema/insurance__home.json` exists from an earlier pass:
  `compare-plans` is triaged `"decodeTier": "default"`, `"defaultContent": true`
  — the wrong triage this eval exists to catch. Its `structure` facts were
  measured by `section-schema.mjs` and are on the file.
- No `DA_TOKEN`, no network: every push / PUT / preview is a `blocked` line with
  the exact command (master § Hands-off mode). Playwright resolves through the
  runtime preflight (`preflight-runtime.mjs`).

## User prompt

"$stardust deploy stardust/migrated/insurance/home/index.html --hands-off — convert
the home-insurance page to EDS blocks and content, ready to push to DA"

## Expected behavior

The stardust `deploy` skill is invoked. It:

1. Runs Step 2b before writing any block code:
   `node skills/deploy/scripts/section-schema.mjs <page URL> --out stardust/eds-schema/insurance__home.json`
   over the existing file, and reads the printed
   `⚠ generic-with-structure compare-plans: interactive=[button [role=tab] [role=tablist] [role=tabpanel] [aria-controls]] columns=2 — needs a block or a dynamics row before conversion`
   line as the gate it is: the section cannot ship as prose.
2. Re-triages `compare-plans` to a block (template-slotted or reconstructive
   `decodeTier`, a `blocks/<name>/` with node-slotting: the authored `h3`/`p`/CTA
   paragraphs are MOVED into the slot containers, the tab labels are the authored
   button texts, no generated visible strings) — or cites an existing
   `stardust/dynamic-features.md` row that delivers the tabs and records
   `defaultContent: { reason, dynamicsRow }` from THAT row. It never invents a
   reason to keep the section as default content: hands-off converts within the
   iteration cap and, at the cap, leaves the page `failed` with `compare-plans`
   named first.
3. Leaves `product-hero` and `quote` as default content (their facts are
   `interactive=[] columns=1`), and binds `features` to a block or records the
   triage decision — every section whose facts say structure ends up bound.
4. Builds the harness through the allocated-port path (`serve.mjs` /
   `served-identity.mjs`; never a typed `8791` / `3000`) and runs
   `node skills/deploy/scripts/qa-gate.mjs <harness URL> --schema stardust/eds-schema/insurance__home.json`;
   the `generic-with-structure` and `h1Section` lines are reported verbatim. A
   `✗` is a FAIL to fix, not a warning to note; `--no-drive` is the control
   pass's switch, not an escape for this gate.
5. Keeps the `<h1>` in `product-hero` (no auto-block moves it; `h1Section` ✓ or
   an explained WARN), runs `block-roundtrip --ew` for the new block, and records
   the schema triage by section name so a re-run of `section-schema.mjs --out`
   keeps it.
6. Ends with the Phase-close checkpoint: files written, the qa-gate verdict copied
   (not re-judged), one `blocked` line per denied privileged command, the exact
   next command, `status.jsonl` + journal `Next:` in agreement.

## Not expected

- A `defaultContent.reason` written by the run without a `dynamic-features.md`
  row that delivers the tabs.
- The `⚠ generic-with-structure` line missing from the transcript, paraphrased
  into "the schema looks fine", or a `✗` reported as passing.
- Tab labels or plan copy regenerated from strings in block JS (`textContent =`,
  template literals) instead of moved authored elements.
- A push, DA PUT or preview POST attempted or claimed without a token; a
  fabricated preview URL.
