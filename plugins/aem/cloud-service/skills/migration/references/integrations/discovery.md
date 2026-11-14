# Integration Discovery (`integrationDiscovery`)

Read-only inventory of the external integrations an AEM codebase uses. It runs as part of the
Step 0 migration runbook (strategy `integration-scan`) and is **detection only**: it proposes no
remediation, invokes no apply workflow, and is not a migration pattern.

- Scanner: [`scripts/integration-scanner.js`](../../scripts/integration-scanner.js)
- Signatures: [`catalog.json`](catalog.json) (the only place vendor signatures are defined)
- Output: the **Integration Discovery** section of `migration-runbook.md` and the top-level
  `integrationDiscovery` field of `migration-runbook.json`

## When it runs

Every `node scripts/runbook-generator.js <workspaceRoot> …` run scans the workspace, with or
without BPA/CAM data and without a Cloud Service environment. BPA reports carry no integration
subtypes, so BPA is not consulted. Standalone: `node scripts/integration-scanner.js <workspaceRoot>`.

## What is scanned

| File kind | Files | Comment handling |
|---|---|---|
| Java | `*.java` | `//`, `/* */` removed (string literals kept) |
| Maven | `pom.xml` (`<dependency>` coordinates only) | `<!-- -->` removed |
| npm | `package.json` (`dependencies`, `peerDependencies`; not `devDependencies`) | — |
| OSGi | `*.cfg.json`, `*.config`, `*.cfg`, `sling:OsgiConfig` `.content.xml` | JSON / `#` comments removed |
| Config | `*.properties`, `*.json`, `*.xml`, `*.yaml`/`*.yml` | per format |
| Front end | `*.js`, `*.ts`, `*.jsx`, `*.tsx`, `*.mjs`, `*.cjs` (not `*.min.js`), `*.html`, `*.htm`, `*.jsp` (HTL/JSP) | JS / HTML / JSP comments removed |
| Dispatcher / CDN | `*.any`, `*.vhost`, `*.farm`, `*.rules`, `*.conf`, `*.vcl` | `#` comments removed |

Skipped: hidden directories (`.git`, `.idea`, …), `node_modules`, `bower_components`, `target`,
`dist`, `build`, `out`, `coverage`, `src/test`, `src/it`, `tests`, `__tests__`, `ui.tests`,
`it.tests`, `docs`, `doc`, `samples`, `examples`, lockfiles, and files larger than 1 MB (counted
in a warning). Symlinks are not followed. Markdown and other documentation are never scanned.
JS files with any line longer than 2000 characters are treated as minified/bundled output (for
example `ui.frontend` builds copied into `ui.apps` clientlibs, which inline vendor libraries) and
skipped; they are counted in `summary.minifiedSkipped`, not reported as a warning.

## Signals

Each catalog signal has a `strength`:

| Strength | Meaning | Example |
|---|---|---|
| `strong` | Vendor-distinctive usage | `import software.amazon.awssdk.services.s3`, `recaptcha/api/siteverify` |
| `supporting` | Vendor-specific but not proof of use on its own | Fastly / CloudFront headers, Jira REST Java client import |
| `contextual` | Generic term; only corroborates | `jira.*` / `pim.*` config keys, `*.atlassian.net` |
| `dependency` | Declared dependency, no proof of use | `com.amazonaws:aws-java-sdk-s3` |

Generic words (`target`, `jira`, `s3`, `pim`, `workday`, `commerce`) are never signals on their own.

## Confidence

Scoring counts **distinct signal ids** per integration, never occurrences. When several signals of
one integration match the same line, only the strongest counts, so a single line cannot
corroborate itself.

| Confidence | Rule | Status |
|---|---|---|
| `high` | ≥1 strong signal **and** ≥2 distinct signals | `detected` |
| `medium` | exactly one strong signal, or a supporting signal plus another distinct signal | `detected` |
| `low` | a single supporting signal, or dependency-only evidence | `candidate` |
| _not reported_ | contextual signals only, or fewer than the integration's `minDistinctSignals` | — |

`minDistinctSignals: 2` marks integrations that must be corroborated (PIM). Low-confidence rows are
candidates that need manual confirmation, not confirmed integrations.

## Unknown external APIs

An external URL is reported as **Custom External API** (category `customer-external`) when it
appears:

- in a Java file that imports an HTTP client (`http-client-endpoint`) or SOAP client (`soap-client-endpoint`);
- in a JS file that makes HTTP calls (`fetch`, `XMLHttpRequest`, `axios`, `$.ajax`, …) (`js-http-endpoint`);
- as the value of an endpoint-like key (`*url*`, `*endpoint*`, `*host*`, …) in an OSGi configuration (`osgi-endpoint-config`).

Findings are grouped by host and scored with the same rules (all generic signals are `supporting`,
so unknown APIs are at most `medium`). The vendor is never guessed. URLs are ignored when they are
on a line already attributed to a reported catalog integration, use a placeholder
(`${…}`, `{{…}}`, `$[env:…]`, string concatenation), point to loopback/dotless hosts, documentation or
XML-namespace hosts, or come from AEM-owned PIDs such as the Externalizer, Referrer filter and CORS
policies (see `genericExternalApi` in the catalog). SOAP is reported when a SOAP client is imported or
the URL ends in `?wsdl`, `.wsdl`, `.asmx` or `.svc`. RFC 1918 addresses and `.local`/`.internal`/
`.corp`/`.lan`/`.intranet` hosts add the `private-connectivity` consideration. A port other than
80/443 adds `non-standard-port`: AEM as a Cloud Service only allows HTTP/HTTPS egress on those
ports without advanced networking (flexible port egress plus port forwarding rules). Importing only
`org.apache.http` core classes (e.g. `HttpStatus`) is not treated as HTTP client usage.

## Output

```json
{
  "strategy": "integration-scan",
  "status": "complete",
  "catalogVersion": 1,
  "summary": { "total": 2, "known": 1, "unknown": 1, "detected": 2, "candidates": 0,
               "byConfidence": { "high": 1, "medium": 1, "low": 0 }, "filesScanned": 412, "minifiedSkipped": 0 },
  "integrations": [
    {
      "id": "aws-s3", "name": "AWS S3", "category": "third-party",
      "confidence": "high", "status": "detected",
      "signals": ["s3-sdk-v2-import", "s3-v2-maven-dependency"],
      "evidenceCount": 2,
      "evidence": [
        { "type": "maven-dependency", "signal": "s3-v2-maven-dependency", "strength": "dependency",
          "file": "core/pom.xml", "line": 41, "indicator": "software.amazon.awssdk:s3" },
        { "type": "java-import", "signal": "s3-sdk-v2-import", "strength": "strong",
          "file": "core/src/main/java/com/acme/StorageService.java", "line": 12,
          "indicator": "software.amazon.awssdk.services.s3" }
      ],
      "migrationConsiderations": ["external-connectivity", "credential-configuration", "binary-transfer"]
    },
    {
      "id": "external-api-3f9a1c2e", "name": "Custom External API (HTTP/REST)",
      "category": "customer-external", "confidence": "medium", "status": "detected",
      "protocol": "http", "host": { "fingerprint": "sha256:3f9a1c2e", "hint": "*.com", "private": false },
      "signals": ["http-client-endpoint", "osgi-endpoint-config"],
      "evidenceCount": 2, "evidence": [ "…" ],
      "migrationConsiderations": ["external-connectivity", "customer-review"]
    }
  ],
  "warnings": []
}
```

- `status` is `complete`, `partial` (at least one warning: malformed JSON, unbalanced
  `<dependency>`, unterminated comment, unreadable or oversized file), or `not-run` (missing
  workspace or catalog). A `partial` scan is never presented as clean.
- Records are deduplicated by integration id (unknown APIs by host fingerprint) and keep every
  evidence location, sorted by file, line and signal. Up to 100 evidence rows are stored per record;
  `evidenceCount` is always the full count and `evidenceTruncated: true` marks a capped list.
- Records are sorted by category (`adobe-product`, `third-party`, `customer-external`), then
  confidence, then id. Output contains no timestamps and is identical across runs.
- Warnings are kept in `integrationDiscovery.warnings`, separate from findings and from the
  runbook's pattern scan warnings.

## Security and privacy

- Local, read-only: no network calls, no endpoint is contacted, no customer code is executed or modified.
- Evidence holds only the workspace-relative path, line, signal type/id and the catalog's static
  `indicator`. Matched source text, URLs, query strings, credentials and config values are never stored.
- Unknown hosts are shown as `sha256:<8 hex>` plus their top-level domain. The fingerprint is stable,
  for correlating evidence across files. It is a redaction, not encryption: a known hostname can be
  checked against it.

## Extending the catalog

Add an entry to `catalog.json` with a stable `id`, a `category` (`adobe-product` only for Adobe
products), `migrationConsiderations` from the `considerations` map, and signals (`pattern` + `kinds`,
`pathPattern`, Maven `groupId`/`artifactId`, or npm `package`). Every integration needs a
positive-evidence fixture in `scripts/integration-scanner.test.js`; the test suite fails otherwise.

## Known limitations

- Line-based matching: a signature split across lines, or a URL built from concatenated constants
  in another class, is not detected.
- JS regex literals and multi-line template literals can confuse comment removal.
- Generic API detection needs the HTTP client and the URL literal in the **same** Java/JS file, or an
  endpoint-like OSGi key.
- Customer modules named `docs`, `samples`, `examples` or `tests` are skipped.
- Only deployed configuration in the repository is seen; integrations configured only in the JCR
  (e.g. `/conf` cloud configurations not in source control) are invisible.
- XML well-formedness is not fully validated; only unterminated comments and unbalanced
  `<dependency>` elements are flagged.
