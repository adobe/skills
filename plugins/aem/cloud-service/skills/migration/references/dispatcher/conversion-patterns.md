> **Beta**: This capability is in beta and under active development. Review its output carefully before using it on production dispatcher configurations.

# Dispatcher Conversion — Decision Catalog (Branch E)

This is Branch E's **decision catalog** — the skill's knowledge center for dispatcher conversion, and the reference the agent consults during **phase 5 (JUDGMENT + CROSS-BOUNDARY)** of the flow in [context.md](context.md), after Adobe's converter tool has run and its output has passed verification. For every AMS/on-premise construct still sitting in the config — because the tool doesn't touch it, only partially resolves it, or deliberately leaves it for a human — this catalog says what to do, why, and which Adobe doc backs the call.

The catalog is grounded in a real customer AMS→AEMaaCS dispatcher migration: every numbered row below reproduces a construct actually found in that config, not a hypothetical. Most rows apply regardless of `standard` vs `flexible` mode; a couple (the `whitelists/` folder in row 4, and the farm-side items in the tool-handled bucket) are specific to the AMS v2.0 `conf.dispatcher.d` layout — see [context.md](context.md)'s mode taxonomy if you're unsure which applies to the config in front of you.

**Primary Adobe references** (cited per row below):

- **AMS transition guide** — [Transitioning to AEM as a Cloud Service — Dispatcher](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/ams-aem) — the AMS→AEMaaCS dispatcher transition rules this whole conversion is based on.
- **Dispatcher overview** — [Dispatcher in AEM as a Cloud Service](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) — allowed/disallowed directives, TLS terminating at the edge.
- **Author caching** — [Author caching in AEM as a Cloud Service](https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/caching/author) — why dispatcher config is ignored on author.

## How to use this catalog

Match what you find in the inventory (or in the tool's own `conversion-report.md`) against each row's **Signal**; apply the paired **Action**. Three things hold across every row:

1. **A commented-out directive is not a resolved one.** The tool's own non-whitelisted-directive pass (the last rule it runs) *comments out* anything outside the dispatcher's supported directive set — it does not delete it, and it does not decide whether the underlying need still applies. Treat every directive the tool commented as **open** until this catalog (or the user) resolves it; never ship a "converted" config with `#`-commented AMS directives still sitting in it.
2. **"Drop" and "Preserve + strip" are different actions.** Most unsupported files below are wholesale-deleted (`Drop`) because nothing else in them is needed. Row 10 is the deliberate exception: the file mixes supported and unsupported directives, so only the offending lines go.
3. **Cross-boundary items are handed off, not finished here.** Branch E identifies and names the problem; it does not create Cloud Manager variables or author CDN configuration itself — see "Variables and the Cloud Manager hand-off" and "CDN candidates" below.

## Decision catalog

### Logging and custom directives

| # | Signal | Action | Reason | Adobe reference |
|---|---|---|---|---|
| 1 | `LogLevel` set to a non-default/custom value (e.g. `LogLevel ... rewrite:info`), or a custom `LogFormat`/`ErrorLogFormat` inline in a vhost | **Remove** the directive; flag for confirmation | Custom log levels/formats sit outside the dispatcher's supported directive set — left in place, the Cloud Manager dispatcher validator fails the build. *Note:* the tool's directive-whitelist pass only comments non-whitelisted directives out; that is a flag for the agent to resolve, not a fix by itself. | [Dispatcher overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) |

### TLS/SSL — terminates at the CDN edge, not the dispatcher

| # | Signal | Action | Reason | Adobe reference |
|---|---|---|---|---|
| 2 | `SSLEngine On`, `SSLCertificateFile`, `SSLCertificateKeyFile` (any `mod_ssl` directive) | **Remove**; flag as a CDN-configuration concern | The AEMaaCS dispatcher only ever receives plain HTTP — TLS terminates at the Adobe CDN edge, not at the dispatcher. These directives also sit outside the supported directive set, so they would fail validation even before the runtime mismatch. | [Dispatcher overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) |
| 3 | `<If "${PUBLISH_FORCE_SSL} == 1"> Include ...xforwarded_forcessl... </If>` (or an equivalent force-SSL rewrite include) | **Remove** the whole `<If>` block | Redundant once TLS is enforced at the CDN edge — HTTP→HTTPS redirection is handled there, not by a dispatcher-side rewrite. | [AMS transition guide](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/ams-aem) |
| 11 | `conf.d/ssl.conf`, `000_*_ssl.conf` (per-vhost SSL config) | **Drop** | Same TLS-at-edge reasoning as row 2: SSL config has no valid role on a cloud dispatcher and fails validation regardless of content. | [Dispatcher overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) |

### Includes and modules

| # | Signal | Action | Reason | Adobe reference |
|---|---|---|---|---|
| 4 | Any file `$include`d/`Include`d from a folder literally named `conf.d/whitelists/` | **Relocate** the file(s) to `conf.d/includes/`; repoint every referencing `$include`/`Include` | The Cloud Manager dispatcher-config validator rejects the folder **name** `whitelists` outright — a naming constraint, not a content one. (This is distinct from the AMS IP-allowlist *mechanism* itself, which the transition guide has the tool remove entirely — see "Tool-handled mechanics" below. This row is for customer includes that merely happen to live under that folder name.) | [AMS transition guide](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/ams-aem) |
| 5 | `conf.modules.d/*` — loading additional/third-party Apache modules (e.g. a `mod_pagespeed` `.load`/`.conf` pair) | **Drop** the whole directory | AEMaaCS dispatcher does not support loading additional Apache modules — the module binary can't be installed into the managed container, so any config for it is dead weight regardless of content. | [Dispatcher overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) |

### Files the validator rejects outright

| # | Signal | Action | Reason | Adobe reference |
|---|---|---|---|---|
| 6 | `conf.d/logformat.conf` (custom log format definitions) | **Drop** | Same custom-log-format constraint as row 1 — unsupported, fails validation. | [Dispatcher overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) |
| 7 | `conf.d/autoindex.conf` (`IndexOptions`, `AddIconByType`, hardcoded `/usr/share/httpd/icons/...`) | **Drop** | The validator fails on these directives; independently, the hardcoded container-filesystem path is Adobe-managed inside the cloud dispatcher image and isn't guaranteed stable across environments — never author config that assumes a specific in-container path. | [Dispatcher overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) |
| 8 | `conf.d/mod_security.conf.rpmsave` | **Drop** | An RPM-preserved backup file — never loaded by Apache in the first place. Dead weight, not active config. | [Dispatcher overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) |
| 9 | `conf.d/mod_security.conf` (`SecPcreMatchLimit`, `SecPcreMatchLimitRecursion`, `SecDebugLog`, `SecAuditLog`; its `modsecurity.d/*` includes are missing) | **Drop** | `mod_security` directives sit outside the dispatcher's supported set (validator fails), and the file's own includes point at a `modsecurity.d/*` tree that isn't present — it was already broken before conversion even started. | [Dispatcher overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) |
| 12 | `conf.d/welcome.conf` | **Drop** | References container-filesystem paths (the default Apache "It works" page under `/usr/share/httpd/...`) — same path-fragility concern as row 7. | [Dispatcher overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) |

### Preserve, don't delete

| # | Signal | Action | Reason | Adobe reference |
|---|---|---|---|---|
| 10 | `conf.d/security.conf` mixing supported content with unsupported directives (`ServerTokens Prod`, `<Limit> ... </Limit>`) | **Keep the file; strip only the unsupported directives** — do not delete the whole file | The rest of the file is ordinarily legitimate, supported config; deleting the whole file would throw away good config along with the bad. `ServerTokens` and `<Limit>` specifically aren't in the AEMaaCS directive whitelist and must go — everything else stays. | [Dispatcher overview](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/disp-overview) |

### Non-publish tiers (author, health, flush, license-control)

| # | Signal | Action | Reason | Adobe reference |
|---|---|---|---|---|
| 13 | Author-targeted vhosts (`author_*.vhost`, or any vhost file whose name/content targets the author tier) | **Drop** | AEMaaCS has no dispatcher in front of author at all — dispatcher configuration is simply **ignored** on author, so anything author-targeted is unreachable dead config. Confirm nothing author-side actually depended on dispatcher-level behavior before deleting (there is none to depend on in AEMaaCS). | [Author caching](https://experienceleague.adobe.com/en/docs/experience-manager-learn/cloud-service/caching/author) |
| 14 | Non-publish vhosts/farms — filenames containing `author`, `unhealthy`, `health`, `lc`, or `flush` (e.g. `aem_flush.vhost`, `aem_health.vhost`, `aem_lc.vhost`) | **Drop** | Per the transition guide, remove all non-publish virtual hosts — AEMaaCS's dispatcher is publish-only. Health vhosts in particular often carry a CGI `ScriptAlias` (e.g. `ScriptAlias /var/www/cgi-bin/health/`), which is invalid on its own merits (no custom CGI execution on the cloud dispatcher) — and because `ScriptAlias` is itself an otherwise-ordinary, commonly-whitelisted directive, the tool's generic non-whitelisted-directive scan will not flag it. This needs deliberate agent review, not just a directive-whitelist pass. | [AMS transition guide](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/ams-aem) |

### Variables and the Cloud Manager hand-off

| # | Signal | Action | Reason | Adobe reference |
|---|---|---|---|---|
| 15 | `${DISP_ID}` (e.g. an `X-Dispatcher` response header set in `conf.d/includes/global_header.conf`) and other AMS/`.tmpl`-only `${...}` environment variables | **Hand off**: map each surviving variable to a Cloud Manager environment variable and route it to the migration skill's **Branch A** ([`osgi-cfg-json-cloud-manager.md`](../osgi-cfg-json-cloud-manager.md)); also add it to the tool's own `variablesToReplace` list (see [config-generation.md](config-generation.md)) so the conversion run substitutes it instead of leaving a dangling `${VAR}` in the output | This is a genuine cross-boundary hand-off, not something Branch E finishes alone. Branch E's inventory names the candidates (`cmVarCandidates`) and feeds the substitution into the tool's `config.yaml`; only Branch A's OSGi/Cloud-Manager workflow actually creates the Cloud Manager variable or secret. | [AMS transition guide](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/ams-aem) |

## Tool-handled mechanics (reference only — don't redo these)

Adobe's converter already performs the following as standard, mechanical steps of its own AMS-transition rule set. This is **not** a judgment call — do not re-apply these by hand, and don't flag them as residue in phase 5.

| # | Signal | Action | Reason | Adobe reference |
|---|---|---|---|---|
| 16 | Standard AMS→AEMaaCS transition mechanics already executed by Adobe's converter (see breakdown below) | **No action — already tool-handled.** Confirm it happened (check the tool's own `conversion-report.md`); never redo it by hand. | These are mechanical, deterministic steps straight out of Adobe's own AMS-transition rule set — the tool executes them on every run. Re-applying them manually risks duplicate or conflicting edits, and second-guesses a tool that already got it right. | [AMS transition guide](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/content-delivery/ams-aem) |

Breakdown of what row 16 covers:

- **Farm renaming** — `*_farm.any` → `*.farm` (drops the `_farm` infix, normalizes the extension).
- **AMS artifact removal** — deletes files prefixed `ams_*`.
- **Port stripping** — removes `<VirtualHost>` sections not bound to `:80` (TLS-only sections go; the edge terminates TLS).
- **Variable rename** — `PUBLISH_DOCROOT` → `${DOCROOT}`.
- **Rule consolidation** — collapses customer rewrite/filter/cache/clientheader rule files down to Adobe's canonical single file per concern (`rewrite.rules`, `filters.any`, `rules.any`, `clientheaders.any`), repointing includes to match. Rewrite/redirect rules — including customer vanity-URL redirects — are consolidated this way, not dropped: content survives, only the file layout changes.

## CDN candidates: flagged, not authored

A few of the rows above — force-SSL redirection (row 3), some redirect rules, security-header directives — look like they belong in the CDN configuration once removed from the dispatcher. **Branch E only flags these as CDN candidates for the user; it does not author CDN configuration.** Authoring CDN-side config is out of scope for this branch: say what was removed and why it might need a CDN-side equivalent, then stop.

## See also

- [context.md](context.md) — the phase flow this catalog belongs to (phase 5), and the mode taxonomy referenced above.
- [config-generation.md](config-generation.md) — how `cmVarCandidates` and the rest of the inventory become `config.yaml`, including `variablesToReplace`.
- [validation.md](validation.md) — phase 6; anything this catalog marks "flag" or "preserve + strip" is worth a second look once the validator runs.
