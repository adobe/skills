# OSGi configs: scan → Cloud Manager environment secrets / variables

**Agent:** The parent skill loads this file for prompts such as *“scan my config files and create Cloud Manager environment secrets or variables.”* Users do **not** name this path.

The sections below through **Cloud Manager and deployment** reproduce the rules from **Adobe Experience Manager as a Cloud Service** product documentation for configuring OSGi (deploying topic: OSGi configuration with secret and environment-specific values). **Follow them when editing configs or advising on Cloud Manager.**

---

## OSGi in the AEM project

OSGi manages bundles and their configurations. Settings are defined in **configuration files that are part of the AEM code project**. Cloud Manager is used to configure **environment variables** that back OSGi placeholders.

### Configuration files (`.cfg.json`)

- Configuration changes belong in the project’s code packages (**`ui.config`**) as **`.cfg.json`** files under **runmode-specific** config folders, for example under paths like **`/apps/<appId>/config.<runmode>/`** (in the content tree; in Maven this is commonly under **`ui.config`** / **`osgiconfig`**).
- The format is **JSON**, using the **`.cfg.json`** format defined by the **Apache Sling** OSGi configuration installer.
- OSGi configurations target components by **Persistent Identity (PID)**. The PID usually matches the **fully qualified Java class name** of the OSGi component implementation. Example file path:  
  `.../config/com.example.workflow.impl.ApprovalWorkflow.cfg.json`
- **Factory configurations** use the **`<factoryPID>-<name>.cfg.json`** naming convention.

**Superseded formats:** Older AEM versions allowed **`.cfg`**, **`.config`**, and XML **`sling:OsgiConfig`**. On AEM as a Cloud Service these are **superseded** by **`.cfg.json`**. This skill’s automated edits apply **only** to **`.cfg.json`** after any legacy content is converted elsewhere.

**Cloud runtime note:** On AEM as a Cloud Service, effective OSGi configuration is not held like a classic on-prem **`/apps`**-only model; use the environment’s **Developer Console** (Status → Configurations in the status dump) to inspect what is applied.

### Runmodes (context for configs)

- **AEM 6.x** allowed **custom runmodes**; **AEM as a Cloud Service does not**. Only the **documented Cloud Service runmode set** applies. Differences between Cloud environments that runmodes cannot express are handled with **OSGi configuration environment variables** (`$[env:…]` / `$[secret:…]`).
- Runmode-specific folders live under **`/apps/<appId>/`** using names like **`config.<author|publish>.<dev|stage|prod>`** (and combinations such as **`config.author`**, **`config.author.dev`**). Configs apply when the folder’s runmodes **match** the instance.
- If **multiple** configs apply to the **same PID**, the one with the **highest number of matching runmodes** wins. Resolution is at **PID** level: you **cannot** split properties for the same PID across two folders—one winning file applies to the **whole** PID.
- **Preview:** A **`config.preview`** folder is **not** declared like **`config.publish`**. The **preview** tier **inherits** OSGi configuration from **publish**.
- **Local SDK:** Runmodes can be set at startup, e.g. **`-r publish,dev`** on the quickstart JAR.

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

- **`.cfg.json` only**, under **`ui.config`** or **`ui.apps/.../jcr_root/...`** where the file’s **parent directory name starts with** `config`.

**Out of scope for automated edits**

- Legacy **`.cfg`**, **`.config`**, XML OSGi (convert to **`.cfg.json`** first).
- Repoinit and Adobe-owned OSGi override (see above).
- Reorganizing runmode folder structure.

**One-prompt workflow**

1. Glob scoped **`.cfg.json`** as above.
2. For **custom** PIDs only: replace high-confidence **secrets** with **`"$[secret:VAR]"`**; replace eligible **non-secrets** with **`"$[env:VAR]"`** only when Adobe’s rules above allow. Skip ambiguous or Adobe-owned configs → **`needs_user_review`** in the handoff file.
3. Write gitignored **`cloudmanager-osgi-secrets.local.json`** with **`variables`**: **`name`**, **`value`**, **`cm_type`** (`secretString` | `string`), **`placeholder`**, **`cfg_json_path`**, **`json_property`**; optional **`needs_user_review`**. Respect **200** variables and **2048**-char values.
4. Do **not** print secret values in chat. Remind user: set CM variables, then **delete** the handoff file; **git history** may still contain old secrets.

### Handoff file (security)

- Filename suggestion: **`cloudmanager-osgi-secrets.local.json`** at AEM repo root.
- Include **`_do_not_commit`** warning; add **`.gitignore`** entry if missing.
- User deletes file after Cloud Manager is updated.

### Detection heuristics (agent)

Treat as secret candidates when keys suggest sensitivity (`password`, `secret`, `apikey`, `token`, `clientsecret`, `credential`, `privatekey`, etc.) or values are obviously secret; exclude hostnames, public IDs, and non-secret flags unless keys indicate otherwise.

---

## One-line summary

**Scan** scoped **`.cfg.json`** → apply Adobe rules above for **`$[secret:]`** / **`$[env:]`** on **custom** properties only → gitignored handoff with **`cm_type`** → **no** secrets in chat.
