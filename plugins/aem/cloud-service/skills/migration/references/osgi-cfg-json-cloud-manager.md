# OSGi configs: scan → Cloud Manager environment secrets / variables

**Agent:** The parent skill loads this file for prompts such as *"scan my config files and create Cloud Manager environment secrets or variables."* Users do **not** name this path.

The sections below through **Cloud Manager and deployment** reproduce the rules from **Adobe Experience Manager as a Cloud Service** product documentation for configuring OSGi (deploying topic: OSGi configuration with secret and environment-specific values). **Follow them when editing configs or advising on Cloud Manager.**

---

## OSGi in the AEM project

OSGi manages bundles and their configurations. Settings are defined in **configuration files that are part of the AEM code project**. Cloud Manager is used to configure **environment variables** that back OSGi placeholders.

### Configuration files (`.cfg.json`)

- Configuration changes belong in the project's code packages (**`ui.config`**) as **`.cfg.json`** files under **runmode-specific** config folders, for example under paths like **`/apps/<appId>/config.<runmode>/`** (in the content tree; in Maven this is commonly under **`ui.config`** / **`osgiconfig`**).
- The format is **JSON**, using the **`.cfg.json`** format defined by the **Apache Sling** OSGi configuration installer.
- OSGi configurations target components by **Persistent Identity (PID)**. The PID usually matches the **fully qualified Java class name** of the OSGi component implementation. Example file path:  
  `.../config/com.example.workflow.impl.ApprovalWorkflow.cfg.json`
- **Factory configurations** use the **`<factoryPID>-<name>.cfg.json`** naming convention.

**Superseded formats:** Older AEM versions allowed **`.cfg`**, **`.config`**, and XML **`sling:OsgiConfig`**. On AEM as a Cloud Service these are **superseded** by **`.cfg.json`**. See **Phase 0 — Legacy format conversion** below for conversion rules.

**Cloud runtime note:** On AEM as a Cloud Service, effective OSGi configuration is not held like a classic on-prem **`/apps`**-only model; use the environment's **Developer Console** (Status → Configurations in the status dump) to inspect what is applied.

### Runmodes (context for configs)

- **AEM 6.x** allowed **custom runmodes**; **AEM as a Cloud Service does not**. Only the **documented Cloud Service runmode set** applies. Differences between Cloud environments that runmodes cannot express are handled with **OSGi configuration environment variables** (`$[env:…]` / `$[secret:…]`).
- Runmode-specific folders live under **`/apps/<appId>/`** using names like **`config.<author|publish>.<dev|stage|prod>`** (and combinations such as **`config.author`**, **`config.author.dev`**). Configs apply when the folder's runmodes **match** the instance.
- If **multiple** configs apply to the **same PID**, the one with the **highest number of matching runmodes** wins. Resolution is at **PID** level: you **cannot** split properties for the same PID across two folders—one winning file applies to the **whole** PID.
- **Preview:** A **`config.preview`** folder is **not** declared like **`config.publish`**. The **preview** tier **inherits** OSGi configuration from **publish**.
- **Local SDK:** Runmodes can be set at startup, e.g. **`-r publish,dev`** on the quickstart JAR.

**Valid Cloud Service runmode tokens** (exhaustive):

| Token | Meaning |
|-------|---------|
| `author` | Author tier |
| `publish` | Publish tier |
| `dev` | Development environment |
| `stage` | Stage environment |
| `prod` | Production environment |

Valid **folder names** use combinations: `config`, `config.author`, `config.publish`, `config.dev`, `config.stage`, `config.prod`, `config.author.dev`, `config.author.stage`, `config.author.prod`, `config.publish.dev`, `config.publish.stage`, `config.publish.prod`. Any folder whose name does not match one of these (e.g. `config.qa`, `config.integration`, `config.local`, `config.ams`) is **invalid** on Cloud Service.

**Verifying effective config:** In Cloud Service, use **Developer Console** → select **Pod** → **Status** → **Status Dump** → **Configurations** → **Get Status**. Match **`pid`** to the **`.cfg.json`** filename and compare **`properties`** to the repo for the runmode under review.

---

## Types of OSGi configuration values

Three kinds (a single **`.cfg.json`** may mix them):

1. **Inline values** — hard-coded in JSON and stored in Git, e.g.  
   `{ "connection.timeout": 1000 }`
2. **Secret values** — must **not** be stored in Git, e.g.  
   `{ "api-key": "$[secret:server-api-key]" }`
3. **Environment-specific values** — vary between **development** environments in ways runmodes cannot target (Cloud Service has a single **`dev`** runmode), e.g.  
   `{ "url": "$[env:server-url]" }`

Example combining all three:

```json
{
  "connection.timeout": 1000,
  "api-key": "$[secret:server-api-key]",
  "url": "$[env:server-url]"
}
```

### When to use which type

- **Inline** is the **default**. Prefer inline when possible: values live in Git with history, deploy with code, and need no extra CM coordination. **Start with inline**; use secrets or env-specific placeholders **only when the use case requires it**.

**`$[env:ENV_VAR_NAME]` (non-secret)** — Use **only** when values differ for **preview vs publish** or **across development** environments (including local SDK and Cloud **dev**). For **Stage and Production**, **avoid** non-secret `$[env:…]` except where preview must differ from publish; use **inline** values in **`config.stage`** / **`config.prod`** for non-secrets. **Do not** use `$[env:…]` to push routine **runtime** changes to Stage/Prod without source control.

**`$[secret:SECRET_VAR_NAME]`** — **Required** for any **secret** OSGi value (passwords, private API keys, anything that must not be in Git). Use for **all** Cloud environments including **Stage and Production**.

### Custom code only — no Adobe override

**`$[env:…]`** must be used **only** for OSGi properties related to **customer custom code**. It **must not** be used to **override Adobe-defined OSGi configuration**. Treat **`$[secret:…]`** the same way for this skill: **do not** introduce placeholders on **Adobe/product** PIDs unless the user explicitly confirms an allowed exception.

### Repoinit

**Placeholders cannot be used in repoinit statements.** Do not add `$[secret:…]` or `$[env:…]` to **Repository Initializer** content. Skip **`org.apache.sling.jcr.repoinit.RepositoryInitializer*`** files for placeholder injection.

### Placeholder syntax

- Environment (non-secret): **`$[env:ENV_VAR_NAME]`**
- Secret: **`$[secret:SECRET_VAR_NAME]`**

If no value is set in Cloud Manager, the placeholder may remain unreplaced. **Default** (for both env and secret placeholders):

```text
$[env:ENV_VAR_NAME;default=<value>]
```

(with the same pattern for secrets when a default is appropriate per product behavior).

### Variable names and values (Cloud Manager)

Applies to **both** `$[env:…]` and `$[secret:…]` variable names:

| Rule | Requirement |
|------|-------------|
| Name length | **2–100** characters |
| Name pattern | **`[a-zA-Z_][a-zA-Z_0-9]*`** |
| Value length | Values **must not exceed 2048** characters |
| Count | **Up to 200** variables per environment |

**Reserved prefixes:** Names starting with **`INTERNAL_`**, **`ADOBE_`**, or **`CONST_`** are reserved—customer variables with those prefixes are **ignored**. Customers **must not reference** **`INTERNAL_`** or **`ADOBE_`** variables.

**`AEM_`:** Variables with prefix **`AEM_`** are **product-defined** public API. Customers may **use and set** those Adobe provides but **must not define new** custom variables with the **`AEM_`** prefix.

### Local development

- **Non-secret `$[env:…]`:** Define normal process environment variables before starting AEM (e.g. `export ENV_VAR_NAME=my_value`). A small shell script run before startup is recommended; non-secret values may be shared in source control if appropriate.
- **`$[secret:…]`:** Each secret needs a **plain text file** named **exactly** after the variable (e.g. for `$[secret:server_password]` a file **`server_password`**). **No file extension.** Store all such files in one directory and set Sling **`org.apache.felix.configadmin.plugin.interpolation.secretsdir`** to that directory in **`crx-quickstart/conf/sling.properties`** (framework property, not Felix web console), e.g.  
  `org.apache.felix.configadmin.plugin.interpolation.secretsdir=${sling.home}/secretsdir`

### Author vs publish (same PID, different values)

Use separate **`config.author`** and **`config.publish`** folders. Prefer the **same variable name** in both with **`$[env:ENV_VAR_NAME;default=<value>`** where the default matches the tier, and bind values per tier in Cloud Manager using the API **`service`** parameter (**author**, **publish**, or **preview**). Alternatively use distinct names such as **`author_<name>`** and **`publish_<name>`**.

---

## Cloud Manager API and CLI

- **API role:** The Cloud Manager API caller needs **Deployment Manager - Cloud Service** (other roles may not run all operations).
- **Set variables:** **`PATCH /program/{programId}/environment/{environmentId}/variables`** — deploys variables like a pipeline deploy; **author and publish restart** and pick up values after a few minutes. Body is a JSON array of objects with **`name`**, **`value`**, and **`type`**: use **`string`** (default) for **`$[env:…]`**, **`secretString`** for **`$[secret:…]`**.
- **Default values** for interpolation are **not** set via this API—they belong in the **OSGi placeholder** (e.g. `;default=…`).
- **List:** **`GET`** the same **`…/variables`** path. **Delete:** **`PATCH`** with the variable included and an **empty** value.
- **CLI:** `aio cloudmanager:list-environment-variables ENVIRONMENT_ID`  
  `aio cloudmanager:set-environment-variables ENVIRONMENT_ID --variable NAME "value" --secret NAME "value"`  
  `aio cloudmanager:set-environment-variables ENVIRONMENT_ID --delete NAME …`

Environment variables can also be maintained in the **Cloud Manager** UI (**Environment variables**).

### Deployment and governance

Secret and env-specific values **live outside Git**. Customers should **govern** them as part of the release process. Variable API calls **do not** run the same **quality gates** as a full code pipeline. Set variables **before** or when deploying code that depends on them. The API may **fail** while a pipeline is running; errors may be non-specific.

**Additive changes:** Prefer **new variable names** when rotating values so older deployments never pick up wrong values; remove old names only after releases are stable. This also helps **rollbacks** and **disaster recovery** when redeploying older code.

---

## This skill: repository scope and workflow

**In scope for automated edits**

- **`.cfg.json`** files under **`ui.config`** or **`ui.apps/.../jcr_root/...`** where the file's **parent directory name starts with** `config`.
- Legacy **`.cfg`**, **`.config`**, and XML **`sling:OsgiConfig`** nodes — **conversion to `.cfg.json` only** (Phase 0).

**Out of scope for automated edits**

- Repoinit and Adobe-owned OSGi override (see above).
- Reorganizing runmode folder structure (unsupported **`config.*`** / **`install.*`** folders are **flagged** as URC, not moved or renamed).

---

### Phase 0 — Legacy format conversion

Glob for **`.cfg`**, **`.config`**, and **`.xml`** files under config folders (same scope as `.cfg.json`). For each legacy file found, convert it to `.cfg.json` and **delete** the original.

**`.cfg` (Java properties format)**

Line-based `key=value` (or `key = value`). Lines starting with `#` or `!` are comments. Multi-line values use trailing `\`. Convert:

```properties
# .cfg file
server.url=https://example.com
connection.timeout=1000
enabled=true
```

→

```json
{
  "server.url": "https://example.com",
  "connection.timeout": 1000,
  "enabled": true
}
```

Rules: unquoted numeric values → JSON numbers; `true`/`false` → JSON booleans; everything else → JSON strings. Preserve the PID from the filename.

**`.config` (Apache Felix format)**

Similar to `.cfg` but supports typed values with suffixes: `I` (int), `L` (long), `F` (float), `D` (double), `B` (byte), `S` (short), `C` (char). Arrays use square brackets `[ "a", "b" ]`. Booleans are `B"true"` or unquoted `true`/`false`. Convert types to their JSON equivalents (numbers, booleans, arrays). Drop type suffixes.

**XML `sling:OsgiConfig` nodes**

JCR content XML (`.content.xml`) with `jcr:primaryType="sling:OsgiConfig"`. Each `@property` attribute is a config property. Type hints in curly braces: `{Long}`, `{Boolean}`, etc. Arrays use `[]`. Convert to JSON, derive PID from the node name, write as `<PID>.cfg.json`. **Do not delete** the `.content.xml` if it contains non-OSGi nodes — only remove the `sling:OsgiConfig` node from it.

**After conversion:** Proceed with the converted `.cfg.json` files in Phase 1+. Mention converted files in the report.

---

### Phase 1 — Cleanup and consolidation (flag-only)

This phase **flags** issues for user review. **Do not auto-delete or auto-merge** — list findings in the handoff file under a `"cleanup"` array.

**1a. Unsupported run modes (URC)**

Adobe's Pattern Detector reports these as **URC** (Unsupported Run modes Configuration; BPA `subtype` **`unsupported.runmode`**, `importance` **CRITICAL**). Configurations based on unsupported run mode names **have no effect** when deployed to AEM as a Cloud Service.

The migration runbook sources URC **BPA-report-first** (from the CAM/MCP fetch or a local BPA CSV) and only runs local folder detection when no BPA report is available. Local detection covers both **`config.<runmode>`** and bundle **`install.<runmode>`** folders.

A folder is flagged when its run mode is unsupported. Beyond unknown tokens (e.g. `config.qa`, `config.preprod`, `install.local`), note the **ordering rule**: the tier token must **precede** the environment token. `config.author.dev` is valid; **`config.dev.author` is not** — even though `dev` and `author` are individually valid. A folder may carry at most one tier and one environment token, and **`config.preview` cannot be declared** (preview inherits from publish).

Report (flag-only): folder path, the offending run mode, and remediation — **evaluate whether the configuration is needed → rename to a supported run mode identifier following the run-mode resolution rules → remove if obsolete**. See the `aem-guides-wknd-legacy` `code/urc` branch for corrected examples. Sources: [URC pattern](https://experienceleague.adobe.com/en/docs/experience-manager-pattern-detection/table-of-contents/urc), [Configuring OSGi](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/deploying/configuring-osgi).

**1b. Archetype / boilerplate configs**

Flag `.cfg.json` files whose **PID** matches the list below — these are commonly generated by the AEM archetype and are often unnecessary or need review before deploying to Cloud Service:

| PID | Why flag |
|-----|----------|
| `org.apache.sling.commons.log.LogManager.factory.config*` | Custom logger factories — review log levels; Cloud Service uses centralized logging |
| `org.apache.sling.jcr.davex.impl.servlets.SlingDavExServlet` | WebDAV — disabled on Cloud Service |
| `org.apache.sling.servlets.get.DefaultGetServlet` | Default GET servlet — usually archetype boilerplate |
| `com.day.cq.wcm.core.impl.AuthoringUIMode` | Touch UI default — unnecessary on Cloud Service |
| `com.adobe.granite.auth.saml.SamlAuthenticationHandler.factory*` | SAML — must be validated against Cloud Service IDP setup |
| `org.apache.sling.security.impl.ReferrerFilter` | Referrer filter — Cloud Service has its own; review carefully |
| `org.apache.sling.engine.impl.SlingMainServlet` | Sling main servlet — rarely needs override on Cloud Service |

Action: flag with `"needs_user_review": true` and reason. **Do not delete.**

**1c. Duplicate configs across runmode folders**

For each PID, if the **exact same JSON content** appears in multiple runmode folders (e.g. `config.author.dev/` and `config.author.stage/` have identical files), flag as a consolidation candidate. Suggest moving to the least-specific common parent folder (e.g. `config.author/`). **Do not auto-merge.**

**1d. Environment-specific URLs**

Scan `.cfg.json` **string values** for patterns that look like environment-specific URLs: values matching `https?://` that contain hostname fragments suggesting a specific environment (substrings: `dev`, `stage`, `stg`, `qa`, `uat`, `prod`, `preprod`, `localhost`, `local`, or IP addresses like `10.*`, `192.168.*`). Flag each with the property key, current value, and `"needs_user_review": true, "reason": "Possible environment-specific URL — consider $[env:VAR_NAME]"`. **Do not auto-replace** — URL classification requires human judgment.

**1e. Deprecated / Cloud Service–incompatible configs**

Flag `.cfg.json` files whose **PID** matches known deprecated or incompatible services:

| PID pattern | Reason |
|-------------|--------|
| `com.day.cq.replication.impl.AgentManagerImpl` | Replication agents — Cloud Service uses Sling content distribution |
| `com.day.cq.replication.impl.TransportHandler*` | Transport handlers — not applicable on Cloud Service |
| `org.apache.sling.jcr.webdav.impl.servlets.SimpleWebDavServlet` | WebDAV servlet — disabled on Cloud Service |
| `com.day.cq.mailer.DefaultMailService` | Mail service — review; Cloud Service uses different mail configuration |
| `org.apache.felix.http.jetty*` | Jetty tuning — managed by Adobe on Cloud Service |

Flag with reason. **Do not delete.**

---

### Phase 2 — Placeholder injection (secrets and env vars)

This is the original core workflow, now applied **after** Phase 0 and Phase 1.

1. Glob all **`.cfg.json`** (including newly converted ones from Phase 0).
2. For **custom** PIDs only: replace high-confidence **secrets** with **`"$[secret:VAR]"`**; replace eligible **non-secrets** with **`"$[env:VAR]"`** only when Adobe's rules above allow. Skip ambiguous or Adobe-owned configs → **`needs_user_review`** in the handoff file.
3. Do **not** print secret values in chat. Remind user: set CM variables, then **delete** the handoff file; **git history** may still contain old secrets.

---

### Phase 3 — Handoff file

Write gitignored **`cloudmanager-osgi-secrets.local.json`** at the AEM repo root. Structure:

```json
{
  "_do_not_commit": "DELETE this file after applying variables in Cloud Manager",
  "variables": [
    {
      "name": "VAR_NAME",
      "value": "<original value>",
      "cm_type": "secretString | string",
      "placeholder": "$[secret:VAR_NAME]",
      "cfg_json_path": "relative/path/to/file.cfg.json",
      "json_property": "property.key",
      "needs_user_review": false
    }
  ],
  "cleanup": [
    {
      "type": "invalid_runmode | unsupported_runmode | archetype_default | duplicate_config | env_specific_url | deprecated_config",
      "path": "relative/path",
      "detail": "human-readable description",
      "suggestion": "what to do"
    }
  ],
  "conversions": [
    {
      "original": "relative/path/to/legacy.config",
      "converted": "relative/path/to/PID.cfg.json"
    }
  ]
}
```

- Add **`.gitignore`** entry if missing.
- Respect **200** variables and **2048**-char values.
- User deletes file after Cloud Manager is updated and cleanup items are resolved.

### Detection heuristics (agent)

**Secrets:** Treat as secret candidates when keys suggest sensitivity (`password`, `secret`, `apikey`, `token`, `clientsecret`, `credential`, `privatekey`, etc.) or values are obviously secret; exclude hostnames, public IDs, and non-secret flags unless keys indicate otherwise.

**Env-specific URLs:** Match `https?://` values against hostname fragments (`dev`, `stage`, `stg`, `qa`, `uat`, `prod`, `preprod`, `localhost`, `local`, or private IPs). Flag only — **do not** auto-replace.

**Archetype / deprecated PIDs:** Match filenames (minus `.cfg.json`) against the PID tables in Phases 1b and 1e. Use **prefix matching** for factory configs (PID ending in `*` in the tables).

---

## One-line summary

**Phase 0:** convert legacy formats → **Phase 1:** flag URC (unsupported run modes, BPA-first / local fallback over `config.*` + `install.*`), archetype defaults, duplicates, env-specific URLs, deprecated configs → **Phase 2:** inject `$[secret:]` / `$[env:]` placeholders on custom PIDs → **Phase 3:** gitignored handoff file with variables + cleanup items → **no** secrets in chat.
