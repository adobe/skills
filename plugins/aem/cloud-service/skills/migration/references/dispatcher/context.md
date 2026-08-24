> **Beta**: This capability is in beta and under active development. Review its output carefully before using it on production dispatcher configurations.

# Dispatcher Conversion — Context (Branch E)

Converts an AMS or on-premise Apache **Dispatcher** configuration to AEM as a Cloud Service shape. This branch is a thin, agent-driven wrapper around Adobe's own **`@adobe/aem-cs-source-migration-dispatcher-converter`** tool — it does not reimplement the conversion. Deterministic Node scripts under `scripts/` handle mode detection, driving the tool, and verifying its output; the agent handles config generation, judgment calls the tool can't make, and cross-boundary hand-offs (e.g. to Cloud Manager).

## Mode taxonomy

Every dispatcher config falls into exactly one of six modes. Get the mode — and the rest of the structured inventory — from `dispatcher-inventory.js`, run from the migration skill directory (`plugins/aem/cloud-service/skills/migration/`):

```bash
node -e "console.log(JSON.stringify(require('./scripts/dispatcher-inventory.js').buildInventory('<config-root>'), null, 2))"
```

If the config root isn't already known, discover candidates first with `findConfigRoots(workspaceRoot)` from the same module.

| Mode | Signal | Route |
|---|---|---|
| `standard` | AMS v2.0 layout — `conf.dispatcher.d/` with `enabled_farms/` + `available_farms/` | Adobe tool, **AMS path** (`executors/main.js`) |
| `flexible` | Monolithic `dispatcher.any` + `conf.vhost.d/`, no `conf.dispatcher.d/` | Adobe tool, **on-premise path** (`executors/singleFileMain.js`) |
| `v1` | A bare `dispatcher.any` present, but the layout matches neither `standard` nor `flexible` (older/unusual arrangement) | On-premise path, **best-effort** |
| `already-cloud` | Already has `opt-in/USE_SOURCES_DIRECTLY` or a populated `enabled_farms/farms.any`, and no AMS markers | **Report only** — do not run the tool |
| `not-dispatcher` | No dispatcher signals at all (no `conf.d`/`conf.dispatcher.d`/`conf.vhost.d`, no `dispatcher.any`) | **Stop** — confirm the path with the user |
| `unknown` | Looks dispatcher-ish (a `conf.*` directory is present) but matches none of the above — ambiguous/incomplete layout | **Stop** — confirm the structure with the user |

`buildInventory(root)` returns `{ mode, configRoot, dispatcherAny, httpd, vhostFiles, farmFiles, ruleCounts: { filter, rewrite, cache, clientheader, virtualhost }, tmplUsage, cmVarCandidates, amsMarkers }`. Capture `ruleCounts` before touching anything — it is the baseline phase 4 verifies against.

**The agent is the gate, not the script.** `dispatcher-run.js`'s `resolveExecutor(toolDir, mode)` only special-cases `'standard'`; every other mode — including `already-cloud`, `not-dispatcher`, and `unknown` — falls through to the on-premise executor. The driver does not itself refuse to run on a non-convertible mode. Stop on `already-cloud` / `not-dispatcher` / `unknown` before phase 2, per the routing column above; never let those modes reach phase 3.

## Prerequisite: Adobe's tool (auto-installed, no manual setup)

The engine is Adobe's maintained **`@adobe/aem-cs-source-migration-dispatcher-converter`**, pinned in `scripts/dispatcher-tool/package.json`. It is **not** committed or pre-installed — the first phase-3 run installs it on demand:

```js
const { ensureToolInstalled, TOOL_DIR } = require('./scripts/dispatcher-run.js');
try {
  ensureToolInstalled(TOOL_DIR);
} catch (e) {
  // npm install failed (network / registry / permissions) — report to the user, do not proceed to phase 3.
}
```

This runs `npm install --no-audit --no-fund` into the gitignored `scripts/dispatcher-tool/` — observed at roughly 473 packages and about a minute on a typical connection, one-time. It needs network access. Installation is idempotent: once `node_modules/<pkg>/executors` exists, later calls return `{ installed: true, alreadyPresent: true }` without reinstalling.

`ensureToolInstalled` **throws** on install failure (it shells out via `execFileSync`, uncaught) — always wrap the call in `try`/`catch` as shown above. There is no manual prerequisite; do not ask the user to `npm install` anything themselves.

## Pre-flight: clean git tree

Conversion runs **in place** against the project's working tree. Before phase 3 (EXECUTE), confirm `git status --porcelain` is empty — or that the user has explicitly committed or stashed unrelated changes first. Starting from a clean tree is what makes the phase-4 diff, and any rollback (`git checkout -- <path>` / `git reset --hard`), meaningful; without it you can't separate the tool's changes from the user's.

## The 6-phase flow

1. **DETECT + INVENTORY** — `dispatcher-inventory.js` (`buildInventory` / `findConfigRoots`). Establishes the mode and the rule-count baseline. See **Mode taxonomy** above.
2. **PLAN + CONFIG-GEN** — the agent turns the inventory into the tool's `config.yaml` contract and confirms the plan with the user before executing. See [config-generation.md](config-generation.md).
3. **EXECUTE** — `ensureToolInstalled` then `runConverter(workingDir, mode, toolDir)` from `dispatcher-run.js`: resolves the right executor per mode and runs Adobe's tool, producing `target/dispatcher/src` and `target/dispatcher/dispatcher-converter-report.md`.
4. **VERIFY + NORMALIZE** — `dispatcher-verify.js`'s `verifyOutput(outputSrcDir, baseline)` checks the output against the phase-1 baseline. **STOP on any `filter-acl-loss` failure** — an emptied `filters.any` (or farm `/filter`) against a nonzero baseline is a hard gate, never a silent pass. See [output-verification.md](output-verification.md).
5. **JUDGMENT + CROSS-BOUNDARY** — apply the decision catalog to relocate, drop, or flag what the tool doesn't fully resolve (SSL/TLS-at-edge, `whitelists/`, non-whitelisted directives, Cloud Manager variables → hand off to migration Branch A). See [conversion-patterns.md](conversion-patterns.md).
6. **VALIDATE** — run the AEM Cloud Service dispatcher validator and iterate until clean. See [validation.md](validation.md); the target end-state conventions it validates against are in [current-sdk-conventions.md](current-sdk-conventions.md).

## Scope and honest automation

The conversion is **deterministic where the tool runs** — same inputs and `config.yaml` produce the same output — and this wrapper **preserves the tool's known limitations** rather than papering over them. Anything the tool can't resolve is surfaced in phase 5/6, not silently patched.

Automation is per-mode, not uniform:

| Mode | Automation |
|---|---|
| `standard` | **Near-automated.** The AMS v2.0 farm structure maps closely to current-SDK conventions already; phase 5 judgment is light. |
| `flexible` | **Assisted** — plan → confirm → execute, with human gates at config-generation and post-verify. Not one-click: mapping a monolithic `dispatcher.any` and its vhosts needs a deliberately-built `config.yaml` (`vhostsToConvert`, `pathToPrepend`, `variablesToReplace`), and the decision-catalog pass is heavier. |
| `v1` | **Best-effort.** Runs the same on-premise executor as `flexible`, on a layout the tool's authors didn't design around; expect more residue and the occasional executor error. Point unresolved gaps at Adobe support (or the tool's own issue tracker) rather than guessing at a fix. |
| `already-cloud` | **Report only.** Confirm the mode, tell the user the config already matches current-SDK conventions, and stop — do not run the tool. |
| `not-dispatcher` / `unknown` | **Stop and ask.** Never guess at an ambiguous or absent dispatcher layout. |

**Manual residue.** Even a clean `standard` or `flexible` run typically leaves a short, precise checklist for the user:

- SSL/TLS-at-edge and CDN-side settings the decision catalog drops from the config — these don't move automatically; confirm they're configured on the Cloud Manager / CDN side instead.
- Cloud Manager variables/secrets for any `cmVarCandidates` the inventory flagged — hand these to migration [Branch A](../osgi-cfg-json-cloud-manager.md); they are not wired up automatically.
- Any `important`-severity `verifyOutput` finding that wasn't auto-fixed (a filter-rule regression short of total loss, an oversized/mega-inlined vhost).
- Anything phase 5 marked "preserve + strip" or "relocate" in the decision catalog — confirm the result by hand.
- Final phase-6 validator warnings that don't block but are worth a human look.
