> **Beta**: This capability is in beta and under active development. Review its output carefully before using it on production dispatcher configurations.

# Dispatcher Conversion — Validation (Branch E)

This is **phase 6 (VALIDATE)** of the flow in [context.md](context.md): the final gate that runs the AEM Cloud Service dispatcher validator against the converted config and iterates until it is clean. It runs **after** phase 4's output verification has cleared (no `filter-acl-loss` critical failure) and phase 5's judgment pass has relocated or flagged what the tool didn't resolve.

**This doc delegates; it does not re-document the validator.** The Dispatcher SDK validator, its command surface, the guardrails it enforces, and the local Docker runtime harness are all owned by the `dispatcher` skill. Do not reimplement or re-explain them here — run the steps below against that skill's references, which are the source of truth.

## Steps (delegate to the `dispatcher` skill)

1. **Run the Dispatcher SDK validator on the converted `src`.** Point the validator at the conversion output's dispatcher source root (the normalized `.../dispatcher/src`, containing `conf.d` and `conf.dispatcher.d`) and follow the flow in [validation-playbook](../../../dispatcher/config-authoring/references/config-authoring/validation-playbook.md):

   ```bash
   validator dispatcher <src>
   ```

   Run the corroborating `validator full <src>` / `validator httpd <src>` passes too where available; the playbook documents the expected baseline (e.g. success with the `/ignoreUrlParams` marketing-parameter warning) and the full URL-verification matrix.

2. **Check the result against the cloud guardrails.** Reconcile every validator finding — and the structural assertions the validator doesn't cover — against [cloud guardrails](../../../dispatcher/config-authoring/references/dispatcher-foundation/cloud-service-aemaacs-guardrails.md): source-of-truth layout and ownership, the required topology invariants (at least one enabled farm and one enabled vhost, known include locations, `default_*` wrapper contracts), and the CDN-vs-dispatcher boundary. A validator pass that violates a guardrail is not done.

3. **Use the local SDK for `docker_run.sh` / runtime checks.** When runtime behavior is in scope (not just static structure), exercise the config in the local Dispatcher SDK per [local SDK execution](../../../dispatcher/config-authoring/references/dispatcher-foundation/local-sdk-execution.md) — the `./bin/docker_run.sh <dispatcher-src> <aem-host>:<aem-port> <local-port>` positional contract (or `test` mode for a static config test). This catches behavior the static validator can't: filter allow/deny decisions, cache hit/miss, rewrite/redirect resolution.

4. **Iterate until clean.** Fix each finding, re-run the validator (and the runtime harness where relevant), and repeat until it passes with only the known/accepted warnings. Record executed checks, failures with their exact errors, and any accepted-with-reason warnings in the run's `conversion-report.md` — the same audit trail phase 4 writes to.

## Common post-conversion leftovers to check

These are the recurring residues an AMS/on-prem → cloud conversion leaves behind. Sweep for them explicitly before and during validation:

- **Leftover `PUBLISH_DOCROOT`.** The tool renames `PUBLISH_DOCROOT` → `${DOCROOT}` in vhost files, but stragglers (unusual spellings, or occurrences in files the rename pass didn't reach) can survive. Any remaining `PUBLISH_DOCROOT` must be renamed to `${DOCROOT}`.
- **An include that didn't get renamed or resolved.** A `$include`/`Include` still pointing at a pre-conversion path, a relocated folder (e.g. the old `conf.d/whitelists/`), or a file that no longer exists. Unknown/unresolvable include targets fail the validator — every include must resolve to a real file at a known location.
- **Empty `filters.any`.** An emptied `filters.any` (or empty farm `/filter` section) against a config that had filter rules is a wide-open dispatcher. The **`filter-acl-loss` gate in phase 4 should have caught this before validation** — see [output-verification.md](output-verification.md). If you are seeing an empty filter set here at phase 6, treat it as a hard stop, not a validator nit: go back, do not ship it.
- **Commented-but-unresolved non-whitelisted directives.** The tool's directive-whitelist pass *comments* directives outside the supported set (custom `LogLevel`/`LogFormat`, inline `mod_ssl` directives, etc.) rather than deleting them — a commented directive is **open, not resolved**. Left in place, they read as dead lines at best and can still fail the build. Resolve each per the decision catalog in [conversion-patterns.md](conversion-patterns.md) (remove, relocate to CDN-side, or confirm the need is gone); never ship a "converted" config with `#`-commented AMS directives still in it.

## See also

- [context.md](context.md) — the 6-phase flow this doc is phase 6 of, and the mode taxonomy.
- [output-verification.md](output-verification.md) — phase 4; the `filter-acl-loss` / `filter-rule-regression` gate that must clear before this phase runs.
- [conversion-patterns.md](conversion-patterns.md) — phase 5; the decision catalog that owns the commented-directive and content-blind-delete hand-offs.
- [current-sdk-conventions.md](current-sdk-conventions.md) — the target end-state this phase validates against, including the `default_*` freshness check.
