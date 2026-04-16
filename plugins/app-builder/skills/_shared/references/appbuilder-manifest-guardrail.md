# App Builder Manifest Guardrail

Action definitions in `app.config.yaml` must follow one of two valid patterns. A root-level `runtimeManifest` is **invalid** and silently ignored by the App Builder CLI.

## Valid: Extension-based app (with $include)

Used by templates like `@adobe/generator-app-excshell`. Actions live in `ext.config.yaml`, referenced from `app.config.yaml` via `$include`.

**app.config.yaml:**

```yaml
extensions:
  dx/excshell/1:
    $include: src/dx-excshell-1/ext.config.yaml
```

**src/dx-excshell-1/ext.config.yaml:**

```yaml
operations:
  view:
    - type: web
      impl: index.html
actions: actions
web: web-src
runtimeManifest:
  packages:
    dx-excshell-1:
      license: Apache-2.0
      actions:
        generic:
          function: actions/generic/index.js
          web: 'yes'
          runtime: nodejs:22
          inputs:
            LOG_LEVEL: debug
          annotations:
            require-adobe-auth: true
            final: true
```

## Valid: Standalone app (application.runtimeManifest)

Used by headless or standalone apps without extension points. Actions are defined under `application.runtimeManifest`.

**app.config.yaml:**

```yaml
application:
  runtimeManifest:
    packages:
      my-package:
        license: Apache-2.0
        actions:
          my-action:
            function: actions/my-action/index.js
            web: 'yes'
            runtime: nodejs:22
            inputs:
              LOG_LEVEL: debug
```

## Invalid: Root-level runtimeManifest

The App Builder CLI **ignores** a root-level `runtimeManifest`. Actions defined this way will not be deployed.

**app.config.yaml (WRONG):**

```yaml
# This is IGNORED by the CLI
runtimeManifest:
  packages:
    my-package:
      actions:
        my-action:
          function: actions/my-action/index.js
          web: 'yes'
```

## Validation

Run the manifest structure validator from the project root before deploying:

```bash
python3 skills/_shared/scripts/validate_manifest_structure.py app.config.yaml
```

The script exits with code 0 for valid structures and code 1 for violations.