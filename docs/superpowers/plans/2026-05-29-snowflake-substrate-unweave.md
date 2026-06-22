# Snowflake substrate un-weave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop shipping a frozen copy of Adobe's `scripts.js`; ship the overlay engine as its own module and apply only a small anchored hook to the repo's existing `scripts.js`, so upstream boilerplate evolution survives an install.

**Architecture:** Extract the engine block out of the bundled `scripts.js` into a new snowflake-owned `scripts/overlay-engine.js` (wholesale-replaced like the other substrate files). Add a new `inject` operation to `install-substrate.mjs` that performs anchored, idempotent edits to the repo's `scripts.js` (one import + one `loadEager` guard). On a missing/ambiguous anchor, fail loud with the snippet (hybrid: agent applies it). Detection collapses to two states — not-installed / already-installed.

**Tech Stack:** Node 22 (ESM, built-ins only), `node:test` + `node:assert` for tests, JSON manifest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-29-snowflake-substrate-unweave-design.md`

**Working dir for all paths below:**
`plugins/aem/edge-delivery-services/skills/snowflake/`

---

## File Structure

- `assets/substrate/scripts/overlay-engine.js` — **new.** The extracted engine (`readBlockSlots`, `parseFirst`, `writeSlot`, `applySlotsToTemplate`, `resolveTemplateName`, `applyTemplateOverlay`). Snowflake-owned, wholesale-replaceable.
- `assets/substrate/scripts/scripts.js` — **deleted.** No longer shipped.
- `assets/substrate/MANIFEST.json` — `replace` swap, new `inject` block, marker needle, version.
- `assets/substrate/VERSION` — `1.1.0`.
- `scripts/install-substrate.mjs` — new `applyInject()`; detection keyed off marker + inject needles.
- `scripts/install-substrate.test.mjs` — **new.** `node:test` harness + behavior tests.
- `phases/0-prereq.md`, `HOST-NOTES.md` — docs reflect inject vs replace.

---

## Task 1: Extract the engine module and re-shape the bundle

**Files:**
- Create: `assets/substrate/scripts/overlay-engine.js`
- Delete: `assets/substrate/scripts/scripts.js`
- Modify: `assets/substrate/MANIFEST.json`
- Modify: `assets/substrate/VERSION`

- [ ] **Step 1: Create `overlay-engine.js` from the current engine block**

Copy lines 37–209 **verbatim** from the current `assets/substrate/scripts/scripts.js` (the block from `function readBlockSlots(main) {` through the end of `async function applyTemplateOverlay(main) { … }` at the `}` on line 209). Wrap with the engine's only external dependencies and a single export:

```js
import { getMetadata, loadCSS } from './aem.js';

/* =====================================================================
   STATIC-TO-EDS OVERLAY ENGINE
   Extracted from scripts.js so snowflake no longer ships a frozen copy
   of Adobe's boilerplate engine. See knowledge/architecture.md.
   ===================================================================== */

// <<< paste lines 37–209 verbatim here:
//     readBlockSlots, parseFirst, writeSlot, applySlotsToTemplate,
//     resolveTemplateName, applyTemplateOverlay >>>

export { applyTemplateOverlay };
```

Only `applyTemplateOverlay` is exported; the rest are module-internal. The pasted block already references only `getMetadata`, `loadCSS`, and `window.hlx` — no other imports needed.

- [ ] **Step 2: Verify the module parses**

Run: `node --check assets/substrate/scripts/overlay-engine.js`
Expected: no output, exit 0.

- [ ] **Step 3: Delete the bundled `scripts.js`**

Run: `git rm assets/substrate/scripts/scripts.js`
Expected: file staged for deletion.

- [ ] **Step 4: Update `MANIFEST.json` — replace list, inject block, marker, version**

In `assets/substrate/MANIFEST.json`:

Bump the version:
```json
"substrateVersion": "1.1.0",
```

Replace the `marker` object with:
```json
"marker": {
  "file": "scripts/scripts.js",
  "needle": "overlay-engine.js",
  "_comment": "Presence of the overlay-engine import proves both that the engine module is installed and that scripts.js is hooked. Renaming overlay-engine.js is a breaking change anyway."
},
```

In the `replace` array, **remove** the `scripts/scripts.js` entry and **add** (anywhere in the array):
```json
{
  "src": "scripts/overlay-engine.js",
  "dst": "scripts/overlay-engine.js",
  "purpose": "Static-to-EDS overlay engine (readBlockSlots, writeSlot, applySlotsToTemplate, resolveTemplateName, applyTemplateOverlay). Snowflake-owned module imported by scripts.js."
},
```

Add a new top-level `inject` array (after `replace`, before `ignorePatches`):
```json
"inject": [
  {
    "file": "scripts/scripts.js",
    "edits": [
      {
        "id": "overlay-import",
        "anchor": "} from './aem.js';",
        "insert": "import { applyTemplateOverlay } from './overlay-engine.js';",
        "skipIf": "overlay-engine.js"
      },
      {
        "id": "overlay-eager-hook",
        "anchor": "  decorateTemplateAndTheme();\n  const main = doc.querySelector('main');",
        "insert": "  if (main && await applyTemplateOverlay(main)) {\n    document.body.classList.add('appear');\n    return;\n  }",
        "skipIf": "applyTemplateOverlay(main)"
      }
    ]
  }
],
```

- [ ] **Step 5: Update `VERSION`**

Set `assets/substrate/VERSION` to:
```
1.1.0
```

- [ ] **Step 6: Verify the manifest parses and shape is correct**

Run:
```bash
node -e "const m=require('./assets/substrate/MANIFEST.json'); console.log('v', m.substrateVersion); console.log('marker', m.marker.needle); console.log('replace has scripts.js?', m.replace.some(r=>r.dst==='scripts/scripts.js')); console.log('replace has overlay-engine?', m.replace.some(r=>r.dst==='scripts/overlay-engine.js')); console.log('inject files', m.inject.map(i=>i.file));"
```
Expected:
```
v 1.1.0
marker overlay-engine.js
replace has scripts.js? false
replace has overlay-engine? true
inject files [ 'scripts/scripts.js' ]
```

- [ ] **Step 7: Commit**

```bash
git add assets/substrate/
git commit -m "refactor(snowflake): extract overlay engine into its own module"
```

Note: between this task and Task 3, the installer does not yet process `inject`, so a fresh install would copy the engine but not hook `scripts.js`. That is expected mid-refactor; Task 3 restores full correctness.

---

## Task 2: Test harness + the `inject` operation

**Files:**
- Create: `scripts/install-substrate.test.mjs`
- Modify: `scripts/install-substrate.mjs`

- [ ] **Step 1: Write the test harness and the first failing test**

Create `scripts/install-substrate.test.mjs`. The harness scaffolds a temp git repo with a minimal stock-like `scripts.js`, runs the real installer as a subprocess against it, and asserts on the result.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALLER = join(HERE, 'install-substrate.mjs');

// A minimal scripts.js that mimics the stock boilerplate anchors.
const STOCK_SCRIPTS = `import {
  decorateTemplateAndTheme,
  decorateMain,
  loadSection,
  loadSections,
  waitForFirstImage,
} from './aem.js';

async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }
}

async function loadLazy(doc) {
  const main = doc.querySelector('main');
  await loadSections(main);
}

loadEager(document);
`;

function makeRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}');
  // default stock scripts.js unless overridden
  const all = { 'scripts/scripts.js': STOCK_SCRIPTS, ...files };
  for (const [rel, content] of Object.entries(all)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

function runInstaller(dir, args = []) {
  try {
    const stdout = execFileSync('node', [INSTALLER, ...args], { cwd: dir, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

test('fresh install hooks scripts.js and copies the engine', () => {
  const dir = makeRepo();
  try {
    const r = runInstaller(dir);
    assert.equal(r.code, 0, r.stderr);
    const scripts = read(dir, 'scripts/scripts.js');
    assert.match(scripts, /import \{ applyTemplateOverlay \} from '\.\/overlay-engine\.js';/);
    assert.match(scripts, /if \(main && await applyTemplateOverlay\(main\)\)/);
    assert.ok(existsSync(join(dir, 'scripts/overlay-engine.js')), 'engine copied');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/install-substrate.test.mjs`
Expected: FAIL — `scripts.js` has no `applyTemplateOverlay` import (installer doesn't process `inject` yet).

- [ ] **Step 3: Implement `applyInject` in the installer**

In `scripts/install-substrate.mjs`, add this function just before section "7. Write .snowflake/config.json" (after the ignore-merge block):

```js
// ---------------------------------------------------------------------------
// 6b. Apply anchored, idempotent code injections (manifest.inject)
// ---------------------------------------------------------------------------

function applyInject() {
  for (const target of manifest.inject ?? []) {
    const path = join(REPO_ROOT, target.file);
    let content = readMaybe(path);
    if (content === null) die(`inject target missing: ${target.file}`, 3);
    let changed = false;
    for (const edit of target.edits) {
      if (content.includes(edit.skipIf)) continue; // already applied — idempotent
      const idx = content.indexOf(edit.anchor);
      if (idx === -1) {
        console.error(`[snowflake] could not find the anchor for "${edit.id}" in ${target.file}.`);
        console.error(`[snowflake] Your boilerplate may have changed. Apply this manually,`);
        console.error(`[snowflake] immediately AFTER this anchor: ${JSON.stringify(edit.anchor)}`);
        console.error(`[snowflake] ---`);
        console.error(edit.insert);
        console.error(`[snowflake] ---`);
        process.exit(2);
      }
      if (content.indexOf(edit.anchor, idx + 1) !== -1) {
        die(`anchor for "${edit.id}" is ambiguous in ${target.file} (multiple matches)`, 2);
      }
      if (DRY_RUN) {
        log(`would inject "${edit.id}" into ${target.file}`);
        // mark as applied for this dry-run pass so later same-file edits compute correctly
        content = content.slice(0, idx + edit.anchor.length) + '\n' + edit.insert + content.slice(idx + edit.anchor.length);
        continue;
      }
      const at = idx + edit.anchor.length;
      content = content.slice(0, at) + '\n' + edit.insert + content.slice(at);
      changed = true;
      log(`injected "${edit.id}" into ${target.file}`);
    }
    if (changed && !DRY_RUN) {
      backupOne(target.file);
      writeFileSync(path, content);
    }
  }
}

applyInject();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/install-substrate.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Add idempotency, ambiguity, and fail-loud tests**

Append to `scripts/install-substrate.test.mjs`:

```js
test('inject is idempotent — second run adds nothing', () => {
  const dir = makeRepo();
  try {
    runInstaller(dir);
    const after1 = read(dir, 'scripts/scripts.js');
    runInstaller(dir);
    const after2 = read(dir, 'scripts/scripts.js');
    assert.equal(after1, after2, 'second run changed scripts.js');
    const importCount = (after2.match(/from '\.\/overlay-engine\.js'/g) || []).length;
    assert.equal(importCount, 1, 'import duplicated');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing loadEager anchor fails loud and does not mis-patch', () => {
  // scripts.js without the decorateTemplateAndTheme()/const main sequence
  const mangled = STOCK_SCRIPTS.replace('  decorateTemplateAndTheme();\n', '');
  const dir = makeRepo({ 'scripts/scripts.js': mangled });
  try {
    const r = runInstaller(dir);
    assert.equal(r.code, 2, 'should exit 2 on missing anchor');
    assert.match(r.stderr, /could not find the anchor for "overlay-eager-hook"/);
    // the eager guard must NOT have been inserted
    assert.doesNotMatch(read(dir, 'scripts/scripts.js'), /applyTemplateOverlay\(main\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run all tests**

Run: `node --test scripts/install-substrate.test.mjs`
Expected: PASS (3 tests).

> Note on the fail-loud test: the import edit (`overlay-import`) runs first and succeeds, so `scripts.js` may gain the import line before the eager-hook edit aborts. The assertion only checks the *eager guard* was not inserted. If you prefer all-or-nothing, that is a future enhancement — out of scope here.

- [ ] **Step 7: Commit**

```bash
git add scripts/install-substrate.mjs scripts/install-substrate.test.mjs
git commit -m "feat(snowflake): add anchored idempotent inject to substrate installer"
```

---

## Task 3: Detection — two states (not-installed / already-installed)

**Files:**
- Modify: `scripts/install-substrate.mjs:103-130` (the detection + decision region)
- Modify: `scripts/install-substrate.test.mjs`

- [ ] **Step 1: Write the already-installed and upstream-survival tests**

Append to `scripts/install-substrate.test.mjs`:

```js
test('already-installed second run reports no-op', () => {
  const dir = makeRepo();
  try {
    runInstaller(dir);                 // first install
    const r = runInstaller(dir);       // second
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /no-op|already installed/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a custom edit elsewhere in scripts.js survives install', () => {
  const custom = STOCK_SCRIPTS.replace(
    'async function loadLazy(doc) {',
    'function myCustomBlock() { /* SURVIVE-ME */ }\n\nasync function loadLazy(doc) {',
  );
  const dir = makeRepo({ 'scripts/scripts.js': custom });
  try {
    const r = runInstaller(dir);
    assert.equal(r.code, 0, r.stderr);
    assert.match(read(dir, 'scripts/scripts.js'), /SURVIVE-ME/, 'custom code was clobbered');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify the no-op test fails**

Run: `node --test scripts/install-substrate.test.mjs`
Expected: the "already-installed" test FAILS — current detection byte-compares replace files but does not require the inject needles, so a second run re-injects (no-op message not guaranteed). The "survives" test should already PASS.

- [ ] **Step 3: Add the `injectComplete` check and tighten the no-op branch**

In `scripts/install-substrate.mjs`, find the block that computes `allFilesMatchBundle` (around line 103) and the decision `if (markerPresent && allFilesMatchBundle) { … no-op … }` (around line 127).

After the `allFilesMatchBundle` loop, add:

```js
const injectComplete = (manifest.inject ?? []).every((target) => {
  const content = readMaybe(join(REPO_ROOT, target.file));
  return content !== null && target.edits.every((e) => content.includes(e.skipIf));
});
```

Change the no-op condition from:
```js
if (markerPresent && allFilesMatchBundle) {
  log(`substrate v${bundledVersion} already installed (byte-identical) — no-op`);
  process.exit(0);
}
```
to:
```js
if (markerPresent && allFilesMatchBundle && injectComplete) {
  log(`substrate v${bundledVersion} already installed — no-op`);
  process.exit(0);
}
```

The drift branch (`markerPresent && !allFilesMatchBundle`) and the fresh-install branch (`!markerPresent`) are unchanged — when `markerPresent` but `injectComplete` is false (engine present, hook missing), control falls through to the install path, and `applyInject()` (idempotent) adds the missing hook.

- [ ] **Step 4: Run all tests to verify they pass**

Run: `node --test scripts/install-substrate.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/install-substrate.mjs scripts/install-substrate.test.mjs
git commit -m "feat(snowflake): two-state substrate detection keyed off engine import + hook"
```

---

## Task 4: Resolve the `loadLazy` guard

**Files:**
- Read: the boilerplate `aem.js` `loadSections` (in a vanilla `adobe/aem-boilerplate` checkout or the EDS docs)
- Possibly modify: `assets/substrate/MANIFEST.json`, `scripts/install-substrate.test.mjs`

- [ ] **Step 1: Determine whether `loadSections` is a no-op on overlay DOM**

On an overlay page, the engine replaces `main.innerHTML` with the template's markup, which has no `.section[data-section-status]` elements. Inspect `loadSections` in `aem.js`: it iterates `main` sections and loads each.

- If it selects `main > .section` (or similar) and an overlay `main` has none → it is a harmless no-op → **the guard is unnecessary; do nothing further. Skip to Step 3.**
- If it could act on the overlay DOM (e.g. unconditionally touches `main` or all children) → **add the guard (Step 2).**

Record the finding in the commit message.

- [ ] **Step 2 (only if the guard is needed): add the `loadLazy` inject edit + test**

In `MANIFEST.json` `inject[0].edits`, append:
```json
,
{
  "id": "overlay-lazy-guard",
  "anchor": "  await loadSections(main);",
  "insert": "  // snowflake: overlay pages have no EDS sections to load",
  "skipIf": "overlay pages have no EDS sections"
}
```
…and change the approach to a guard wrap. Because `inject` only inserts *after* an anchor, implement the guard as: anchor on `  const main = doc.querySelector('main');` **inside `loadLazy`** is ambiguous with `loadEager`; instead anchor on the `loadLazy`-unique line `  loadFooter(doc.querySelector('footer'));` and insert a flag, then guard the call. If this proves awkward, prefer leaving `loadSections` to run (Step 1 confirmed it is safe) — do not force a fragile multi-anchor edit.

Add a test asserting the guard text appears after install when present in a fixture whose `loadLazy` matches the anchor.

Run: `node --test scripts/install-substrate.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix(snowflake): resolve loadLazy guard for overlay pages (<finding>)"
```

---

## Task 5: Update phase + host docs

**Files:**
- Modify: `phases/0-prereq.md`
- Modify: `HOST-NOTES.md`

- [ ] **Step 1: Update `phases/0-prereq.md` "What gets installed" table**

Replace the `scripts/scripts.js` row with two rows reflecting the new model:

```markdown
| `scripts/overlay-engine.js` | New snowflake-owned module: overlay engine (`applyTemplateOverlay`, `writeSlot`, slot mapping, template resolution). Replaced wholesale. |
| `scripts/scripts.js` | **Not replaced** — hooked in place: one `import` + one `loadEager` guard injected idempotently. Upstream boilerplate changes are preserved. If the installer can't find the anchor, it prints the snippet to add manually. |
```

- [ ] **Step 2: Update `phases/0-prereq.md` engine description**

The existing row described `scripts/scripts.js` as "New overlay engine: applyTemplateOverlay, …". Ensure no remaining text claims `scripts.js` is wholesale-replaced. Add one sentence under the table:

```markdown
`scripts.js` is the only file snowflake hooks rather than replaces, so that
Adobe's ongoing boilerplate improvements to it survive an install.
```

- [ ] **Step 3: Update `HOST-NOTES.md` "The substrate installer" section**

Add to the installer description (after the line about MANIFEST being declarative):

```markdown
The installer performs three kinds of change driven by MANIFEST.json:
`replace` (wholesale file copy, with backup), `ignorePatches`/`gitignore`
(idempotent line merges), and `inject` (anchored, idempotent code insertion).
`scripts.js` is the sole `inject` target — the overlay engine lives in the
wholesale-replaced `scripts/overlay-engine.js`, and `scripts.js` receives only
a small import + `loadEager` guard so upstream boilerplate evolution is kept.
```

- [ ] **Step 4: Commit**

```bash
git add phases/0-prereq.md HOST-NOTES.md
git commit -m "docs(snowflake): describe overlay-engine module and scripts.js inject"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the installer test suite**

Run: `node --test scripts/install-substrate.test.mjs`
Expected: all tests PASS.

- [ ] **Step 2: Run the repo skill validator**

From the repo root, run: `npm run validate`
Expected: snowflake passes the agentskills.io structure check (no errors introduced by the new/removed files).

- [ ] **Step 3: End-to-end dry-run against a real boilerplate (manual)**

```bash
git clone --depth 1 https://github.com/adobe/aem-boilerplate /tmp/sf-e2e && cd /tmp/sf-e2e && git init -q 2>/dev/null; true
node <ABS_PATH>/scripts/install-substrate.mjs --dry-run
```
Expected: reports it would copy `overlay-engine.js` + the 8 replace files and would inject the import + `loadEager` guard into `scripts.js`; exit 0. Inspect that the real boilerplate `scripts.js` contains the `decorateTemplateAndTheme();` + `const main = …` anchor (if Adobe has changed it, the installer fails loud — that is the intended hybrid hand-off).

- [ ] **Step 4: End-to-end conversion (manual, behavior-preserving check)**

In a real overlay run on a freshly-installed repo, confirm the page passes the **Phase 5 browser health gate** — overlay applies (`main[data-overlay]`), no console/network errors, and the 1:1 `dom-equality.mjs` check PASSes. This proves moving the engine to a module changed no runtime behavior. Clean up `/tmp/sf-e2e` with `trash` afterward.

- [ ] **Step 5: Final commit (if any doc/cleanup tweaks were needed)**

```bash
git add -A
git commit -m "chore(snowflake): finalize substrate un-weave"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** module boundary → Task 1; the hook → Tasks 1 (MANIFEST inject) + 2 (applyInject); hybrid fail-loud → Task 2 Step 5; two-state detection → Task 3; MANIFEST/marker/version → Task 1; no migration → not implemented by design (no task, intentional); `loadLazy` open question → Task 4; testing → Tasks 2/3/6.
- **Placeholders:** none. Task 1 Step 1 references a verbatim line-range move (not a placeholder — the source block is identified exactly). Task 4 is intentionally decision-driven with both branches specified.
- **Type/name consistency:** `applyInject`, `injectComplete`, `manifest.inject`, `edit.anchor/insert/skipIf`, marker needle `overlay-engine.js`, and the skipIf needles (`overlay-engine.js`, `applyTemplateOverlay(main)`) are used consistently across Tasks 1–3.
