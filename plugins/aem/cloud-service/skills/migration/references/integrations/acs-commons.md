# ACS AEM Commons — third-party integration (report only)

ACS AEM Commons is an open-source library maintained outside Adobe's AEM product. It is **not** an out-of-the-box AEM component, so on a move to AEM as a Cloud Service it is a **third-party integration the customer owns**.

## The rule

- **Report**: the version in use, whether the Cloud Service package is used, and every ACS Commons feature the project relies on.
- **Recommend**: upgrading to a release that supports AEM as a Cloud Service, and reworking features that do not apply there.
- **Never** change the dependency version, OSGi configs, Java code or content that use ACS Commons. Customer processes and customisations built on it can break; the upgrade and any rework are custom development outside the migration skills.
- Keep flagging ACS Commons findings that appear in BPA or other categories, so the delivery team knows the extra work.

## How it is detected

`scripts/acs-commons-scan-runner.js` (pattern `acsCommons`, part of the Step 0 runbook; also runnable on its own with `node scripts/acs-commons-scan-runner.js <workspaceRoot>`). Read-only text scans, so every row is a candidate to confirm:

| Source | What is found |
|---|---|
| `pom.xml` | `com.adobe.acs:acs-aem-commons-*` in `<dependency>`, with the version (a `${property}` is resolved from the same pom) and the classifier. A missing `cloud` classifier is flagged only when the pom shows it; a version and classifier managed by another pom, or a classifier from a property defined elsewhere, is reported as unknown, to confirm. |
| Java | `import com.adobe.acs.commons.<feature>…`, one row per feature with the number of files |
| OSGi configs | `com.adobe.acs.commons.*` PIDs in config folders, one row per feature |
| Content | `sling:resourceType="acs-commons/…"` in `jcr_root` XML, and the number of Redirect Manager rules |
| BPA report (when one is loaded) | Findings of any BPA pattern whose class, file or bundle is ACS AEM Commons itself (`com.adobe.acs.*`, `acscommons.*`, `acs-aem-commons-*` bundles), one **informational** row per BPA pattern and bundle. They stay in their own pattern's section too, so they are not counted twice. |

## What to tell the customer, per finding

| Finding | What it typically needs on AEM as a Cloud Service |
|---|---|
| `acs-aem-commons-all` without the `cloud` classifier | On Cloud Service the container package embeds `acs-aem-commons-all` (ACS Commons 6.0.0 and later) with the `cloud` classifier. Upgrade and re-test. |
| `acs-aem-commons-content` (before 6.0.0) or the older `-ui.*` packages | Renamed to `acs-aem-commons-all` in 6.0.0: replace it with `-all` (`cloud` classifier) as part of the customer-owned upgrade. |
| `acs-aem-commons-bundle` | Still the dependency for ACS Commons Java APIs (`provided` scope); keep it and align its version with the `-all` package. |
| Redirect Manager (with rule count) | Supported in current releases; migrate and verify every rule. |
| Redirect Map Manager | Redirect maps usually move to Dispatcher or CDN rewrites; verify each rule. |
| Manage Controlled Processes (MCP) | Review each process; long-running bulk jobs need re-testing. |
| Ensure Service User | Typically replaced by **repoinit** for service users and permissions. |
| Ensure Oak Index | Not supported on Cloud Service: deploy index definitions under `/oak:index` instead (see the code-assessment `tuning-oak-query-indexes` skill). |
| Replication / Dispatcher flush utilities | Cloud Service has no replication agents (Sling Content Distribution); review flush and replication use. |
| Versioned ClientLibs | Not supported on Cloud Service, which versions client library URLs itself; remove it. |
| HTTP Cache | Cloud Service relies on the CDN and Dispatcher cache; review. |
| Email service | Outbound email needs advanced networking on Cloud Service; review. |
| Any other feature | Check it against the ACS AEM Commons documentation for AEM as a Cloud Service. |

These are starting points, not a compatibility guarantee: confirm each feature against the ACS AEM Commons documentation for the version the customer upgrades to.

Sources for the package rows: the [ACS AEM Commons Maven guide](https://adobe-consulting-services.github.io/acs-aem-commons/pages/maven.html) (the 6.0.0 rename of `acs-aem-commons-content` to `acs-aem-commons-all`, the `cloud` classifier, `acs-aem-commons-bundle` as `provided`) and the [published `acs-aem-commons-all` versions](https://repo1.maven.org/maven2/com/adobe/acs/acs-aem-commons-all/maven-metadata.xml), which start at 6.0.0.

## Output

The runbook section **ACS AEM Commons (third-party)** lists each finding with its location and what it needs, marked *Report only — third-party, customer-owned*. Put the same list in the migration runbook handed to the customer under third-party integrations, with an effort note per feature (for example "Redirect Manager: 1,240 rules to migrate and verify").
