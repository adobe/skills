# Pattern: custom-templates (static → editable)

Read this when `custom-templates` is in scope. The Branch G workflow ([validate-migration.md](validate-migration.md)),
safety rules, reporting and finalize steps still apply; this file adds what is
specific to templates. This is agent-orchestrated validation using the existing
CLI, approved browser/content tools and the customer's deployment tooling.
It is not an unattended browser runner. Never manufacture observations, screenshot
reviews, deployment success or cleanup confirmations to fill an evidence file.

## Overview

Precondition: the migration skill's
[template-modernization-validation.md](../template-modernization/template-modernization-validation.md)
has passed for the generated templates and rules. This pattern adds the
deployed, side-by-side comparison on top of it.

Run three steps in order:

1. **Offline (always, no AEM).** Package checks plus component mapping: every
   component of the pre-migration static template, read from Git (never the working
   tree), must exist in the editable template's `structure` or `initial`. The static
   path defaults to `/apps/<site>/templates/<editable-name>` and the ref to `HEAD`;
   pass `--static-template` and `--baseline-ref` on verify when they differ.
2. **SDK health (section 2).** Deploy the migrated packages to the Cloud SDK only;
   every project bundle must be Active via MCP before any page work.
3. **Side-by-side (sections 1a and 3, main check).** The same real page on the legacy
   Quickstart (static template, real content) and on the SDK after AEM Modernize
   Tools converts it; compare components, text, images and desktop/mobile screenshots.

Ask nothing for step 1. Ask once before deploying or writing content in steps 2-3.
If the Quickstart is missing, ask the user to set it up once; never skip step 3
silently. Use `--template-mode runtime` on prepare and `--template-evidence
<absolute-json-path>` on verify; retain `--template /conf/<site>/settings/wcm/templates/<name>`
throughout. The runtime requirement is saved in prepared state; missing evidence or
an unverifiable component mapping cannot become a pass. If the user explicitly
requests package-only validation, omit the runtime options and report that scope;
an unverifiable mapping is then a restricted pass.

- Prepare builds the content package but does **not** deploy it; section 2 does.
- Browser observations come from actual approved browser/tool runs; the CLI
  consumes saved evidence and does not create pages, deploy content packages or
  take screenshots itself.
- Allowed exceptions to the parent's no-write rule: the approved target package
  deployment and approved disposable fixtures under dedicated test parents on
  isolated instances. Existing comparison pages stay read-only.
- Submit and finalize EACH emitted template payload and receipt separately; a passing
  sibling never masks a failed template.
- Failures go back to `migration`. After any approved repair, rerun prepare, redeploy
  the final package to the target, capture fresh comparisons for that prepared run
  and verify again.

## 1. Readiness and Scope

- **Source AEM 6.5** defaults to `http://localhost:4502`; **target Cloud SDK**
  defaults to `http://localhost:4602`. Explicit URLs override saved setup and
  defaults. Run `init.js --pattern custom-templates` with those URL overrides; it
  saves both URLs and rejects a source URL that is the SDK URL, without contacting
  either instance. Pin both URLs for the whole run. Before capturing comparisons,
  confirm in the browser sessions that the source is AEM 6.5 and the target is the
  Cloud SDK.
- Honor supplied URLs first and check whether each instance is already running.
  If one does not respond, ask the developer to start it and rerun setup; never
  search for, start, or download AEM installations.
- Discover browser capabilities for both instances: rendering, read-only page and
  template content, saved PNG screenshots and actual image review. If unavailable,
  stop with the missing capability; a screenshot capture alone is not a visual
  comparison. Use existing authenticated sessions or user-configured tools.
- **Credentials.** Do not ask for a login up front. Use existing authenticated
  sessions or user-configured tools; the validator scripts never handle AEM
  credentials. If a browser request is rejected, ask the developer to sign in to
  that tab themselves; then continue. Never assume a default password, never ask
  for the value in chat, and never put credentials in CLI flags, logs, evidence,
  reports, files or screenshots of login screens.
- For **each** selected template pick one representative **existing** page on the
  source that uses the static template, with real content. The target page is that
  same page path, copied to the SDK and converted by AEM Modernize Tools; never an
  independently authored page. Never guess a page URL or silently omit a template.
- The source is read-only: read pages with GET requests only. If no source page uses
  the static template, ask for one or explicit permission to create a fixture under
  a dedicated test parent on the source. Writes to the target (page import,
  conversion, cleanup) are covered by the single deployment approval. Require
  working creation **and deletion** tools before creating anything. Record exact
  paths and ownership. Never modify existing pages,
  delete a test parent recursively or copy protected JCR properties blindly.
  Deployment/fixtures can activate customer listeners, so verify side-effect
  isolation before either action.

## 1a. Resolve the Static Baseline

validate-migration runs **after** the migration skill, so the customer's working tree holds the
migrated code and is not the baseline. Never revert, check out or stash in that tree.
Do this step only after section 2's target deployment and bundle check pass.

1. **Source already has it.** Read-only check that the selected `/apps/...` static
   template exists on the source and a page uses it. If so, use that source as-is.
2. **Otherwise rebuild the pre-migration code.** Pick the baseline ref: the user's
   named commit/tag; else `HEAD` when the migration changes are still uncommitted;
   else `git merge-base HEAD origin/main` (fallback `main`). Confirm
   that ref still contains the static template (`git ls-tree -r <ref> -- <path>`); if
   not, ask for the correct ref. Create a separate checkout with
   `git worktree add --detach <temp-dir> <ref>`, build its packages there and, with
   approval, deploy them to the **source URL only** using the project's install
   profile. Never deploy migrated packages to the source, or baseline packages to
   the target. Remove the temporary worktree with `git worktree remove <temp-dir>`
   afterwards; leave the source deployment in place unless the user asks otherwise.
3. **Create the static page.** If no representative static page exists on the
   source, follow the fixture rules above to create one from the static template,
   with the same authored content later used for the editable page on the target.

Record the baseline ref, its commit SHA and the source package SHA-256 alongside
the evidence. If neither an existing source baseline nor a buildable pre-migration
ref is available, stop and report the blocker; do not compare against the target alone.

## 2. Build and Deploy Only to Target

Run from the selected content module, retaining actual CAM project flags:

```bash
node "$VALIDATOR/check.js" --stage prepare --pattern custom-templates \
  --project <content-module> --template /conf/<site>/settings/wcm/templates/<name> \
  --template-mode runtime
```

Preparation builds/discovers the content package and persists the runtime requirement.
It does **not** deploy templates. Inspect the project's supported package-install
profile and deploy the required application, template, policy and asset packages
to the **target URL only**, using the project's credentials/settings. Installing a
Java bundle alone is insufficient; `deploy.js` is bundle-oriented and is not a
template package installer. Never call it with a content ZIP or invent profile flags.
Confirm the executed deployment's success and the target's selected template before
capturing. If the install profile rebuilds packages, use the final deployed package
path and SHA-256, not an earlier build. Do not change customer source or deployment
configuration to obtain a pass. A deployment failure blocks comparison.

**Bundle state comes first.** Read each project bundle's `Bundle-SymbolicName` from
its built jar, call MCP `diagnose-osgi-bundle` against the target SDK, and record
the exact states in `deployment.bundles`. Every bundle must be `Active` before
resolving the baseline (1a) or creating/comparing any page; a non-Active bundle
fails the run as `runtime.bundle_not_active`. Use the main skill's bounded
activation checks and recovery rules; never mark a state you did not observe.

## 3. Compare Equivalent Pages

First put the source page on the target and convert it:

- Read the source page with `<page>/jcr:content.infinity.json` (GET only). Strip
  repository-managed properties (`jcr:created*`, `jcr:lastModified*`, `jcr:uuid`,
  versioning and `cq:lastReplicated*`) and import it at the **same path** on the
  target with Sling POST `:operation=import`, `:contentType=json`. If that path already
  exists on the target, stop and ask; never overwrite. Copy referenced DAM assets the
  same way only when the target lacks them.
- Run the AEM Modernize Tools structure conversion for that page path, using the
  rewrite rules deployed in section 2. If Modernize Tools or the rules are not on the
  target, stop and report; never convert by hand.
- Confirm the target page's `cq:template` is now the selected `/conf/...` template.
  The imported page is a fixture owned by this run and is deleted during cleanup.

Then compare:

1. Read the source and target page content and actual template assignments through
   approved read-only tools. Include inherited editable-template structure when
   constructing the target's **effective** component inventory; do not double-count
   the same node from page content and template structure. Traverse layout containers
   but exclude the layout wrappers themselves from component counts. Record explicit
   source-to-target resource-type mappings for legitimate component replacements;
   no fuzzy name matching or silent suppression of missing components.
2. Open both pages with `wcmmode=disabled` in matching browser contexts. Record real
   HTTP status, nonblank rendered content, visible text and rendered image references.
   Collect whitespace-normalized visible text tokens with multiplicity, and canonical
   image/DAM identities after documented rendition normalization. Verify actual image
   loading; having an `img` tag is insufficient. Capture browser/page errors and treat
   relevant errors as failed rendering evidence. Never trigger customer business actions.
3. Use identical desktop and mobile viewports (for example 1440x900 and 390x844).
   Wait for fonts and images to load; capture full-page PNGs covering below-the-fold
   components. Keep locale, content, personalization and browser settings equivalent.
   Dynamic masks or tolerated differences require explicit approval and must be
   recorded; never mask a component whose preservation is being tested.
  Default to device scale factor 1; if another factor is required, record
  `device_scale_factor` on each capture so PNG dimensions can be validated.
4. Actually inspect each source/target image pair with browser/vision tools for missing,
   hidden, clipped, reordered or overlapping components, typography, layout and broken
   images. Record `pass`, `fail` or `not_verified`, and concrete differences. Pixel
   differences alone do not establish a defect, and screenshots alone do not establish
   content preservation. An unperformed or inconclusive review cannot pass.
5. Clean up only fixtures owned by this run, even after deployment/rendering/comparison
   failures, using a `finally`-equivalent workflow. Confirm deletion. Preserve existing
   pages and local screenshot/report artifacts. Failed cleanup fails the run. The
   imported target page is always in `created_pages`; record `completed` only after
   its confirmed deletion.

## 4. Save Actual Evidence and Verify

Save credential-free evidence beside the screenshots in the content module's
`.validate-migration/` directory. Use an absolute evidence path for the CLI and
relative PNG paths inside the evidence. The fields below are a **schema example,
not a successful observation**; replace them only with actual tool results.

```json
{
  "template": "/conf/<site>/settings/wcm/templates/<name>",
  "artifact_sha256": "<SHA-256 of final deployed content package>",
  "captured_at": "<actual ISO timestamp after deployment and comparison>",
  "deployment": { "target_origin": "http://localhost:4602", "status": "not_verified",
    "bundles": [{ "symbolic_name": "<Bundle-SymbolicName>", "state": "<state reported by MCP>" }] },
  "source": {
    "url": "http://localhost:4502/content/<source>.html?wcmmode=disabled",
    "template": "/apps/<site>/templates/<static-template>",
    "status": 0,
    "components": ["<observed non-layout resource type; repeat for each instance>"],
    "texts": ["<observed visible text token; preserve counts>"],
    "images": ["<canonical rendered image reference>"]
  },
  "target": {
    "url": "http://localhost:4602/content/<target>.html?wcmmode=disabled",
    "template": "/conf/<site>/settings/wcm/templates/<name>",
    "status": 0,
    "components": ["<observed target resource type; repeat for each instance>"],
    "texts": ["<observed visible text token; preserve counts>"],
    "images": ["<canonical rendered image reference>"]
  },
  "component_mapping": {},
  "captures": [
    { "viewport": { "width": 1440, "height": 900 }, "source": "source-desktop.png", "target": "target-desktop.png", "result": "not_verified", "differences": [] },
    { "viewport": { "width": 390, "height": 844 }, "source": "source-mobile.png", "target": "target-mobile.png", "result": "not_verified", "differences": [] }
  ],
  "cleanup": { "status": "not_verified", "created_pages": ["/content/<same-page-path-on-target>"] }
}
```

Set deployment `status` to `succeeded` only after the actual target package install.
HTTP `status` values must be the observed responses. Set each capture's `result`
only after image review; all reviews must pass without unexplained differences.
For fixtures record every created path and use cleanup `completed` only after
confirmed deletion, otherwise `failed`. Record approvals, normalization/mapping
rationale, browser errors, masks, tolerances and coverage limitations alongside
the evidence. Do not reuse screenshots/evidence from a prior run or different build.
Both the observation timestamp and screenshot files must belong to this prepared
run, after the final package build. The CLI decodes PNGs and validates their actual
width and minimum full-page height against the declared viewport and scale factor.

```bash
node "$VALIDATOR/check.js" --stage verify --pattern custom-templates \
  --project <content-module> --template /conf/<site>/settings/wcm/templates/<name> \
  --template-evidence <absolute-path-to-template-evidence.json> \
  --static-template /apps/<site>/templates/<static-name> --baseline-ref <ref>
```

For multiple templates the evidence document may instead be
`{"templates": {"/conf/<site>/settings/wcm/templates/<name>": {"template": "...", "...": "..."}}}`,
with a complete, independently captured entry for every selected template. Never
copy one passing entry to cover siblings. The verifier checks package freshness,
instance/template selection, deployment confirmation, real screenshot file presence,
source component counts/text/images preserved on target, visual review results and
cleanup. The browser agent performs image analysis; the CLI does not do pixel diffs.
Extra target content, full authoring behavior, editor policies and business behavior
are not proven by this preservation check. Report that coverage boundary explicitly.

## 5. Report, Submit and Finalize

The normal verify command saves each template's Markdown/JSON report and emits its
MCP outcome with runtime evidence, differences, screenshot references and cleanup
status. A package-only pass cannot substitute for requested runtime validation.
Missing evidence is unverified/failed, never fabricated runtime success. On a
blocked run without browser evidence, retain the package report and explain the
blocker; never claim successful rendering or invent a screenshot result.

Use the main skill's Submit and Finalize steps for every final template outcome,
including failures. Screenshots remain local; references in an outcome do not upload
the image bytes. Require the actual matching MCP acknowledgement before claiming
the outcome was recorded. It does not prove downstream event delivery. No live
instance, page, submission or cleanup operation is performed merely by editing this reference.