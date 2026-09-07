> **Beta**: This capability is in beta and under active development. Review its output carefully before using it on production dispatcher configurations.

# Dispatcher Conversion — Config Generation (Branch E)

This is phase 2 (**PLAN + CONFIG-GEN**) of the flow in [context.md](context.md): turning the phase-1 inventory (`buildInventory(root)`) into the tool's own `config.yaml` contract. This is agent judgment, not a script — `dispatcher-inventory.js` tells you *what's there*; nothing in `scripts/` decides *how the inventory maps onto the tool's config*. That mapping is this document.

Get this step wrong and the tool still runs — it just runs on the wrong inputs. A `config.yaml` that points at the wrong vhost file, or omits a folder an `Include` needs, produces output that passes phase 3 (EXECUTE) without error and fails quietly in phase 4 (VERIFY). See **Getting it wrong** below before you consider phase 2 done.

## From `cfg` object to `config.yaml` to a running tool

The agent builds a plain JS object (called `cfg` throughout this doc) and hands it to three functions from `scripts/dispatcher-run.js`, in this order:

```js
const { writeToolConfig, ensureToolInstalled, runConverter, TOOL_DIR } = require('./scripts/dispatcher-run.js');

// Phase 2 ends here: cfg → config.yaml on disk.
const configPath = writeToolConfig(workingDir, cfg);   // <workingDir>/config.yaml

// Phase 3 starts here.
try {
  ensureToolInstalled(TOOL_DIR);                       // npm install on first use — THROWS on failure
} catch (e) {
  // Report to the user (network / registry / permissions). Do not proceed.
}

const result = runConverter(workingDir, cfg.mode, TOOL_DIR);
// result.outputSrcDir → <workingDir>/target/dispatcher/src
// result.reportPath   → <workingDir>/target/dispatcher/dispatcher-converter-report.md
```

A few things worth being precise about:

- **`ensureToolInstalled` throws** (it shells out via `execFileSync`, uncaught) rather than returning an error object — the `try`/`catch` is not optional decoration. See [context.md](context.md)'s prerequisite section for the install details (roughly 473 packages, one-time, needs network).
- **`workingDir` is a scratch directory, not the dispatcher source.** It's where `config.yaml` gets written and where `target/dispatcher/{src,dispatcher-converter-report.md}` land after the run. Every path *inside* `cfg` (`sdkSrc`, `dispatcherAnySrc`, `vhostsToConvert`, …) is a separate, typically absolute, path to the actual source files — it has nothing to do with `workingDir`'s location.
- **`cfg.mode` never reaches `config.yaml`.** `writeToolConfig` doesn't read `cfg.mode` at all — look at the source and it's not in the emitted YAML. Keep it on the object anyway: it's what you pass as the separate `mode` argument to `runConverter(workingDir, mode, toolDir)` (and to `resolveExecutor`), which is how the right executor (`main.js` vs `singleFileMain.js`) gets picked. The YAML the tool itself reads has no mode key — the executor *choice* encodes the mode, not the config file.
- **Confirm before you execute.** Phase 2 isn't done when `config.yaml` is written — per [context.md](context.md), present the plan (mode, the resolved source paths, anything `variablesToReplace` will substitute) to the user and confirm before phase 3 runs, and confirm `git status --porcelain` is clean first (conversion runs in place).

## The `cfg` shape

```js
{
  sdkSrc: '<path>',              // Dispatcher SDK's src/ folder — both modes need this
  mode: 'standard' | 'flexible' | 'v1',   // NOT written to config.yaml — see above
  ams: {
    cfg: '<path>',                // standard mode only: the AMS v2.0 config root
  },
  onPremise: {                    // flexible/v1 only
    dispatcherAnySrc: '<path>',
    httpdSrc: '<path>',
    vhostsToConvert: ['<path>', ...],
    variablesToReplace: [{ from: '<VAR>', to: '<value>' }, ...],
    appendToVhosts: '<optional: path to a file>',   // fs.readFileSync'd verbatim, uncaught — a FILE PATH, never inline text
    pathToPrepend: ['<path>', ...],
    portsToMap: [<port>, ...],
  },
}
```

You only ever populate the block that matches your mode. `writeToolConfig` reads `cfg.onPremise || {}` and `cfg.ams && cfg.ams.cfg`, so the other block can simply be omitted — the writer leaves its keys blank in the YAML, and the tool ignores blank keys that don't apply to the executor it's running (per the source comment directly above `writeToolConfig`: *"Keys not applicable to the mode are left blank (the tool ignores them)."*).

Two shape rules that are easy to get backwards, both enforced by `dispatcher-conversion.test.js`:

- **`variablesToReplace` is an array of `{from, to}` objects in `cfg`, but it is emitted as a flat YAML *mapping*** (`"FROM": "TO"` lines), not a sequence. The on-premise executor reads it back as a plain object and does `Object.keys(variablesToReplace).forEach(...)` — that's only possible if it lands as a mapping. Never emit it as a list of `"from,to"` strings.
- **`portsToMap` is an array of ports, emitted as a YAML list** (`- "8080"`), never a comma-joined scalar. The executor does `portsToMap.forEach(...)` over it — a scalar has no `.forEach`.

## Mode: `standard` (AMS v2.0)

```js
const cfg = {
  sdkSrc: '<Dispatcher SDK src/>',
  mode: 'standard',
  ams: { cfg: inventory.configRoot },
};
```

`ams.cfg` is just the inventory's `configRoot` — the AMS v2.0 config root `buildInventory` already resolved for you (`conf`, `conf.d`, `conf.dispatcher.d`, `conf.modules.d`). There's no field-by-field mapping to do for this mode; the AMS-path executor (`executors/main.js`) walks that whole tree itself.

**Resolving `sdkSrc`** (both modes need this): it's the `src/` folder of Adobe's Dispatcher SDK — the same skeleton used for local Docker validation, and the source of the `default_*.any` / `global.vars` files the tool copies in as the Adobe-managed baseline. Look for it already unpacked somewhere in the workspace (commonly something like `aem-sdk-dispatcher-tools-<version>/dispatcher/src`, or referenced from the project's own `dispatcher` module tooling); if you can't find one, ask the user for the path — do not guess at a version.

### PRE-TOOL step: relocate `conf.d/whitelists/` before you run the tool

If the AMS source has a `conf.d/whitelists/` folder, it **must** be handled in the source, before phase 3, not after. The AMS-path executor deletes that entire folder unconditionally and content-blind, in the same early pass that removes `conf.modules.d/` and every top-level `conf.d/*.conf` file — by the time phase 5 (JUDGMENT) or even phase 4 (VERIFY) sees the output, whatever was in `whitelists/` is already gone. There is nothing to "preserve" from the tool's output after the fact.

Before calling `writeToolConfig`/running the tool:

1. Move `conf.d/whitelists/*` → `conf.d/includes/` in the **source** tree (not the output).
2. Repoint every `$include`/`Include` that referenced the old `whitelists/` path at `conf.d/includes/` instead.
3. Do this regardless of what the content looks like — the AEMaaCS dispatcher validator also rejects a folder literally named `whitelists`, so there's a second, independent reason to move it even if you think it's disposable.

This is rows 4 and 10 of [conversion-patterns.md](conversion-patterns.md) — row 4 for the relocation itself, row 10 for the sibling case (`conf.d/security.conf`) that needs the same "act before the tool touches it" treatment for different reasons. Read both before your first `standard`-mode run.

## Mode: `flexible` / `v1` (on-premise)

This is the mode where config generation is real work, not a lookup. Everything comes from the inventory, but not always as a direct 1:1 field copy:

| `cfg.onPremise` field | Source | Notes |
|---|---|---|
| `dispatcherAnySrc` | `inventory.dispatcherAny` | **Verify before trusting it** — see "Prefer rendered over template" below. |
| `httpdSrc` | `inventory.httpd` | Same rendered-vs-`.tmpl` caveat. |
| `vhostsToConvert` | the vhost-definition file(s)/folder(s) in `inventory.vhostFiles` | The file(s) that actually contain `<VirtualHost>` blocks — e.g. a single `conf.vhost.d/vhosts.conf`. `vhostFiles` matches by filename pattern, not by parsing content, so when a rendered file and its `.tmpl` twin both match, you still have to pick the rendered one yourself. |
| `variablesToReplace` | `inventory.cmVarCandidates`, mapped to `{from, to}` | One object per variable, e.g. `{ from: 'DISP_ID', to: 'publish-primary' }`. See the `cmVarCandidates` caveat below — it doesn't always catch everything. |
| `pathToPrepend` | folders that hold whatever `vhostsToConvert`'s `Include`/`$include` lines reach into | e.g. the `conf.vhost.d/` and `conf.d/` directories. Get this wrong and includes the tool needs simply aren't there. |
| `portsToMap` | any non-`:80` `<VirtualHost>` ports in the source worth preserving | Always an array, even for one port — see the shape rule above. |
| `sdkSrc` | same as `standard` mode | Resolve from the workspace or ask the user. |
| `appendToVhosts` | usually nothing | **An optional path to a file** — not inline directive text. The executor does `fs.readFileSync(appendToVhosts)` with no `try`/`catch`; the file's contents are appended verbatim to every converted vhost. Pass it a real file path — passing literal directive text instead of a path crashes the whole conversion with `ENOENT`. Leave it blank unless you have a specific file whose contents need to land on every vhost. Uncommon — the worked example below leaves it unset. |

### The `cmVarCandidates` blind spot

`buildInventory`'s `cmVarCandidates` is a regex scan for **`${VAR}` curly-brace placeholders only** (`/\$\{([A-Z0-9_]+)\}/g` over vhost/`.conf`/`.conf.tmpl` files). That's the AMS convention, and it's also common in on-premise builds that render templates with `envsubst` or similar.

It is *not* the only placeholder convention you'll meet. On-premise Docker-based dispatcher projects frequently use **sed-style `@VAR@` placeholders** instead — a `build-files.sh` running `sed -f variables-<env>.sed` over `*.tmpl` files, where the `.sed` file has lines like `s/@PUBLISH_HOSTNAME@/www.example.com/`. Those will **not** show up in `cmVarCandidates` — the regex simply doesn't match `@...@`. Don't treat an empty (or short) `cmVarCandidates` as proof there's nothing left to substitute: grep the source yourself (`grep -orhE '@[A-Z0-9_]+@' <dir> | sort -u`) and fold anything you find into `variablesToReplace` by hand, on top of whatever `cmVarCandidates` already caught.

### Prefer rendered over template

Prefer a resolved/rendered build output over a `.tmpl` source whenever one exists. The tool has no template engine of its own — it converts whatever placeholder syntax is literally sitting in the file it's pointed at. A `.tmpl` file handed to it as-is comes out the other side with `${...}`/`@...@` placeholders still in it, unconverted.

Concretely: if the project's build produces something like a `local-build/output/` tree (a rendered copy of `conf.d/`, `conf.vhost.d/`, `conf/`, produced by running the project's own build script against the `.tmpl` sources), point `dispatcherAnySrc`, `httpdSrc`, and `vhostsToConvert` at files in *that* tree, not at the checked-in `.tmpl` files.

**Don't trust `inventory.dispatcherAny`/`inventory.httpd` blindly here.** Both are picked via array index `[0]` out of a directory walk (`readTextFiles`) that matches `dispatcher.any` *and* `dispatcher.any.tmpl` (same for `httpd.conf`/`httpd.conf.tmpl`) — and `fs.readdirSync` order isn't guaranteed to be alphabetical on every filesystem. When a rendered file and a `.tmpl` twin both exist in the scanned tree, `inventory.dispatcherAny`/`inventory.httpd` may land on either one. Always look at what it actually picked and override to the rendered path if it picked the template.

If only `.tmpl` sources exist — no build was ever run, or the rendered output wasn't kept — there's no rendered file to prefer. Express the known substitutions through `variablesToReplace` instead, and tell the user this is an **approximation**: any placeholder you didn't enumerate survives unresolved into the converted output, and it's easy to miss one in a large `.tmpl` tree.

## Worked example

Source layout (flexible/Docker shape) — one monolithic `dispatcher.any`, a `conf.vhost.d/` full of `.tmpl` rule fragments and a `vhosts.conf.tmpl`, plus a rendered build output alongside it:

```
dispatcher/
├── docker/                              (checked-in .tmpl sources)
│   ├── conf.d/dispatcher.any.tmpl
│   ├── conf.vhost.d/
│   │   ├── vhosts.conf.tmpl
│   │   ├── checkout.rules.tmpl
│   │   └── blog.rules.tmpl
│   └── conf/httpd.conf.tmpl
└── local-build/
    ├── variables-prod.sed               (sed substitutions: @VAR@ → value)
    └── output/                          (rendered by the project's own build script)
        ├── conf.d/
        │   ├── dispatcher.any.tmpl       ← unrendered twin, copied alongside
        │   └── dispatcher.any            ← rendered — prefer this one
        ├── conf.vhost.d/
        │   ├── vhosts.conf.tmpl
        │   ├── vhosts.conf                ← rendered — the actual vhost-definition file
        │   ├── checkout.rules.tmpl
        │   ├── checkout.rules
        │   ├── blog.rules.tmpl
        │   └── blog.rules
        └── conf/
            ├── httpd.conf.tmpl
            └── httpd.conf                  ← rendered
```

Rendered `conf.vhost.d/vhosts.conf` (excerpt) — the local build resolved path/feature placeholders but deliberately left two environment values as runtime-only `${...}` placeholders (they're meant to be filled in per-environment, not by a local dev build), and one vhost sits on a non-standard port the customer wants preserved:

```apache
<VirtualHost *:80>
    ServerName health.internal.example.com
    Include conf.vhost.d/checkout.rules
</VirtualHost>
<VirtualHost *:80>
    ServerName ${PUBLISH_HOSTNAME}
    Include conf.vhost.d/blog.rules
    Header always set X-Dispatcher "${DISP_ID}"
</VirtualHost>
<VirtualHost *:8080>
    ServerName status.internal.example.com
    Include conf.vhost.d/checkout.rules
</VirtualHost>
```

`buildInventory('.../local-build/output')` (abbreviated — and, per the caveat above, this run happened to pick the `.tmpl` twins for the two `[0]`-indexed fields):

```json
{
  "mode": "flexible",
  "configRoot": ".../local-build/output",
  "dispatcherAny": ".../local-build/output/conf.d/dispatcher.any.tmpl",
  "httpd": ".../local-build/output/conf/httpd.conf.tmpl",
  "vhostFiles": [
    ".../local-build/output/conf.vhost.d/vhosts.conf",
    ".../local-build/output/conf.vhost.d/vhosts.conf.tmpl"
  ],
  "tmplUsage": true,
  "cmVarCandidates": ["PUBLISH_HOSTNAME", "DISP_ID"],
  "amsMarkers": false
}
```

The resulting `cfg` — note `dispatcherAnySrc`/`httpdSrc` are overridden to the rendered paths rather than copied straight from `inventory.dispatcherAny`/`inventory.httpd`, exactly per the caveat above:

```js
const cfg = {
  sdkSrc: '/opt/aem-sdk-dispatcher-tools-2.0.230/dispatcher/src',
  mode: 'flexible',
  onPremise: {
    dispatcherAnySrc: '/work/dispatcher/local-build/output/conf.d/dispatcher.any',
    httpdSrc: '/work/dispatcher/local-build/output/conf/httpd.conf',
    vhostsToConvert: [
      '/work/dispatcher/local-build/output/conf.vhost.d/vhosts.conf',
    ],
    variablesToReplace: [
      { from: 'PUBLISH_HOSTNAME', to: 'www.example-customer.com' },
      { from: 'DISP_ID', to: 'publish-primary' },
    ],
    pathToPrepend: [
      '/work/dispatcher/local-build/output/conf.vhost.d/',
    ],
    portsToMap: [8080],
  },
};
```

`writeToolConfig(workingDir, cfg)` writes this `config.yaml`:

```yaml
dispatcherConverter:
    sdkSrc: /opt/aem-sdk-dispatcher-tools-2.0.230/dispatcher/src
    onPremise:
        dispatcherAnySrc: /work/dispatcher/local-build/output/conf.d/dispatcher.any
        httpdSrc: /work/dispatcher/local-build/output/conf/httpd.conf
        vhostsToConvert:
            - "/work/dispatcher/local-build/output/conf.vhost.d/vhosts.conf"
        variablesToReplace:
            "PUBLISH_HOSTNAME": "www.example-customer.com"
            "DISP_ID": "publish-primary"
        appendToVhosts: 
        pathToPrepend:
            - "/work/dispatcher/local-build/output/conf.vhost.d/"
        portsToMap:
            - "8080"
    ams:
        cfg: 
```

(The trailing space after `appendToVhosts:` and `cfg:` is the writer emitting an empty scalar — harmless, valid YAML.)

Without `portsToMap: [8080]` here, the tool's default port-80-only handling would drop the `:8080` status vhost entirely. Without the `DISP_ID`/`PUBLISH_HOSTNAME` entries in `variablesToReplace`, those two placeholders would survive unresolved into the converted output instead of being substituted.

## Getting it wrong: empty filters, mega-inlined vhosts

**`vhostsToConvert` and `pathToPrepend` are make-or-break for `flexible`/`v1` mode.** A config that's close-but-not-quite-right doesn't fail loudly — the executor runs, exits zero, and produces output that looks converted. The two failure shapes to watch for, and they're exactly what phase 4 exists to catch (`dispatcher-verify.js`'s `verifyOutput`, detailed in [output-verification.md](output-verification.md)):

- **An emptied `filters.any` (or farm `/filter` section) against a nonzero phase-1 baseline.** This is `verifyOutput`'s `filter-acl-loss` check, and it's a hard gate — `critical` severity, never a silent pass. Filters are the dispatcher's access-control layer; losing them isn't a formatting nit.
- **A mega-inlined vhost.** `verifyOutput` flags any output `.vhost` file over 5000 lines as `disorganized`/`important`. If `vhostsToConvert` misses a file, or `pathToPrepend` doesn't cover every folder an `Include` in that file reaches into, the executor has less than it needs to cleanly separate the vhost from the rule content it pulls in — and what should have stayed several small, named include files can end up flattened into one enormous one.

Treat both counts — filter rules, vhost line counts — as unverified until phase 4 has actually run against the phase-1 baseline (`ruleCounts` from `buildInventory`). Confirming `config.yaml` "looks right" is not the same as confirming the output is right.

## See also

- [context.md](context.md) — the 6-phase flow this step belongs to (phase 2), the mode taxonomy, and the `ensureToolInstalled` prerequisite.
- [conversion-patterns.md](conversion-patterns.md) — phase 5's decision catalog; rows 4/10 for the pre-tool `whitelists`/`security.conf` handling referenced above, row 15 for the `cmVarCandidates` → Cloud Manager hand-off.
- [output-verification.md](output-verification.md) — phase 4, `verifyOutput`, and the `filter-acl-loss` hard gate referenced above.
