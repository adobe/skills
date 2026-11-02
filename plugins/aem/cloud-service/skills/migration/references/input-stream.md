# `java.io.InputStream` usage on AEM as a Cloud Service

BPA pattern id: **`inputStream`** (Best Practices Analyzer code `DG`, subtype **`java.io.inputstream`**, importance `ADVISORY`). This is a migration reference, not a `code-assessment` pattern: BPA raises it for code carried over from AEM 6.x, AMS or on-premise. Detection is done by the deterministic scanner [`scripts/input-stream-runner.js`](../scripts/input-stream-runner.js) (pure Node: no JDK, no `rg`, no LLM scan).

## What Adobe says

- **[BPA `DG` documentation](https://experienceleague.adobe.com/en/docs/experience-manager-pattern-detection/table-of-contents/dg):** streaming binary data with `java.io.InputStream` can consume memory to the point of impacting performance, because containers on AEM as a Cloud Service have limited memory. The recommended solution is **direct binary upload**: [`aem-upload`](https://github.com/adobe/aem-upload) for assets, and the same pattern for other binaries.
- **[AEM as a Cloud Service development guidelines](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/development-guidelines):**
  - *No streaming binaries through AEM.* Access binaries through the CDN. For example, don't use `asset.getOriginal().getStream()`, which downloads the binary onto the instance's ephemeral disk.
  - *State on the filesystem.* The disk is ephemeral. Temporary files for a single request are fine, but not for huge files. On the Publish tier, data that must persist is shipped to an external service.
  - *Cluster-aware code.* Old and new code run side by side during updates.
  - *No native binaries.*

So the finding is mainly about **binaries passing through the JVM**. BPA reports every use of the stream types in application code, though, so most sites are harmless and the skill's job is to find the risky ones. Closing streams (category **B**) is hygiene: worth doing, but it doesn't resolve the binary-streaming risk on its own.

In BPA reports, the `other` column names the stream type, for example `java.io.InputStream`, `java.io.FileInputStream`, `java.io.ObjectInputStream` or `java.io.InputStreamReader`.

## Discovery: BPA first, local scan as the fallback

The precedence is the same as for the other migration patterns:
1. The **Step 0 runbook cache** (`migration-runbook.json`, `findingsByPattern.inputStream`), when it exists.
2. **BPA findings:** CAM via `fetch-cam-bpa-findings-by-pattern` with `pattern: "inputStream"`, then a BPA CSV.
3. The **local scan** of the whole workspace, only when BPA has no `inputStream` findings (no BPA source, or none reported).

BPA names classes, never lines, so the scanner runs in every case. Run it from the skill's `scripts/` folder:

```bash
# CAM targets: write the tool's targets to a JSON file ([targets] or { "inputStream": [targets] })
node scripts/input-stream-runner.js <workspaceRoot> --bpa-json ./cam-input-stream.json --json > input-stream.json
# BPA CSV (used when there are no CAM targets)
node scripts/input-stream-runner.js <workspaceRoot> --csv ./reports/bpa.csv --json > input-stream.json
# Neither: the local scan of every src/main/java file
node scripts/input-stream-runner.js <workspaceRoot> --json > input-stream.json
```

Both options can be passed at once: CAM targets win over the CSV, and the CSV over the local scan. The JSON output's `source` field (`cam`, `csv` or `local-scan`) says which one was used.

The scanner:
1. Puts files in scope. **With BPA rows**, only the files of the reported classes. Nested classes (`Foo$1`) resolve to `Foo.java`, and stream usage elsewhere in the workspace is out of scope. **Without BPA rows**, every `src/main/java/**/*.java` file. Either way it skips `src/test`, `target/` and `node_modules`, and comments and string literals can't produce matches.
2. Finds each **stream acquisition site** in those files and pre-classifies it (**A–F**, below) with a **fix kind**: `decision`, `review`, `auto` or `none`.
3. Emits **one finding per file** (the unit you edit), ordered by risk. Each finding carries `sites: [{ line, snippet, categories, primary, fix, severity, source, variable, note, handoff? }]` and `fix: { decision, review, auto }` totals. Files of BPA-reported classes are marked `bpa`.
4. Reports BPA rows it can't turn into file findings:
   - **Customer code not in the workspace** (`kind: "missing-source"`, plus a warning): the bundle has other classes in the workspace, or its packages share the workspace's package namespace. Fix it in the repository that builds it: open that repository and re-scan.
   - **Platform-provided** (`kind: "platform-provided"`): AEM Forms add-on bundles (`adobe-aemfd-*`, `adobe-aemds-*`, `forms-foundation-*`, `xfa4j`) or, for rows without a bundle name, its packages (`com.adobe.fd`, `com.adobe.aemfd`, `com.adobe.aemds`, `com.adobe.xfa`, `com.adobe.pdfg`, `com.adobe.forms`). On AEM as a Cloud Service, Adobe provides them when the Forms add-on is enabled in Cloud Manager ([onboarding](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/forms/setup-configure-migrate/setup-forms-cloud-service)). Don't deploy or edit them.
   - **Third-party** (`kind: "not-in-workspace"`): other vendor code. Upgrade to a release that supports AEM as a Cloud Service, or replace it. For ACS AEM Commons, that's the `acs-aem-commons-all` package with the `cloud` classifier ([setup](https://adobe-consulting-services.github.io/acs-aem-commons/pages/maven.html)). Never edit vendored code.
   - **BPA class found, but no stream usage in its source** (`kind: "bpa-unmatched"`): BPA analyses compiled classes, so a use may not be visible in source (for example a stream passed straight from one library call to another). The hint names same-package files that use streams.

   Rows from a BPA CSV are grouped per bundle. CAM rows carry class names only, so they're grouped per package, and libraries embedded in a vendor or add-on bundle appear under their own package.

Rows with `informational: true` (benign-only files and the BPA-only kinds above) are **not** outstanding work. Report them, but don't build edit batches from them.

**Batching:** one batch is **five files**, taken from the non-informational findings in the scanner's order, so the highest-risk files come first.

## Classification

The scanner's category is a **lead, not the verdict**. Read each site and confirm it before editing. Categories, highest priority first:

| # | Category | What the scanner looks for | Action | Fix kind |
|---|---|---|---|---|
| **F** | **Java deserialization** | `new ObjectInputStream(…)` or any `*ObjectInputStream` subclass (`ValidatingObjectInputStream`, …). **Critical** when the same method reads request, parameter, cookie, header or Base64 input. | If you own the format, replace it. If you don't (data written by AEM, a product feature or a library), add an `ObjectInputFilter` allow-list (**R6**). Never deserialize untrusted input. | `decision` |
| **E** | **Binary streamed or processed in the JVM** | DAM binary reads (`asset.getOriginal().getStream()`, `rendition.getStream()`, an asset resource adapted to `InputStream`); a repository binary copied to the response; a client upload written into the repository; asset processing in a workflow step; a stream in a method that starts a native process (`ProcessBuilder`, `Runtime.exec`, AEM's FFmpeg helpers). Other streams in the same class aren't marked E: the process is reported on the file's finding (`nativeProcessLines`) instead. | Deliver through the CDN, upload with direct binary upload, move asset processing to asset microservices (**R5**) | `decision` |
| **D** | **Local filesystem** | `FileInputStream`, `Files.newInputStream`, `FileUtils.openInputStream` on a hard-coded path, or without signs of per-request temp-file use (a temp file or directory, a working directory, the file deleted after use). The note lists local-filesystem writes in the same file. | Move the data **and the code that writes it** (**R4**) | `decision` |
| **C** | **Unbounded in-memory read** | Whole-stream reads (`toByteArray`, `toString`, `readLines`, `readAllBytes`, `lines()`, a copy into a `ByteArrayOutputStream`, parsing a request body) of a source with unknown size and no read limit. A Content-Length check is not a limit. Only reported when F, E and D don't apply, because their fixes replace the read. | Stream it (**R2**) or limit the read (**R3**) | `review` |
| **B** | **Unclosed stream or undisposed JCR `Binary`** | A stream opened in the method that isn't in try-with-resources, closed (directly or through a wrapper), returned, kept on a field, or handed to a callee that keeps it (a setter, map or builder), closes it (JCR `createBinary`) or is a same-file method that does either. A `Binary` from `getBinary()` that is never disposed. When the stream goes to an unknown callee, the note names it. An HTTP entity's content (`entity.getContent()`) belongs to the response, so an inline read of it isn't flagged. | Try-with-resources and `Binary.dispose()` (**R1**) | `auto` |
| **A** | **Benign** | Closed properly; a small bundled resource; `ByteArrayInputStream`; the container-owned `request.getInputStream()` with a read limit; a wrapper over the caller's stream; the type used only in a signature | **No change.** Record `reviewed-no-change`. | `none` |

Rules:
- A site can carry several categories (for example `C+B`). Its fix kind is the most demanding one.
- `InputStreamReader` / `BufferedReader` wrappers take the **underlying** stream's category.
- **Never** rewrite an **A** site just to drop the `InputStream` type. That only creates churn.
- **Tier first for D and E.** Before proposing a fix, find where the code runs: author, publish or both (run-mode-specific OSGi configs such as `config.author` / `config.publish`, servlet registrations; workflow steps run on author). The right home for persisted data differs by tier (**R4**, **R5**).

## Resolution contract

- **`auto` (B)** is self-evident: apply **R1** without asking. First confirm that the method really owns the stream (re-read the note when it names a callee).
- **`review` (C)** is self-evident only when a safe limit is clear from context (a config file, a JSON payload, an existing constant). Otherwise propose a limit and ask.
- **`decision` (D, E, F)** **requires the user's decision**: where the data lives, whether the client changes, which serialization format to use. Present the finding, the risk and a concrete proposal that fits the code's tier. **Do not edit** until the user confirms.

## Recipes

### R1: try-with-resources and `Binary.dispose()` (category B)

```java
// BEFORE
InputStream in = getClass().getResourceAsStream("/mapping.properties");
Properties mapping = new Properties();
mapping.load(in);
```

```java
// AFTER
Properties mapping = new Properties();
try (InputStream in = getClass().getResourceAsStream("/mapping.properties")) {
    mapping.load(in);
}
```

- Declare every stream that the method opens in the `try (…)` header, including wrappers (`InputStreamReader`, `BufferedReader`).
- Don't close streams the method didn't open, such as a stream passed in as a parameter or `request.getInputStream()`. The caller or the container owns those.
- If the method already closes the stream in a `finally` block (`IOUtils.closeQuietly(in)`), replace that with try-with-resources. Don't keep both.
- A JCR `Binary` from `property.getBinary()` must be disposed of as well:

```java
Binary binary = property.getBinary();
try (InputStream in = binary.getStream()) {
    // …
} finally {
    binary.dispose();
}
```

### R2: stream it instead of reading it whole (category C)

Parse or copy from the stream rather than building a `String` or `byte[]` first. For example, for a JSON response from an external service:

```java
// BEFORE: the whole body is read into a String before parsing
String body = IOUtils.toString(connection.getInputStream(), StandardCharsets.UTF_8);
Result result = objectMapper.readValue(body, Result.class);
```

```java
// AFTER: Jackson reads from the stream
Result result;
try (InputStream in = connection.getInputStream()) {
    result = objectMapper.readValue(in, Result.class);
}
```

Line-oriented data (CSV, redirect maps) can be processed one line at a time with a `BufferedReader`. Don't stream DAM binaries through the JVM at all: see **R5**.

### R3: limit the read (category C)

When the whole payload is genuinely needed, read at most `max + 1` bytes and reject anything larger, so oversized input fails instead of being silently cut off:

```java
private static final int MAX_BYTES = 1024 * 1024; // tune to the real payload

static byte[] readAtMost(InputStream in, int maxBytes) throws IOException {
    byte[] data = in.readNBytes(maxBytes + 1); // Java 11+
    if (data.length > maxBytes) {
        throw new IOException("Payload exceeds " + maxBytes + " bytes");
    }
    return data;
}
```

- **Content-Length is not a limit.** It is client-supplied and is `-1` for chunked requests. Use it to reject early if you like, but still limit the read.
- **`BoundedInputStream` alone is not enough.** It stops at the limit without an error, so oversized input is silently truncated. If you use it, read one byte past the limit and reject.
- For repository binaries the server-side size can be trusted: check `Binary.getSize()` or `Rendition.getSize()` before reading (and dispose of the `Binary`, **R1**).
- Keep the limit in a named constant, or in an OSGi config property when the module already uses `@Designate` configs.

### R4: local filesystem (category D)

Find the code that **writes** the file first (the scanner lists writes in the same file; otherwise search the workspace for the path or its constant). That is the state that has to move.

| What the file holds | Move it to |
|---|---|
| Static data shipped with the code (lookup tables, templates, certificates without secrets) | A **bundle resource** (`src/main/resources/…`), read with `getClass().getResourceAsStream("/…")`, which is then category **A** |
| Environment-specific configuration | An **OSGi config** (`ui.config`). Secrets go to Cloud Manager via **Branch A** ([osgi-cfg-json-cloud-manager.md](osgi-cfg-json-cloud-manager.md)) |
| Data written at runtime, on **author** | The **repository**: `/conf/<app>/…` (configuration), `/var/<app>/…` (operational data) or DAM (binaries) |
| Data written at runtime, on **publish** | An **external store**. Adobe's guidance is that the Publish tier ships data that must persist to an external service, and that publish instances share data through an external store; reverse replication to author isn't supported |
| Temporary files within a **single** request or job | `File.createTempFile(…)`, deleted in `finally`. Not for huge files (they count against disk limits), and never relied on after the request |

Present the target location and how the data gets there (content package, `repoinit`, a one-time migration, or the external service's API), then wait for confirmation.

### R5: binaries (category E)

- **DAM binaries read in the JVM** (`asset.getOriginal().getStream()`, renditions): avoid them, per Adobe's guidelines.
  - To show or download an asset, reference its URL and let the CDN deliver it.
  - To process assets (renditions, metadata extraction, transcoding), use [asset microservices](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/asset-microservices-overview): processing profiles, or a custom [Asset Compute](https://experienceleague.adobe.com/en/docs/asset-compute/using/extend/understand-extensibility) application. Workflow steps that read originals move there.
  - If a read has to stay (a small rendition or a small text asset), confirm the size, limit the read (**R3**) and record the decision.
- **Downloads:** don't proxy binaries through a servlet. Redirect to the asset's path so the CDN serves it. For authenticated downloads on author, a direct download URI from Oak (`BinaryDownload#getURI(BinaryDownloadOptions)`) is an option. It returns `null` when the repository doesn't support direct download (for example the local SDK), so keep a fallback; the signed URL also bypasses the CDN.
- **Uploads:**
  - Assets: direct binary upload ([`aem-upload`](https://github.com/adobe/aem-upload)). When the server code calls `AssetManager.createAsset(path, InputStream, …)` (sites with `handoff: "asset-manager"`), **hand off to `{code-assessment}/asset-manager/SKILL.md`**.
  - Other binaries on author: Oak [direct binary upload](https://jackrabbit.apache.org/oak/docs/features/direct-binary-access.html). `JackrabbitValueFactory#initiateBinaryUpload` returns upload URIs for the client; `completeBinaryUpload(uploadToken)` then returns the `Binary` to store. `initiateBinaryUpload` returns `null` when the repository doesn't support it (for example the local SDK), so keep a fallback.
  - On publish: send uploads to an external store (**R4**).
- **Native processes** (`ProcessBuilder`, `Runtime.exec`, AEM's FFmpeg helpers such as `FFMpegWrapper`): native binaries can't be deployed to AEM as a Cloud Service. For transcoding or other asset processing, move the work to asset microservices; for anything else, confirm the command exists on AEM as a Cloud Service or move the processing to an external service.
- Each of these changes the client-server contract or the processing pipeline. List the callers you found (HTL, JavaScript, integrations, workflow models) and get sign-off.

### R6: `ObjectInputStream` (category F)

- **You own the format:** replace it with a typed DTO serialized as JSON (Jackson `ObjectMapper` is available on AEM as a Cloud Service), or plain JCR properties when the data lives in the repository.
- **You don't own the format** (written by AEM, a product feature or a library): keep Java serialization but restrict it with an allow-list ([serialization filtering](https://docs.oracle.com/en/java/javase/17/core/serialization-filtering1.html)). Commons IO's `ValidatingObjectInputStream` with `accept(…)` does the same.

```java
ObjectInputFilter filter = ObjectInputFilter.Config.createFilter(
        "maxdepth=5;java.util.HashSet;java.lang.String;!*");
try (ObjectInputStream ois = new ObjectInputStream(in)) {
    ois.setObjectInputFilter(filter);
    Object value = ois.readObject();
}
```

- If the bytes ever cross a trust boundary (request parameter, cookie, header, external system), report it as **security-critical**, even if the user defers the fix.

## Apply loop (per batch of five files)

Make surgical, formatting-preserving edits. Do not reformat, reorder imports or change unrelated code.
1. Open each file in the batch once. For every site in `sites`, read the code and **confirm or correct** the scanner's category.
2. Apply **R1** to every confirmed **B** site. Apply **R2** or **R3** to **C** sites when the resolution contract allows.
3. For **D, E, F**, determine the tier, write the proposal into the batch report and leave the code unchanged unless the user has already confirmed.
4. Add imports (`java.nio.charset.StandardCharsets`, `org.apache.commons.io.IOUtils`, `javax.jcr.Binary`) only when they are used. Remove imports that become unused.
5. **Verify** by re-scanning just the touched files. The re-scan fails (`ok: false`, exit code 2) when a requested file is missing or unreadable, naming it in `error` and `stats.skippedFiles`, so a mistyped path can't pass as clean; fix the path and re-run. Each fixed site must drop to `A` (or disappear), and the file's `fix.auto` total must reach 0:
   ```bash
   node scripts/input-stream-runner.js <workspaceRoot> --files core/src/main/java/…/Foo.java,core/src/main/java/…/Bar.java --json
   ```
6. Report the batch: sites fixed, sites `reviewed-no-change`, `needs-decision` proposals, and the remaining `fix` totals.

## Report rows

- `fixed: <file>:<line> (<category>)`: recipe applied and verified by the re-scan.
- `reviewed-no-change: <file>:<line>`: confirmed **A**, or a scanner lead you rejected after reading the code (say why).
- `needs-decision: <file>:<line> (<category>)`: **D / E / F** with a proposal for the code's tier, awaiting the user.
- **Customer code elsewhere:** each `missing-source` bundle. Ask the user to open that repository, then re-run the scanner.
- **Third-party:** each `not-in-workspace` bundle, with its class and row counts. Upgrade or replace it; don't edit it.
- **Platform-provided:** each `platform-provided` bundle. Nothing to change in code: confirm the Forms add-on is enabled and that the AEM 6.5 Forms add-on package isn't part of the deployment.
- **Unmatched BPA classes:** each `bpa-unmatched` file, with its hint.

## Review checklist

- [ ] Every site in the touched files is confirmed (A–F) and listed in the batch report.
- [ ] The `--files` re-scan of the touched files completed (`ok: true`, nothing in `skippedFiles`) and shows no remaining `auto` sites.
- [ ] Every stream the method opens is closed via try-with-resources, and every `Binary` from `getBinary()` is disposed. No stream the method doesn't own is closed.
- [ ] No whole-stream read of an asset, repository binary, request body or remote response remains without a read limit (a Content-Length check doesn't count).
- [ ] No DAM binary is read or proxied in the JVM without a recorded decision.
- [ ] Every D and E proposal names the tier and fits it (repository on author, external store on publish).
- [ ] `ObjectInputStream` sites are replaced, allow-listed, or reported as `needs-decision` (security-critical when the input is untrusted).
- [ ] Customer-elsewhere, third-party and platform-provided bundles are reported, not edited.
- [ ] `mvn clean install` passes for each touched module.

## Common pitfalls

- **Treating try-with-resources as the fix for the finding.** Closing streams is hygiene. The risk Adobe documents is binaries passing through the JVM (category **E**).
- **"Fixing" benign usages.** Swapping `InputStream` for `byte[]` or a `Reader` makes memory use worse and changes no risk. Leave category **A** alone.
- **Moving publish-side data into the repository.** On publish, data that must persist goes to an external store.
- **Treating a Content-Length check as a limit**, or trusting `BoundedInputStream` to reject oversized input.
- **Polishing code that must be redesigned**, such as stream fixes in a workflow step that reads originals or in a class that runs a native binary.
- **Closing a stream you don't own**, such as `request.getInputStream()` or a parameter stream.
- **Double close:** leaving `IOUtils.closeQuietly` in a `finally` after adding try-with-resources.
- **Editing vendored, shaded or platform-provided code.** Upgrade the dependency, or rely on the add-on.
- **Treating `/tmp` as storage.** Temp files are per-instance, per-request scratch space only.
- **Taking the scanner's category as final.** It's a regex classifier, not a compiler: read the code, and re-scan after editing.

## Test generation

For each changed production class, add or extend a unit test that pins the new behaviour. Match the module's existing JUnit 4/5 and `AemContext` setup (check its existing tests and `pom.xml` first; never mix JUnit versions):

- **R1:** the stream is closed after the call, including on the exception path (wrap a `ByteArrayInputStream` in a small subclass that records `close()`), and a `Binary` is disposed.
- **R2:** the result is the same for a payload larger than any previous buffer.
- **R3:** a payload over the limit is **rejected, not truncated**, including a request without a Content-Length; a payload exactly at the limit succeeds.

Do not generate tests for **D / E / F** until the user has confirmed the design.

## See also

- [AEM as a Cloud Service development guidelines](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/development-guidelines)
- [BPA `DG` documentation](https://experienceleague.adobe.com/en/docs/experience-manager-pattern-detection/table-of-contents/dg)
- [Asset microservices](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/asset-microservices-overview) and [Asset Compute extensibility](https://experienceleague.adobe.com/en/docs/asset-compute/using/extend/understand-extensibility)
- [Oak direct binary access](https://jackrabbit.apache.org/oak/docs/features/direct-binary-access.html)
- [`aem-upload`](https://github.com/adobe/aem-upload), the direct binary upload client
- `{code-assessment}/asset-manager/SKILL.md`: `AssetManager` uploads and Direct Binary Access
