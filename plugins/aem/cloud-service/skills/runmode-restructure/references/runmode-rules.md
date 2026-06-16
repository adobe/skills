# AEM as a Cloud Service — OSGi run-mode rules (reference)

These rules reproduce the Adobe Experience Manager as a Cloud Service product
behavior for OSGi configuration run modes. Follow them when classifying or
restructuring `config.<runmode>` folders.

## Valid run-mode tokens (exhaustive)

| Token | Kind | Applies to |
|-------|------|------------|
| `author` | service | Author tier |
| `publish` | service | Publish tier |
| `dev` | environment | Development environment |
| `stage` | environment | Stage environment |
| `prod` | environment | Production environment |

There are **no custom run modes** on Cloud Service. AEM 6.x allowed arbitrary run
modes (`qa`, `uat`, `local`, `ams`, `integration`, …); on the Cloud they resolve to
nothing and the config is silently not applied.

## Valid folder names (exhaustive)

A config folder is `config` plus **at most one** service token and/or **at most one**
environment token, **service before environment**:

```
config
config.author          config.publish
config.dev             config.stage             config.prod
config.author.dev      config.author.stage      config.author.prod
config.publish.dev     config.publish.stage     config.publish.prod
```

Any other folder name is **invalid** on Cloud Service, including:

- Wrong order: `config.prod.author` → should be `config.author.prod`.
- Custom run mode: `config.qa`, `config.uat`, `config.local`, `config.ams`,
  `config.integration`, `config.preview`.
- Two services or two environments: `config.author.publish`, `config.dev.stage`.

## PID resolution (why merges are careful)

- Resolution is at the **PID** level. When multiple applicable folders define the
  same PID, the folder with the **highest number of matching run modes wins**.
- You **cannot split** the properties of one PID across two folders — exactly one
  winning `.cfg.json` applies to the whole PID. So merging two folders that both
  contain the same PID file is a real conflict that a human must resolve.
- `.content.xml` is the folder's `sling:Folder` marker (shared metadata), **not** a
  PID, and never counts as a collision.

## Preview tier

- A `config.preview` folder is **not** a valid declaration. The **preview** tier
  **inherits** OSGi configuration from **publish**. Map `preview → publish` (or
  externalize the differing values with `$[env:]`).

## Local SDK

- Run modes can be set at startup on the quickstart JAR, e.g. `-r publish,dev`.
  This does not change the valid folder grammar above.

## Environment-specific values

Differences that run modes cannot express on Cloud Service (e.g. a single `dev`
run mode but several development environments) are handled with OSGi configuration
**environment variables**, not extra run-mode folders:

- `$[env:ENV_VAR_NAME]` — non-secret values that vary across environments.
- `$[secret:SECRET_VAR_NAME]` — required for any secret value (passwords, keys).

Externalizing values is the `migration` skill's OSGi → Cloud Manager branch. This
skill only restructures folders and *flags* values that look environment-specific.
Never introduce placeholders on Adobe/product-owned PIDs, and never put secret
values in chat.
