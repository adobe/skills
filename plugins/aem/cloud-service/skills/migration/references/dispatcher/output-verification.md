> **Beta**: This capability is in beta and under active development. Review its output carefully before using it on production dispatcher configurations.

# Dispatcher Conversion — Output Verification + Normalize (Branch E)

This is phase 4 (**VERIFY + NORMALIZE**) of the flow in [context.md](context.md): the layer that checks what Adobe's converter actually emitted against the phase-1 baseline, then normalizes the surviving output into current-SDK shape. Phase 3 (EXECUTE) tells you the tool *ran*; this phase tells you whether it produced a config you can safely ship — and stops the pipeline cold when it didn't.

**Why this layer exists.** Adobe's converter can silently emit an empty `filters.any` while its own `dispatcher-converter-report.md` reports the filters "consolidated." A consolidated-to-nothing filter set reads as success in the tool's report and as a security/functionality regression in production. What the regression *is* depends on the surviving baseline: with the managed `default_filters.any` deny-all still `$include`d, an emptied custom `filters.any` is **over-restrictive** — lost *allow* rules block legitimate paths and break the site; with the deny-all also gone, a truly empty or absent `/filter` section is a fully **wide-open** dispatcher (Dispatcher's documented default with no `/filter` is allow-all). Lost *deny* rules cut the other way, exposing paths the defaults don't cover. Every direction is an unsafe ship, and nothing in the tool's own output flags it. `dispatcher-verify.js` is the gate that does — it reconciles the output's real rule counts against the counts you captured *before* conversion and refuses to call a dropped ACL a success.

Both sides of that reconciliation use the **same** filter counter (`countFilterRules` in `dispatcher-inventory.js`), which counts filter rules wherever they live: inline farm `/filter { /NNNN {} … }` blocks **and** the standalone filter-rule files an inline `/filter { $include … }` pulls in — a file whose basename is `filters.any`, ends with `_filters.any`, or is a `.any` file in a `filters/` directory (**excluding** the Adobe-managed `default_*.any` immutables — see [the residual filter blind spot](#the-residual-filter-blind-spot)). This matters because the canonical AMS "standard" layout keeps its rules in `conf.dispatcher.d/filters/*_filters.any` and only `$include`s them from the farm; counting inline blocks alone would score such a source at **zero** filter rules, and the gate — which only fires when `baseline.filter > 0` — would wave an emptied output straight through. Because baseline and output are counted identically, a converter that legitimately preserves filters into `filters.any` (or a `*_filters.any` include) is *not* falsely flagged as loss either.

## Running the check

After `runConverter` returns (phase 3), hand its `outputSrcDir` and the **pre-conversion** inventory's `ruleCounts` to the verifier:

```js
const { verifyOutput } = require('./scripts/dispatcher-verify.js');

// result is what runConverter(...) returned in phase 3.
// inventory is what buildInventory(root) returned in phase 1 — captured BEFORE the tool touched anything.
const verdict = verifyOutput(result.outputSrcDir, inventory.ruleCounts);
// verdict → { ok, failures: [{ severity, category, detail }], warnings: [ '<string>', ... ] }
```

A few things to be precise about:

- **The baseline is the phase-1 inventory, not a re-count of the output.** `inventory.ruleCounts` (`{ filter, rewrite, cache, clientheader, virtualhost }`) is captured in phase 1 and must be captured *before* anything mutates the tree — per [context.md](context.md), "Capture `ruleCounts` before touching anything — it is the baseline phase 4 verifies against." If you re-derive the baseline from post-conversion files you are comparing the output to itself and the whole check is meaningless.
- **`outputSrcDir` is the tool's output tree** (`<workingDir>/target/dispatcher/src`), not the in-place project source. The verifier reads `conf.dispatcher.d/` and `conf.d/` under that directory.
- **`failures` are objects, `warnings` are plain strings.** Each failure is `{ severity, category, detail }`; each warning is a human-readable sentence. `ok` is simply `failures.length === 0` — warnings never flip `ok` to false.

### The residual filter blind spot

**Resolved — the `default_*.any` masking case.** The AEMaaCS SDK ships Adobe-managed **immutable** filter files in `conf.dispatcher.d/filters/` (`default_filters.any` and friends): fresh boilerplate, never the customer's at-risk custom ACLs. Because those files sit in a `filters/` directory and end with `_filters.any`, a naive count would include them — and a populated `default_filters.any` surviving alongside an **emptied** custom `filters.any` would keep the output count non-zero, so `filter-acl-loss` would *not* fire and the dropped custom ACLs would slip through masked (baseline custom `8`, output custom `0` but default `12` → `12 ≠ 0`, no acl-loss; `8 > 12` false, no regression → silent pass). `countFilterRules` now **excludes any standalone filter file whose basename starts with `default_`**, so the count compares **custom-to-custom**: the AMS baseline has no `default_*.any` files (excluding changes nothing there), and an output whose custom `filters.any` was emptied scores **zero** even when the SDK default survives — the gate fires. A surviving SDK immutable can no longer hide dropped customer rules.

**Still unresolved — the out-of-`filters/` include.** One gap remains, and it is the same honesty caveat as the [`cmVarCandidates` blind spot](config-generation.md): a farm that `$include`s its filter rules from a file that is **neither** in a `filters/` directory **nor** named `*_filters.any` (for example `/filter { $include "/etc/httpd/acl/site-acls.any" }` pointing at some absolute container path) is not resolved — the counter never opens that file, so those rules score **zero**. If the baseline reads `filter: 0` on a config you know has ACLs, that is the signal: don't trust a green gate on it. Sanity-check `baseline.filter` against the source before proceeding — grep the source for `/filter` sections and their `$include` targets (`grep -rn '/filter' <configRoot>`), and if rules live behind an unresolvable include, count them yourself rather than letting a `baseline.filter` of 0 disable the gate.

## The taxonomy (verbatim categories)

These `category` values come straight from `dispatcher-verify.js`. Match on them exactly.

| `category` | `severity` | What it means | What to do |
|---|---|---|---|
| `filter-acl-loss` | `critical` | Source had filter rules (`baseline.filter > 0`) but the output has **zero** — every place a rule can live is empty: inline farm `/filter` blocks *and* the standalone filter files (`filters/*.any`, `*_filters.any`). | **HARD STOP.** Filters are security-critical — NEVER ship a dropped filter ACL. This is the core reason the layer exists: the tool can emit an empty `filters.any` while reporting "consolidated." Do not proceed to phase 5/6; surface to the user. |
| `filter-rule-regression` | `important` | Output filter count is > 0 but **below** the baseline — some rules survived, some were lost. | Find the lost rules. Diff the output `filters.any` / farm `/filter` against the source filter files, restore what dropped, or explicitly accept the delta with a recorded reason. |
| `disorganized` | `important` | A vhost under `conf.d/` exceeds **5000 lines** — mega-inlined, everything crammed into one file. | Restructure the inlined rewrites/filters into named include files and wire them back (see **Normalization** below). |

Two more findings land as **warnings** (advisory strings in `warnings[]`, they do not fail the run):

- **Rewrite/redirect count drop** — the output has fewer `RewriteRule`/`Redirect`/`RedirectMatch` directives (across `.rules`/`.vhost` files) than the baseline. This is a warning, not a failure, because rewrites may *legitimately* move to the CDN during migration. Two things make it an **advisory** signal rather than a literal count: a **templated** source (`.rules.tmpl`) can inflate the baseline (a template may expand to many literal rules), and TLS/host redirects plus large **vanity-URL / redirect maps** commonly move to the **CDN edge** on AEMaaCS by design. Read a large drop as *consolidation + an expected CDN move* and reconcile against the tool's own `conversion-report.md` — confirm the missing rules were intended to move (or moved) rather than silently lost, without treating the raw delta as proof of loss.
- **Missing `enabled_farms/farms.any` collector** — the output has no `conf.dispatcher.d/enabled_farms/farms.any`. A warning; add the collector (`$include "./*.farm"`) for current-SDK compliance.

## Disposition

Read the verdict and route on severity — this is the whole point of the gate:

- **Any `critical` failure (i.e. `filter-acl-loss`) = STOP.** Do **not** proceed to phase 5 (judgment) or phase 6 (validation). Surface the failure to the user with the `detail` string. A dropped filter ACL is never an acceptable auto-pass; it is a security regression that must be resolved before the config goes anywhere. This matches [context.md](context.md): "STOP on any `filter-acl-loss` failure … a hard gate, never a silent pass."
- **`important` failures = resolve or explicitly accept.** `filter-rule-regression` and `disorganized` don't halt the pipeline, but they don't clear on their own either. Either fix them (restore the lost filter rules; restructure the mega-vhost) or record an explicit, reasoned acceptance in the run report. An unaddressed `important` finding is a manual-residue item the user must sign off on — see [context.md](context.md)'s "Manual residue" list.
- **`warnings` = advisory.** Note them, confirm the rewrite drop was intentional, add the missing farm collector, and move on. They inform phase 5/6; they don't block.

## Normalization

Once the verdict is clear of `critical` failures, the agent normalizes the surviving output — this is judgment work, guided by the decision catalog in [conversion-patterns.md](conversion-patterns.md), not a script:

- **Split a mega-inlined vhost** (the `disorganized` finding) into named rewrite/filter include files and wire them back with the right `Include`/`$include` directives, so the config is maintainable and matches how a current-SDK dispatcher is laid out. Restructure — don't just tolerate a 5000-line file.
- **Ensure current-SDK conventions.** The end-state uses the collector-plus-includes shape: `enabled_farms/farms.any` (with `$include "./*.farm"`), `enabled_vhosts/vhosts.conf`, and the `opt-in/*` markers. Add the collectors the warnings flagged and confirm the vhost/farm wiring follows these conventions.
- **Where safe restructuring isn't possible, preserve and flag precisely.** If a construct can't be cleanly split or converted without risking behavior, keep it intact and flag it for the user with an exact pointer (file, section, why) rather than guessing at a transform. Preserve-and-flag beats a lossy auto-edit — the same honest-automation stance the rest of Branch E takes.

The convention target normalization aims at is the same one phase 6 validates against; see [validation.md](validation.md) (forward ref) and [current-sdk-conventions.md](current-sdk-conventions.md) (forward ref).

## Record everything

Write the full picture of this phase into the run's `conversion-report.md` — what was **preserved**, **relocated**, **dropped**, **flagged**, and every **verification failure** (category, severity, detail) with its disposition (fixed / accepted-with-reason / escalated). This report is the audit trail the user reviews and signs off on; a finding that was resolved silently is indistinguishable from one that was missed. Be specific: name files and sections, not just counts.

## Not in scope here

Content the tool **deleted content-blind** — whitelists, custom `.conf` files, and the other unconditional early-pass deletes — is **not** this phase's problem. That is handled *before* the tool runs (relocate anything worth keeping out of harm's way) and *after* it runs (re-integrate), per the decision catalog in [conversion-patterns.md](conversion-patterns.md). This phase verifies and normalizes the tool's **output**; it does not recover inputs the tool was always going to erase. Don't try to reconstruct a deleted whitelist here — that hand-off lives in phase 5.

## See also

- [context.md](context.md) — the 6-phase flow this doc is phase 4 of, the mode taxonomy, and where `ruleCounts` is captured as the baseline.
- [config-generation.md](config-generation.md) — phase 2; produces the `config.yaml` and the `runConverter` result whose `outputSrcDir` this phase reads.
- [conversion-patterns.md](conversion-patterns.md) — phase 5; the decision catalog that guides normalization here and owns the content-blind delete hand-offs.
- [validation.md](validation.md) — phase 6 (forward ref); the AEM Cloud Service dispatcher validator that runs after this phase clears.
- [current-sdk-conventions.md](current-sdk-conventions.md) — the target end-state conventions normalization aims at (forward ref).
