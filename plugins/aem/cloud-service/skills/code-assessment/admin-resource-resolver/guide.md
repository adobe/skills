# Admin resource resolver — AEM as a Cloud Service

> This pattern is executed by the code-assessment runbook — follow [`../references/runbook.md`](../references/runbook.md) for the full flow (preflight → plan → apply → verify, run log). This guide supplies the detection, triage and fix the runbook applies.

## Overview

AEM as a Cloud Service does not allow administrative resource resolvers: `getAdministrativeResourceResolver` and `loginAdministrative` are gone, and so is a service-user mapping to the `admin` user. Code that opens a resolver as admin, directly or through a wrapper that sets `ResourceProvider.AUTH_ADMIN`, fails at runtime after the migration. The replacement is a service resolver for a dedicated, least-privilege service user. The rules for that resolver are in [`../references/resource-resolver-logging.md`](../references/resource-resolver-logging.md); this guide applies them to an admin finding and does not restate them.

## Classification

- The analyzer flagged `admin-resource-resolver`, or the user asks to remove admin access, `getAdministrativeResourceResolver`, `loginAdministrative` or a mapping to `admin`.
- **Not this pattern** (`skipped: not-admin`): the finding is a project constant that only shares the name `AUTH_ADMIN`, or a mapping whose user is a named service user (`admin-sync-service`, `administrators-reader`).

## Discovery

```bash
bash ../scripts/analyze.sh <workspace-root> --pattern admin-resource-resolver
```

The detector flags, as written and without type resolution:

- a call to `getAdministrativeResourceResolver(` or `loginAdministrative(`, on any receiver;
- `ResourceProvider.AUTH_ADMIN` (simple or fully qualified), and a bare `AUTH_ADMIN` when the file static-imports it by name or by wildcard from a Sling `ResourceProvider`;
- a line in a `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl` configuration, including `.amended-*` and `~` variants, in a `.cfg.json`, `.config` or `.cfg` file, that maps to the user `admin` (`bundle:subservice=admin`, also `=[admin]`), or sets `user.default` to `admin`. `user.default` is the fallback user when no service mapping applies.

**Limits.** The analyzer collects only `.cfg`, `.cfg.json` and `.config` files, so a mapping in an XML `sling:OsgiConfig` file (for example `…ServiceUserMapperImpl.amended-<name>.xml` with `<name>=admin`) is **not** detected. Search `ui.config` and `ui.apps` for `ServiceUserMapperImpl*.xml` by hand and treat each `=admin` as a finding. The detector also misses a resolver opened through a helper in another module that is not flagged itself, and a user name built at runtime.

## Resolution contract

**guided.** The fix is mechanical in the Java call and the mapping; **which permissions the new service user gets is not**. What the code reads and writes decides it, and a person has to review it. The skill proposes the ACLs and never grants more than the code needs; it does not decide them alone.

1. **Find the caller's real access.** Read what each call site does with the resolver: the paths it reads, writes, deletes, and any JCR privileges it needs. For a wrapper such as an `AdministrativeResourceResolverImpl` that sets `AUTH_ADMIN`, find its callers: each caller is a subservice of its own.
2. **Use the existing ACLs as input.** Existing `_rep_policy.xml` files under `ui.content` / `ui.apps`, and `set ACL` lines in any Repoinit script, show what the project already grants and to whom. Take the paths from them; do not copy `admin`'s rights wholesale.
3. **Review.** Show the user the proposed paths and privileges per subservice and ask before writing them. Never ask for `jcr:all` on `/`.

## Fix (apply intent only)

Per caller, in this order:

1. **Name a subservice per caller**, for example `site-search-reader`. Reuse a subservice that already exists for the same concern. Do not share one for unrelated callers.
2. **Create a dedicated, least-privilege service user and its ACLs in Repoinit**, in `org.apache.sling.jcr.repoinit.RepositoryInitializer~<name>.cfg.json` (`create service user <name>`, `set ACL for <name>` with only the paths and privileges from the review above). Examples and the folder layout are in [`../references/resource-resolver-logging.md`](../references/resource-resolver-logging.md).
3. **Add the mapping** in `org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended-<name>.cfg.json`: `"<bundle-symbolic-name>:<subservice>=<service-user>"`. Replace the existing `=admin` entry; do not leave it beside the new one.
4. **Replace the call** with `getServiceResourceResolver(Map.of(ResourceResolverFactory.SUBSERVICE, "<subservice>"))`, in try-with-resources, catching `LoginException`. For a wrapper that sets `AUTH_ADMIN`, change the wrapper once and its callers keep compiling only if each passes its subservice; otherwise remove the wrapper and fix the callers.
5. **Verify.** Re-run `analyze.sh … --pattern admin-resource-resolver` (no findings left); build the project; start the AEM SDK locally and exercise each changed code path. A `LoginException` or an `AccessDeniedException` there means the mapping or an ACL is missing: add the privilege the code needs, never widen the user.

**Skip reasons** (the exact `skipped[].reason` strings): `not-admin: <what the name is>`, `needs-owner-decision: <the permissions the user must decide>`, `xml-config-not-scanned: <file>` for a mapping found by hand in an XML file the analyzer does not read.

## Review checklist

- [ ] Each call site has its own subservice and a service user, not `admin` and not a shared catch-all
- [ ] ACLs are in Repoinit, limited to the paths and privileges the code needs, and the user reviewed them
- [ ] The `=admin` mapping is replaced, not kept alongside; no `getAdministrativeResourceResolver`, `loginAdministrative` or `AUTH_ADMIN` remains
- [ ] Resolvers are closed (try-with-resources) and `LoginException` is handled, as in `resource-resolver-logging.md`
- [ ] XML `sling:OsgiConfig` files were searched by hand
- [ ] Surgical edit, no reformatting; nothing committed

## Handoff

The skill never commits. See [`../references/git-workflow.md`](../references/git-workflow.md) for git vs in-place handoff.
