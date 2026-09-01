# URC (Unsupported Run Modes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect AEM-as-a-Cloud-Service Unsupported Run Modes Configuration (URC) in the migration skill's OSGi config handling — sourced BPA-report-first with a local run-mode folder detector as fallback — surface it flag-only, and offer a safe auto-reorder fix for the deterministic (ordering-only) subset.

**Architecture:** URC stays under the existing `osgiConfig` pattern. The always-local secret/legacy/placeholder scan is unchanged; a new URC sub-step prefers BPA report findings (subtype `unsupported.runmode`) and falls back to a new local detector over `config.*` and `install.*` folders that enforces the supported run-mode set and the tier-before-environment ordering rule. A separate, apply-time fix reorders ordering-only violations (`config.dev.author` → `config.author.dev`) with a collision guard; unknown-token and duplicate tier/env folders are never auto-fixed.

**Tech Stack:** Node.js (>=14), CommonJS, `node:test` + `node:assert`. No new dependencies.

## Global Constraints

- **Node engine:** `>=14.0.0` — no syntax beyond ES2020; CommonJS `require`/`module.exports` only.
- **No new dependencies** — standard library (`fs`, `path`, `os`) only.
- **Never emit a secret value** — the OSGi runner's hard safety rule; URC code touches only folder names, never file contents.
- **Detection is flag-only** — the scanner never renames, moves, or deletes folders. The separate auto-reorder fix (Task 6) mutates only via an explicit apply call (`dryRun: false`), is never invoked from `gatherFindings`, only ever reorders known-valid tokens, and never overwrites an existing target folder.
- **Supported run-mode tokens (verbatim):** tier = `author`, `publish`; environment = `dev`, `stage`, `prod`. `preview` cannot be declared as a folder. Ordering: tier token precedes environment token. Bare `config` / `install` (no dotted suffix) is valid.
- **BPA subtype (verbatim):** `unsupported.runmode` (the `subtype` column; the `type` column is `unsupported.runmode.configuration`).
- **Report-first semantics:** when a BPA source is present it owns the URC verdict (even zero findings = clean); the local detector runs only when no BPA source is present or the fetch genuinely failed. Mirrors the existing cascade at `runbook-generator.js` (BPA tier → local fallback).
- **Provenance note:** `osgiConfig` has `heuristic: true`, so all its findings (including BPA-sourced URC merged in) are tagged `confidence: 'heuristic'`. This is intentional here — URC remediation is a human judgment call (which supported run mode to rename to) — and keeps downstream source labels stable.

---

### Task 1: Local run-mode folder validator

Pure, side-effect-free function that classifies a single folder name. This is the correctness core (the ordering rule) and is unit-tested in isolation.

**Files:**
- Modify: `plugins/aem/cloud-service/skills/migration/scripts/osgi-config-runner.js`
- Test: `plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.test.js`

**Interfaces:**
- Produces: `validateRunmodeFolder(folderName: string) => null | { folder: string, runmode: string, reason: string }` — returns `null` when the folder is valid or not run-mode-qualified; otherwise the offending run-mode string and a human reason. Exported from `osgi-config-runner.js`.

- [ ] **Step 1: Write the failing tests**

Add to `runbook-generator.test.js`. First extend the import on line 10:

```js
const { runOsgiConfigScan, validateRunmodeFolder, scanUnsupportedRunmodes } = require('./osgi-config-runner.js');
```

Then add this block after the existing `osgi-config-runner` tests (after line 119):

```js
// ── URC: run-mode folder validation ─────────────────────────────────────────

test('validateRunmodeFolder accepts valid supported run-mode folders', () => {
  for (const name of ['config', 'install', 'config.author', 'config.publish',
    'config.dev', 'config.stage', 'config.prod', 'config.author.dev',
    'config.publish.prod', 'install.author', 'install.publish.stage']) {
    assert.strictEqual(validateRunmodeFolder(name), null, `${name} should be valid`);
  }
});

test('validateRunmodeFolder flags tier-after-environment ordering violations', () => {
  const bad = validateRunmodeFolder('config.dev.author');
  assert.ok(bad, 'config.dev.author is unsupported');
  assert.strictEqual(bad.runmode, 'dev.author');
  assert.match(bad.reason, /must precede/i);
});

test('validateRunmodeFolder flags unknown tokens and preview', () => {
  assert.ok(validateRunmodeFolder('config.preprod'), 'preprod is unknown');
  assert.ok(validateRunmodeFolder('config.author.preprod'), 'preprod after author still unknown');
  assert.ok(validateRunmodeFolder('install.local'), 'local is unknown');
  assert.ok(validateRunmodeFolder('config.preview'), 'preview cannot be declared');
});

test('validateRunmodeFolder flags duplicate tier/environment tokens', () => {
  assert.match(validateRunmodeFolder('config.author.publish').reason, /tier/i);
  assert.match(validateRunmodeFolder('config.author.dev.stage').reason, /environment/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && node --test --test-name-pattern='validateRunmodeFolder' runbook-generator.test.js`
Expected: FAIL — `validateRunmodeFolder is not a function`.

- [ ] **Step 3: Implement the validator**

In `osgi-config-runner.js`, after the `CONFIG_FOLDER_RE` block (after line 46), add:

```js
// AEM as a Cloud Service supported run-mode tokens. Custom tokens are
// unsupported; `preview` inherits from publish and cannot be declared.
const TIER_TOKENS = new Set(['author', 'publish']);
const ENV_TOKENS = new Set(['dev', 'stage', 'prod']);

// A run-mode-qualified config/install folder: `config` or `install` followed by
// one or more `.token` segments. Bare `config`/`install` (no suffix) does not
// match and is always valid.
const RUNMODE_FOLDER_RE = /^(config|install)((?:\.[a-z0-9-]+)+)$/i;

/**
 * Validate one OSGi config / bundle install folder name against the AEM CS
 * supported run-mode set and the tier-before-environment ordering rule.
 *
 * @param {string} folderName e.g. 'config.author.dev' or 'install.local'
 * @returns {null | {folder: string, runmode: string, reason: string}}
 *   null when valid (or not run-mode-qualified); otherwise the offending
 *   run-mode string (dot-joined) and a human-readable reason.
 */
function validateRunmodeFolder(folderName) {
  const m = RUNMODE_FOLDER_RE.exec(folderName);
  if (!m) return null; // bare config/install or not a config/install folder
  const tokens = m[2].slice(1).toLowerCase().split('.'); // drop leading dot
  const runmode = tokens.join('.');

  let tierCount = 0;
  let envCount = 0;
  let seenEnv = false;
  for (const tok of tokens) {
    if (TIER_TOKENS.has(tok)) {
      if (seenEnv) {
        return { folder: folderName, runmode,
          reason: `tier run mode '${tok}' must precede the environment run mode` };
      }
      tierCount += 1;
    } else if (ENV_TOKENS.has(tok)) {
      envCount += 1;
      seenEnv = true;
    } else {
      return { folder: folderName, runmode, reason: `unsupported run mode token '${tok}'` };
    }
  }
  if (tierCount > 1) return { folder: folderName, runmode, reason: 'more than one tier run mode' };
  if (envCount > 1) return { folder: folderName, runmode, reason: 'more than one environment run mode' };
  return null;
}
```

Update the `module.exports` line (currently line 173) to include the new function:

```js
module.exports = { runOsgiConfigScan, collectConfigFiles, SECRET_KEY_RE, validateRunmodeFolder, scanUnsupportedRunmodes };
```

(`scanUnsupportedRunmodes` is added in Task 2; exporting it now is harmless because Task 2 tests are not yet written. If running Task 1 in strict isolation, temporarily drop `scanUnsupportedRunmodes` from the exports and re-add it in Task 2.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && node --test --test-name-pattern='validateRunmodeFolder' runbook-generator.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/aem/cloud-service/skills/migration/scripts/osgi-config-runner.js plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.test.js
git commit -m "feat(migration): URC run-mode folder validator with ordering rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Local URC folder scanner

Walks the workspace, applies `validateRunmodeFolder` to every `config.*` / `install.*` folder, and emits flag-only findings in the same shape `runOsgiConfigScan` uses.

**Files:**
- Modify: `plugins/aem/cloud-service/skills/migration/scripts/osgi-config-runner.js`
- Test: `plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.test.js`

**Interfaces:**
- Consumes: `validateRunmodeFolder` (Task 1).
- Produces: `scanUnsupportedRunmodes(workspaceRoot: string) => { ok: boolean, findings: Array<{location, detail, severity}>, rawFindings: Array<{pattern:'osgiConfig', file, line:null, snippet, kind:'unsupported-runmode', runmode}>, error?: string }`. Exported from `osgi-config-runner.js`.

- [ ] **Step 1: Write the failing tests**

Add to `runbook-generator.test.js`, below the Task 1 URC tests:

```js
test('scanUnsupportedRunmodes flags unsupported config/install folders only', () => {
  const root = mkworkspace();
  write(root, 'ui.config/jcr_root/apps/my/config.dev.author/com.my.Svc.cfg.json', '{ "a": 1 }\n');
  write(root, 'ui.apps/jcr_root/apps/my/install.local/my-bundle.jar', 'x');
  write(root, 'ui.config/jcr_root/apps/my/config.author.dev/com.my.Ok.cfg.json', '{ "a": 1 }\n');
  write(root, 'ui.apps/jcr_root/apps/my/install.publish/ok-bundle.jar', 'x');
  const res = scanUnsupportedRunmodes(root);
  assert.strictEqual(res.ok, true);
  const kinds = res.rawFindings.map(f => f.kind);
  assert.ok(kinds.every(k => k === 'unsupported-runmode'));
  const runmodes = res.rawFindings.map(f => f.runmode).sort();
  assert.deepStrictEqual(runmodes, ['dev.author', 'local']);
});

test('scanUnsupportedRunmodes returns ok with no findings for a clean tree', () => {
  const root = mkworkspace();
  write(root, 'ui.config/jcr_root/apps/my/config.author.stage/com.my.Ok.cfg.json', '{ "a": 1 }\n');
  const res = scanUnsupportedRunmodes(root);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.rawFindings.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && node --test --test-name-pattern='scanUnsupportedRunmodes' runbook-generator.test.js`
Expected: FAIL — `scanUnsupportedRunmodes is not a function`.

- [ ] **Step 3: Implement the scanner**

In `osgi-config-runner.js`, after `validateRunmodeFolder` (from Task 1), add:

```js
// A folder whose name is run-mode-qualified (`config.<x>` / `install.<x>`).
const RUNMODE_QUALIFIED_DIR_RE = /^(config|install)\./i;

/** Recursively collect run-mode-qualified folder paths. Skips build/vcs dirs. */
function collectRunmodeFolders(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'target' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (RUNMODE_QUALIFIED_DIR_RE.test(e.name)) acc.push(full);
    collectRunmodeFolders(full, acc);
  }
  return acc;
}

/**
 * Scan a workspace for URC (Unsupported Run modes Configuration): OSGi
 * `config.<runmode>` and bundle `install.<runmode>` folders whose run mode is
 * not supported on AEM as a Cloud Service. Flag-only — never modifies anything.
 * Local fallback for when no BPA report is available.
 *
 * @returns {{ ok: boolean, findings: Array, rawFindings: Array, error?: string }}
 */
function scanUnsupportedRunmodes(workspaceRoot) {
  if (!workspaceRoot) return { ok: false, findings: [], rawFindings: [], error: 'no workspaceRoot' };
  let folders;
  try { folders = collectRunmodeFolders(workspaceRoot); }
  catch (err) { return { ok: false, findings: [], rawFindings: [], error: err.message }; }

  const findings = [];
  const rawFindings = [];
  for (const folder of folders) {
    const bad = validateRunmodeFolder(path.basename(folder));
    if (!bad) continue;
    findings.push({
      location: folder,
      detail: `unsupported-runmode — folder '${path.basename(folder)}' (${bad.reason}); rename to a supported run mode or remove`,
      severity: 'high',
    });
    rawFindings.push({
      pattern: 'osgiConfig',
      file: folder,
      line: null,
      snippet: `unsupported run mode '${bad.runmode}'`,
      kind: 'unsupported-runmode',
      runmode: bad.runmode,
    });
  }
  return { ok: true, findings, rawFindings };
}
```

Ensure `scanUnsupportedRunmodes` is in `module.exports` (added in Task 1).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && node --test --test-name-pattern='scanUnsupportedRunmodes' runbook-generator.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/aem/cloud-service/skills/migration/scripts/osgi-config-runner.js plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.test.js
git commit -m "feat(migration): local URC scanner over config.*/install.* folders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: BPA report mapping for `unsupported.runmode`

Teach the parser + unified-collection reader to expose URC findings as the `urc` pattern (subtype `unsupported.runmode`), path-keyed like the existing content/legacy-UI subtypes.

**Files:**
- Modify: `plugins/aem/cloud-service/skills/migration/scripts/bpa-local-parser.js`
- Modify: `plugins/aem/cloud-service/skills/migration/scripts/unified-collection-reader.js`
- Create: `plugins/aem/cloud-service/skills/migration/scripts/fixtures/urc-bpa.csv`
- Test: `plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.test.js`

**Interfaces:**
- Consumes: `getBpaFindings(pattern, options)` from `bpa-findings-helper.js` (existing).
- Produces: pattern slug `urc` resolvable through `getBpaFindings('urc', { bpaFilePath, collectionsDir, limit, offset })`, returning `{ success, targets }` where each target has `className` = the JCR folder path and `identifier` = `unsupported.runmode`.

- [ ] **Step 1: Create the fixture CSV**

Create `fixtures/urc-bpa.csv` with real-shaped rows (a count row that must be excluded, two URC detail rows, and one unrelated row so the report parses as multi-pattern):

```csv
code,type,subtype,importance,identifier,message,context
_COUNT_URC,_count.unsupported.runmode.configuration,unsupported.runmode,CRITICAL,2,Count: 2,"{""data"":{""unfilteredTotal"":2}}"
URC,unsupported.runmode.configuration,unsupported.runmode,CRITICAL,/apps/demo/config.dev.author,A configuration name based on an unsupported run mode was found at /apps/demo/config.dev.author.,"{""data"":{""runmode"":""dev.author""},""type"":""unsupported.runmode""}"
URC,unsupported.runmode.configuration,unsupported.runmode,CRITICAL,/apps/demo/config.preprod,A configuration name based on an unsupported run mode was found at /apps/demo/config.preprod.,"{""data"":{""runmode"":""preprod""},""type"":""unsupported.runmode""}"
BPA-001,issue,sling.commons.scheduler,high,com.demo.Job,Uses Sling scheduler,
```

- [ ] **Step 2: Write the failing test**

Add to `runbook-generator.test.js`. First add the import near the top (after line 13):

```js
const { getBpaFindings } = require('./bpa-findings-helper.js');
```

Then add:

```js
// ── URC: BPA report mapping ─────────────────────────────────────────────────

test('getBpaFindings resolves the urc pattern from a BPA CSV, excluding count rows', async () => {
  const dir = mkworkspace();
  const csv = path.join(dir, 'bpa.csv');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'urc-bpa.csv'), csv);
  const collectionsDir = path.join(dir, 'collections');
  const res = await getBpaFindings('urc', { bpaFilePath: csv, collectionsDir, limit: null, offset: 0 });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.targets.length, 2, 'two URC detail rows, count row excluded');
  const locations = res.targets.map(t => t.className).sort();
  assert.deepStrictEqual(locations, ['/apps/demo/config.dev.author', '/apps/demo/config.preprod']);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && node --test --test-name-pattern='resolves the urc pattern' runbook-generator.test.js`
Expected: FAIL — pattern `urc` not found / `res.success` false.

- [ ] **Step 4: Add the subtype to the parser**

In `bpa-local-parser.js`, add `'unsupported.runmode'` to the `CONTENT_SUBTYPES` array (currently ends at line 52):

```js
const CONTENT_SUBTYPES = [
  'custom.classic.widget',
  'legacy.dialog.classic',
  'legacy.dialog.coral2',
  'legacy.custom.component',
  'legacy.static.template',
  'custom.static.template',
  'forward.replication',
  'reverse.replication',
  'unsupported.runmode',
];
```

- [ ] **Step 5: Add the pattern mapping to the unified reader**

In `unified-collection-reader.js`, add `urc` to `PATTERN_TO_SUBTYPES` (currently ends at line 47):

```js
  replication: ["forward.replication", "reverse.replication"],
  urc: ["unsupported.runmode"],
};
```

And add `urc` to the path-keyed `CONTENT_PATTERNS` set (line 50):

```js
const CONTENT_PATTERNS = new Set(["cdw", "lui", "templateModernization", "replication", "urc"]);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && node --test --test-name-pattern='resolves the urc pattern' runbook-generator.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/aem/cloud-service/skills/migration/scripts/bpa-local-parser.js plugins/aem/cloud-service/skills/migration/scripts/unified-collection-reader.js plugins/aem/cloud-service/skills/migration/scripts/fixtures/urc-bpa.csv plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.test.js
git commit -m "feat(migration): map BPA subtype unsupported.runmode to urc pattern

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire BPA-first URC into the osgiConfig config-scan

Add the URC sub-step to the `osgiConfig` config-scan block: prefer BPA report URC findings, fall back to the local scanner, merge into `osgiConfig` findings.

**Files:**
- Modify: `plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.js:324-334`
- Test: `plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.test.js`

**Interfaces:**
- Consumes: `scanUnsupportedRunmodes` (Task 2), `getBpaFindings` (existing), `normalizeBpaTarget`/`rawBpaTarget` (existing, `runbook-generator.js:177,193`), `bpaMode` in scope.
- Produces: URC findings merged into `findingsByPattern.osgiConfig` / `rawFindingsByPattern.osgiConfig`.

- [ ] **Step 1: Write the failing tests**

Add to `runbook-generator.test.js`:

```js
// ── URC: report-first with local fallback (end to end) ──────────────────────

test('URC comes from the BPA report when a report is present (report owns it)', async () => {
  const root = mkworkspace();
  // Bad folder on disk that the report does NOT list — report ownership means
  // it is treated as clean and the local scanner is not consulted.
  write(root, 'ui.config/jcr_root/apps/my/config.stage.author/com.my.Svc.cfg.json', '{ "a": 1 }\n');
  const csv = path.join(root, 'bpa.csv');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'urc-bpa.csv'), csv);
  const gathered = await gatherFindings({ workspaceRoot: root, bpaFilePath: csv, collectionsDir: path.join(root, 'collections') });
  const urc = gathered.rawFindingsByPattern.osgiConfig.filter(f => f.kind === 'unsupported-runmode');
  // No local-kind findings (kind is only set by the local scanner)…
  assert.strictEqual(urc.length, 0, 'local scanner did not run because BPA owns URC');
  // …but the report URC folders are present as osgiConfig findings.
  const locations = gathered.findingsByPattern.osgiConfig.map(f => f.location);
  assert.ok(locations.some(l => String(l).includes('config.dev.author')), 'URC from report present');
});

test('URC falls back to local detection when no BPA source is present', async () => {
  const root = mkworkspace();
  write(root, 'ui.config/jcr_root/apps/my/config.dev.author/com.my.Svc.cfg.json', '{ "a": 1 }\n');
  const gathered = await gatherFindings({ workspaceRoot: root });
  const urc = gathered.rawFindingsByPattern.osgiConfig.filter(f => f.kind === 'unsupported-runmode');
  assert.strictEqual(urc.length, 1, 'local scanner produced the URC finding');
  assert.strictEqual(urc[0].runmode, 'dev.author');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && node --test --test-name-pattern='URC (comes|falls back)' runbook-generator.test.js`
Expected: FAIL — no `unsupported-runmode` findings / report URC not merged.

- [ ] **Step 3: Import the local scanner in the generator**

In `runbook-generator.js`, extend the import on line 51:

```js
const { runOsgiConfigScan, scanUnsupportedRunmodes } = require('./osgi-config-runner.js');
```

- [ ] **Step 4: Add the URC sub-step to the config-scan block**

Replace the config-scan block (`runbook-generator.js:324-334`) with:

```js
  // ── Strategy 'config-scan': osgiConfig (independent of the cascade) ──────
  if (CANONICAL_PATTERNS.includes('osgiConfig') && workspaceRoot) {
    const res = runOsgiConfigScan(workspaceRoot);
    if (res.ok) {
      findingsByPattern.osgiConfig = res.findings;
      rawFindingsByPattern.osgiConfig = res.rawFindings;
      sourceByPattern.osgiConfig = 'config-scan';
      scannedBy.osgiConfig = 'config-scan';
      if (res.warnings && res.warnings.length) scanWarnings.push(...res.warnings);

      // URC (unsupported run modes) — report-first, local fallback. Kept under
      // osgiConfig: the secret/legacy scan above is always local; only this URC
      // sub-portion prefers the BPA report. When a BPA source is present it owns
      // the URC verdict (even zero findings = clean); the local scanner runs
      // only when there is no BPA source or the fetch genuinely failed.
      let urcFindings = [];
      let urcRaw = [];
      let bpaOwnsUrc = false;
      if (bpaMode) {
        const urc = await getBpaFindings('urc', {
          bpaFilePath, collectionsDir, projectId, mcpFetcher, limit: null, offset: 0,
        });
        if (urc.success && Array.isArray(urc.targets)) {
          urcFindings = urc.targets.map(normalizeBpaTarget);
          urcRaw = urc.targets.map(t => rawBpaTarget('osgiConfig', t));
          bpaOwnsUrc = true;
        } else if (urc.availablePatterns) {
          // Report parsed fine but URC absent → genuinely clean; report owns it.
          bpaOwnsUrc = true;
        }
        // else: real fetch error → fall through to the local scanner.
      }
      if (!bpaOwnsUrc) {
        const localUrc = scanUnsupportedRunmodes(workspaceRoot);
        if (localUrc.ok) { urcFindings = localUrc.findings; urcRaw = localUrc.rawFindings; }
      }
      findingsByPattern.osgiConfig.push(...urcFindings);
      rawFindingsByPattern.osgiConfig.push(...urcRaw);
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && node --test --test-name-pattern='URC (comes|falls back)' runbook-generator.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && npm test`
Expected: PASS — all pre-existing tests plus the new URC tests. In particular the registry test (exactly 10 canonical patterns) still passes because URC lives under `osgiConfig`, and the "config-scan tagged heuristic" test still passes (URC is local in that test).

- [ ] **Step 7: Commit**

```bash
git add plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.js plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.test.js
git commit -m "feat(migration): BPA-first URC detection under osgiConfig with local fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Documentation — reference doc + scripts README

Bring the human-facing docs in line with the implemented behavior: relabel Phase 1a as URC, document the ordering rule, `install.*` scope, and Adobe remediation; add the subtype to the supported-patterns table.

**Files:**
- Modify: `plugins/aem/cloud-service/skills/migration/references/osgi-cfg-json-cloud-manager.md`
- Modify: `plugins/aem/cloud-service/skills/migration/scripts/README.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update Phase 1a in the reference doc**

In `references/osgi-cfg-json-cloud-manager.md`, replace the **1a. Invalid runmode folders** subsection (lines 203-205) with:

```markdown
**1a. Unsupported run modes (URC)**

Adobe's Pattern Detector reports these as **URC** (Unsupported Run modes Configuration; BPA `subtype` **`unsupported.runmode`**, `importance` **CRITICAL**). Configurations based on unsupported run mode names **have no effect** when deployed to AEM as a Cloud Service.

The migration runbook sources URC **BPA-report-first** (from the CAM/MCP fetch or a local BPA CSV) and only runs local folder detection when no BPA report is available. Local detection covers both **`config.<runmode>`** and bundle **`install.<runmode>`** folders.

A folder is flagged when its run mode is unsupported. Beyond unknown tokens (e.g. `config.qa`, `config.preprod`, `install.local`), note the **ordering rule**: the tier token must **precede** the environment token. `config.author.dev` is valid; **`config.dev.author` is not** — even though `dev` and `author` are individually valid. A folder may carry at most one tier and one environment token, and **`config.preview` cannot be declared** (preview inherits from publish).

Report (flag-only): folder path, the offending run mode, and remediation — **evaluate whether the configuration is needed → rename to a supported run mode identifier following the run-mode resolution rules → remove if obsolete**. See the `aem-guides-wknd-legacy` `code/urc` branch for corrected examples. Sources: [URC pattern](https://experienceleague.adobe.com/en/docs/experience-manager-pattern-detection/table-of-contents/urc), [Configuring OSGi](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/deploying/configuring-osgi).
```

- [ ] **Step 2: Add install.* to the repository scope note**

In the same file, update the "Out of scope for automated edits" bullet about runmode folders (line 156) to:

```markdown
- Reorganizing runmode folder structure (unsupported **`config.*`** / **`install.*`** folders are **flagged** as URC, not moved or renamed).
```

- [ ] **Step 3: Update the cleanup enum**

In the Phase 3 handoff JSON `type` enum (line 277), add `unsupported_runmode`:

```json
      "type": "invalid_runmode | unsupported_runmode | archetype_default | duplicate_config | env_specific_url | deprecated_config",
```

- [ ] **Step 4: Update the one-line summary**

Update the summary line (line 308) so Phase 1 mentions URC:

```markdown
**Phase 0:** convert legacy formats → **Phase 1:** flag URC (unsupported run modes, BPA-first / local fallback over `config.*` + `install.*`), archetype defaults, duplicates, env-specific URLs, deprecated configs → **Phase 2:** inject `$[secret:]` / `$[env:]` placeholders on custom PIDs → **Phase 3:** gitignored handoff file with variables + cleanup items → **no** secrets in chat.
```

- [ ] **Step 5: Add the subtype to the scripts README**

In `scripts/README.md`, add a row to the "Supported Patterns" table (after the `replication` row, ~line 179):

```markdown
| urc | unsupported.runmode |
```

- [ ] **Step 6: Verify no code broke (docs-only, but run the suite once)**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && npm test`
Expected: PASS (unchanged from Task 4).

- [ ] **Step 7: Commit**

```bash
git add plugins/aem/cloud-service/skills/migration/references/osgi-cfg-json-cloud-manager.md plugins/aem/cloud-service/skills/migration/scripts/README.md
git commit -m "docs(migration): document URC detection (ordering rule, install scope, remediation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Safe auto-reorder fix (ordering-only)

Deterministic fix for the subset where every token is a valid tier/env in the wrong order. Unknown tokens and duplicate tier/env are never touched. Detection (Tasks 1–4) is unaffected; this is an apply-time mutation with a collision guard and a default dry-run.

**Files:**
- Modify: `plugins/aem/cloud-service/skills/migration/scripts/osgi-config-runner.js`
- Modify: `plugins/aem/cloud-service/skills/migration/references/osgi-cfg-json-cloud-manager.md`
- Test: `plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.test.js`

**Interfaces:**
- Consumes: `validateRunmodeFolder`, `collectRunmodeFolders`, `RUNMODE_FOLDER_RE`, `TIER_TOKENS`, `ENV_TOKENS` (Tasks 1–2, same module).
- Produces:
  - `reorderRunmodeFolder(folderName: string) => null | { from: string, to: string }` — `null` unless a pure ordering fix exists.
  - `applyRunmodeReorders(workspaceRoot: string, options?: { dryRun?: boolean }) => { ok: boolean, dryRun: boolean, renamed: Array<{from,to}>, skipped: Array<{folder, target?, reason}>, error?: string }`. Both exported from `osgi-config-runner.js`.

- [ ] **Step 1: Write the failing tests**

Extend the `osgi-config-runner` import in `runbook-generator.test.js` (the line edited in Task 1) to:

```js
const { runOsgiConfigScan, validateRunmodeFolder, scanUnsupportedRunmodes, reorderRunmodeFolder, applyRunmodeReorders } = require('./osgi-config-runner.js');
```

Add this test block after the Task 2 tests:

```js
// ── URC: safe auto-reorder fix ──────────────────────────────────────────────

test('reorderRunmodeFolder fixes ordering-only violations and skips the rest', () => {
  assert.deepStrictEqual(reorderRunmodeFolder('config.dev.author'), { from: 'config.dev.author', to: 'config.author.dev' });
  assert.deepStrictEqual(reorderRunmodeFolder('install.stage.publish'), { from: 'install.stage.publish', to: 'install.publish.stage' });
  assert.strictEqual(reorderRunmodeFolder('config.author.dev'), null, 'already valid');
  assert.strictEqual(reorderRunmodeFolder('config.preprod'), null, 'unknown token — not auto-fixable');
  assert.strictEqual(reorderRunmodeFolder('config.author.publish'), null, 'two tiers — not auto-fixable');
});

test('applyRunmodeReorders dry-run plans the rename without touching disk', () => {
  const root = mkworkspace();
  const bad = write(root, 'ui.config/jcr_root/apps/my/config.dev.author/com.my.Svc.cfg.json', '{ "a": 1 }\n');
  const badDir = path.dirname(bad);
  const res = applyRunmodeReorders(root); // dryRun defaults to true
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.dryRun, true);
  assert.strictEqual(res.renamed.length, 1);
  assert.match(res.renamed[0].to, /config\.author\.dev$/);
  assert.ok(fs.existsSync(badDir), 'dry-run must NOT rename on disk');
});

test('applyRunmodeReorders apply renames ordering-only folders on disk', () => {
  const root = mkworkspace();
  const bad = write(root, 'ui.config/jcr_root/apps/my/config.dev.author/com.my.Svc.cfg.json', '{ "a": 1 }\n');
  const badDir = path.dirname(bad);
  const goodDir = path.join(path.dirname(badDir), 'config.author.dev');
  const res = applyRunmodeReorders(root, { dryRun: false });
  assert.strictEqual(res.renamed.length, 1);
  assert.ok(!fs.existsSync(badDir), 'old folder gone');
  assert.ok(fs.existsSync(path.join(goodDir, 'com.my.Svc.cfg.json')), 'renamed folder + contents present');
});

test('applyRunmodeReorders skips on collision and skips unknown tokens', () => {
  const root = mkworkspace();
  // Collision: valid target already exists next to the bad folder.
  write(root, 'ui.config/jcr_root/apps/my/config.dev.author/com.my.Svc.cfg.json', '{ "a": 1 }\n');
  const collidedTarget = write(root, 'ui.config/jcr_root/apps/my/config.author.dev/com.my.Other.cfg.json', '{ "b": 2 }\n');
  // Unknown token: never auto-fixed.
  const unknown = write(root, 'ui.config/jcr_root/apps/my/config.preprod/com.my.Svc.cfg.json', '{ "a": 1 }\n');
  const res = applyRunmodeReorders(root, { dryRun: false });
  assert.strictEqual(res.renamed.length, 0, 'nothing renamed');
  const reasons = res.skipped.map(s => s.reason).join(' | ');
  assert.match(reasons, /already exists/i);
  assert.match(reasons, /not auto-fixable/i);
  assert.ok(fs.existsSync(path.dirname(collidedTarget)), 'existing target untouched');
  assert.ok(fs.existsSync(path.dirname(unknown)), 'unknown-token folder untouched');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && node --test --test-name-pattern='reorderRunmodeFolder|applyRunmodeReorders' runbook-generator.test.js`
Expected: FAIL — `reorderRunmodeFolder is not a function`.

- [ ] **Step 3: Implement the reorder + apply functions**

In `osgi-config-runner.js`, after `scanUnsupportedRunmodes` (Task 2), add:

```js
/**
 * If `folderName` is a pure ordering violation — every token a known tier/env,
 * at most one of each, currently out of canonical `<prefix>.<tier>.<env>` order —
 * return the corrected name. Otherwise (valid, unknown token, or duplicate
 * tier/env) return null. Deterministic and side-effect free.
 *
 * @returns {null | {from: string, to: string}}
 */
function reorderRunmodeFolder(folderName) {
  const m = RUNMODE_FOLDER_RE.exec(folderName);
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const tokens = m[2].slice(1).toLowerCase().split('.');
  const tiers = tokens.filter(t => TIER_TOKENS.has(t));
  const envs = tokens.filter(t => ENV_TOKENS.has(t));
  if (tiers.length + envs.length !== tokens.length) return null; // unknown token(s)
  if (tiers.length > 1 || envs.length > 1) return null;          // duplicate tier/env
  const canonical = [prefix, ...tiers, ...envs].join('.');
  if (canonical === folderName.toLowerCase()) return null;       // already valid
  return { from: folderName, to: canonical };
}

/**
 * Apply safe auto-reorder fixes across a workspace. Only ordering-only
 * violations are renamed; unknown tokens and duplicate tier/env are skipped.
 * A rename is skipped when its target folder already exists (renaming would
 * change PID resolution — manual merge required).
 *
 * MUTATION: with `dryRun: false` this renames folders on disk. Defaults to
 * `dryRun: true` (plan only). Never called during runbook generation.
 *
 * @param {string} workspaceRoot
 * @param {{dryRun?: boolean}} [options]
 * @returns {{ ok: boolean, dryRun: boolean, renamed: Array, skipped: Array, error?: string }}
 */
function applyRunmodeReorders(workspaceRoot, options = {}) {
  const { dryRun = true } = options;
  if (!workspaceRoot) return { ok: false, dryRun, renamed: [], skipped: [], error: 'no workspaceRoot' };
  let folders;
  try { folders = collectRunmodeFolders(workspaceRoot); }
  catch (err) { return { ok: false, dryRun, renamed: [], skipped: [], error: err.message }; }

  const renamed = [];
  const skipped = [];
  for (const folder of folders) {
    const name = path.basename(folder);
    const bad = validateRunmodeFolder(name);
    if (!bad) continue; // valid folder — nothing to fix
    const fix = reorderRunmodeFolder(name);
    if (!fix) { skipped.push({ folder, reason: `not auto-fixable (${bad.reason})` }); continue; }
    const target = path.join(path.dirname(folder), fix.to);
    if (fs.existsSync(target)) {
      skipped.push({ folder, target, reason: 'target folder already exists — manual merge required' });
      continue;
    }
    if (!dryRun) {
      try { fs.renameSync(folder, target); }
      catch (err) { skipped.push({ folder, target, reason: `rename failed: ${err.message}` }); continue; }
    }
    renamed.push({ from: folder, to: target });
  }
  return { ok: true, dryRun, renamed, skipped };
}
```

Update `module.exports` (the line from Task 1) to:

```js
module.exports = {
  runOsgiConfigScan, collectConfigFiles, SECRET_KEY_RE,
  validateRunmodeFolder, scanUnsupportedRunmodes,
  reorderRunmodeFolder, applyRunmodeReorders,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && node --test --test-name-pattern='reorderRunmodeFolder|applyRunmodeReorders' runbook-generator.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Document the fix in the reference doc**

In `references/osgi-cfg-json-cloud-manager.md`, immediately after the Phase 1a URC subsection (added in Task 5), add:

```markdown
**URC auto-fix (apply step, opt-in).** Ordering-only violations — every token a
valid tier/env in the wrong order, e.g. `config.dev.author` → `config.author.dev`
(and `install.<env>.<tier>` likewise) — can be fixed **deterministically** by
reordering to `<prefix>.<tier>.<env>`. This is a folder rename (a mutation), so
it runs only in the apply flow, never during runbook generation:

1. Run `applyRunmodeReorders(workspaceRoot)` (dry-run) and show the planned
   renames.
2. On user confirmation, run `applyRunmodeReorders(workspaceRoot, { dryRun: false })`.

**Never auto-fixed** (flag-only, human decision required): unknown-token folders
(`config.preprod`, `config.qa`, `install.local`) and duplicate tier/env folders
(`config.author.publish`). A reorder whose **target folder already exists** is
also skipped — renaming would change PID resolution and needs a manual merge.
```

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `cd plugins/aem/cloud-service/skills/migration/scripts && npm test`
Expected: PASS — all prior tests plus the 4 new fix tests.

- [ ] **Step 7: Commit**

```bash
git add plugins/aem/cloud-service/skills/migration/scripts/osgi-config-runner.js plugins/aem/cloud-service/skills/migration/scripts/runbook-generator.test.js plugins/aem/cloud-service/skills/migration/references/osgi-cfg-json-cloud-manager.md
git commit -m "feat(migration): safe URC auto-reorder fix with collision guard

Deterministic reorder of ordering-only run-mode folders (config.dev.author ->
config.author.dev). Unknown tokens and duplicate tier/env stay flag-only;
targets that already exist are skipped. Mutating apply defaults to dry-run.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- BPA-first sourcing + local fallback → Task 4. ✓
- URC kept under `osgiConfig` (not a new canonical pattern) → Task 4 (registry test unchanged). ✓
- Subtype `unsupported.runmode`, path-keyed → Task 3. ✓
- Local detector over `config.*` + `install.*`, ordering rule, preview, unknown tokens → Tasks 1–2. ✓
- Detection flag-only → Tasks 2, 5. ✓
- Safe auto-reorder fix (ordering-only, collision guard, dry-run default) + unknown/duplicate stay flag-only → Task 6. ✓
- Reference doc relabel + remediation + install scope + cleanup enum → Task 5. ✓
- README supported-patterns table → Task 5. ✓
- Tests: report-first wins, local fallback, ordering violation, unknown token, valid pass, no regressions → Tasks 1–4. ✓
- Never emit secret values: URC code reads only folder names; existing safety tests stay green → Task 4 Step 6. ✓

**Placeholder scan:** No TBD/TODO; every code and test step contains full content. ✓

**Type consistency:** `validateRunmodeFolder` return shape `{folder, runmode, reason}` used identically in Tasks 1–2 and consumed in Task 6; `scanUnsupportedRunmodes` return shape used in Tasks 2 and 4; `reorderRunmodeFolder` `{from,to}` and `applyRunmodeReorders` `{ok,dryRun,renamed,skipped}` consistent across Task 6 code + tests; `getBpaFindings('urc', …)` target fields (`className`, `identifier`) consistent with `normalizeBpaTarget`/`rawBpaTarget`. Task 6 reuses `RUNMODE_FOLDER_RE`, `TIER_TOKENS`, `ENV_TOKENS`, `collectRunmodeFolders` from Tasks 1–2 (same module — must be defined before use). ✓
