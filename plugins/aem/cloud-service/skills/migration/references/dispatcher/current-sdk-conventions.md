> **Beta**: This capability is in beta and under active development. Review its output carefully before using it on production dispatcher configurations.

# Dispatcher Conversion — Current-SDK Conventions (Branch E)

This doc describes the **target end-state**: the shape a converted config must reach to be a valid AEM as a Cloud Service dispatcher. It is the convention set that phase-4 normalization aims at (see [output-verification.md](output-verification.md)) and that the phase-6 validator checks against (see [validation.md](validation.md)). See [context.md](context.md) for where these two phases sit in the 6-phase flow.

This is **not** a re-documentation of the cloud dispatcher layout. The authoritative source of truth for the target layout, ownership rules, and validator invariants is the `dispatcher` skill — this doc names the handful of end-state markers the converter has to produce and then hands you to that skill for the full contract. Read those references before hand-editing anything; do not treat the summary below as a substitute.

## The collector-plus-includes shape

A current-SDK dispatcher config uses thin **collector** files that glob-include the real config, plus opt-in marker files that select runtime behavior:

- **`conf.dispatcher.d/enabled_farms/farms.any`** — the farm collector. Its body is the glob include:

  ```
  $include "./*.farm"
  ```

  Every enabled farm lives as a `*.farm` file (or symlink to `available_farms/`) alongside it; the collector pulls them all in. A converted config that is missing this collector is flagged as a warning in phase 4 — add it for current-SDK compliance.

- **`conf.d/enabled_vhosts/vhosts.conf`** — the vhost collector, the `conf.d` analogue of the farm collector. Each enabled vhost lives as a `*.vhost` file (or symlink to `available_vhosts/`); the collector includes them.

- **`opt-in/*` marker files** — presence-based flags that select SDK behavior. The canonical one is **`opt-in/USE_SOURCES_DIRECTLY`**, which tells the SDK/runtime to consume the config sources directly. Its presence (alongside a populated `enabled_farms/farms.any`, with no AMS markers) is also the signal that a config is already in cloud shape — see the `already-cloud` mode in [context.md](context.md), which is **report-only** and must not be re-run through the tool.

- **Immutable, Adobe-managed `default_*.any` files** — the managed baselines the customer wrappers include: `default_filters.any`, `default_rules.any`, `default_rewrite.rules`, `default_clientheaders.any`, `default_virtualhosts.any`, `default_renders.any`, `default_invalidate.any`, and friends. These are **owned by Adobe**, not the customer: customer intent goes in the mutable wrapper (`filters.any`, `rules.any`, etc.), and the wrapper keeps its `$include` of the managed default. Do not edit the `default_*` files directly.

### Known drift risk — verify `default_*` freshness against the live SDK

The `default_*.any` files shipped in a project (typically seeded from the AEM project archetype) periodically **fall out of sync** with the live Dispatcher SDK: Adobe updates the managed defaults in the SDK, and the copies committed in the repo do not update themselves. A converted config can validate against a stale local copy yet diverge from what the platform actually runs. When conversion is done, **verify the immutable `default_*` files are current** against the Dispatcher SDK you validate with (see [validation.md](validation.md)) rather than assuming the archetype's copies are fresh; refresh them from the SDK if they have drifted. Flag any drift for the user — it is exactly the kind of silent divergence the honest-automation stance in Branch E is meant to surface, not paper over.

## Runtime invariants the validator enforces (named here, not re-documented)

Beyond the file-shape markers above, a valid cloud dispatcher must satisfy runtime invariants the **Dispatcher SDK validator** checks. This doc only *names* them so the converter's end-state is complete; the authoritative contract and exact values live in the `dispatcher` skill (the guardrails + `validation-playbook.md` §6 linked below), and [validation.md](validation.md) (phase 6) is where they are actually checked — not by the conversion coverage report.

- **Publish host aliases** — at least one vhost advertises `ServerAlias "*.adobeaemcloud.net"` and `ServerAlias "*.adobeaemcloud.com"`; no leftover `ServerName "*"`.
- **Reserved probe paths untouched** — `/system/probes/live`, `/system/probes/ready`, `/system/probes/start`, `/system/probes/health`, and `/systemready` are not intercepted by custom rewrites, redirects, or filters.
- **Explicit `/ignoreUrlParams` strategy** — query-parameter (including marketing-parameter) cache handling is stated explicitly. This is a distinct concern from the farm `/cache/rules` count the coverage report tracks; it is validated in phase 6, not counted.
- **Core vhost defaults intact** unless intentionally replaced with recorded evidence: `AllowEncodedSlashes NoDecode`, `DispatcherUseProcessedURL On`, `DispatcherPassError 0`, `ModMimeUsePathInfo On`, `DirectorySlash Off`.

## Source of truth (dispatcher skill — link, don't re-document)

For the full target layout, file-family ownership, wrapper-vs-default rules, and the validator-enforced topology invariants, defer to the `dispatcher` skill. These are authoritative; the summary above is only the converter's end-state checklist.

- [cloud guardrails](../../../dispatcher/config-authoring/references/dispatcher-foundation/cloud-service-aemaacs-guardrails.md) — Core-7 guardrails: source-of-truth layout and ownership, required cloud topology invariants (enabled farms/vhosts, known include locations, symlinks), validator-enforced contracts, and the CDN-vs-dispatcher boundary. This is the contract normalization and validation target.
- [repo layout](../../../dispatcher/config-authoring/references/dispatcher-foundation/repo-layout-workflows.md) — the supported public repo layouts (`<repo>/src` vs `<repo>/dispatcher/src`), the `conf.d/` and `conf.dispatcher.d/` file families, and the file-family heuristics for locating a change.

## See also

- [context.md](context.md) — the 6-phase flow and mode taxonomy; the `already-cloud` mode keys off the `opt-in/USE_SOURCES_DIRECTLY` marker and populated `farms.any` described here.
- [output-verification.md](output-verification.md) — phase 4; normalization aims the surviving output at these conventions (adds the missing `farms.any` collector, splits mega-inlined vhosts into the include shape).
- [conversion-patterns.md](conversion-patterns.md) — phase 5; the decision catalog that relocates/flags what the tool doesn't fully resolve into this shape.
- [validation.md](validation.md) — phase 6; runs the Dispatcher SDK validator against this end-state and iterates until clean.
