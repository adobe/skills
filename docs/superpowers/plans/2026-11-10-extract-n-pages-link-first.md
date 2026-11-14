# extract link-first page order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user names N, `crawl.mjs` picks the entry page, then the pages it links to, then other discovered pages, up to N.

**Architecture:** One exported pure helper `selectPages()` in `crawl.mjs` replaces the `withEntry` closure in `discover()`. `parseArgs` records whether `--max` was given with a finite value. Docs point to the script.

**Tech Stack:** Node 22 ESM, `node:assert`, the `check()` helper in `crawl.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-10-extract-n-pages-link-first-design.md`

## Global Constraints

- No change when `--max` is absent (default 25) or `--max 0` (`--all`, `--prep`).
- `--pages` path unchanged: listed pages are never reordered or dropped.
- No new flag. No new dependency.
- No site names in code, tests or docs (`evals/lint/site-names.mjs`).
- Skill prose: fold elsewhere to keep `prose-delta.mjs` near flat.
- Release is a patch: `0.37.1` → `0.37.2`, entry `(#158)`.

## Review Focus

- Entry page links to itself (`/`, `/#top`): it must appear once, first.
- Links with only a hash or trailing-slash difference (`/about`, `/about/`, `/about#team`): one slot.
- Asset links (`/report.pdf`, `/logo.svg?v=2`): skipped in the linked list.
- More links than N: the result is exactly N, in document order, and no sitemap page appears.
- Cross-origin links on the entry page (`https://other.example/`): never selected.

All five are pinned in Task 1's test.

---

### Task 1: `selectPages()` and link-first discovery

**Files:**
- Modify: `plugins/stardust/skills/extract/scripts/crawl.mjs` (`maxPages` ~L207, `parseArgs` ~L216, header `--max` help ~L66, `discover()` ~L586-645)
- Test: `plugins/stardust/skills/extract/scripts/test/crawl.test.mjs`

**Interfaces:**
- Produces: `export function selectPages({ entry, origin, linked, discovered, max, linkFirst }) -> string[]`
  - `entry`: normalized entry URL. `origin`: base for relative URLs.
  - `linked`: hrefs from the entry page in document order. `discovered`: sitemap or BFS list.
  - `linkFirst`: boolean. When true, order is entry, `linked` (same-origin, non-asset), then `discovered`. When false, entry then `discovered` (today's behavior).
  - Normalized with `normalizeUrl`, deduped by `dedupeKey`, sliced to `max`.
- `args.maxGiven: boolean` set in `parseArgs`: true when `--max` is passed and the parsed value is finite.

- [ ] **Step 1: Write the failing tests** in `crawl.test.mjs`. Add `selectPages` to the import list.

```js
check('selectPages: linkFirst — entry, then its same-origin page links in order, then discovered, up to max', () => {
  const entry = 'https://ex.test/';
  const linked = ['https://ex.test/', 'https://ex.test/#top', '/about', '/about/', '/about#team', 'https://other.test/x',
    '/report.pdf', '/logo.svg?v=2', '/pricing', '/contact'];
  const discovered = ['https://ex.test/blog/a', 'https://ex.test/pricing', 'https://ex.test/blog/b'];
  const pick = (max, linkFirst) => selectPages({ entry, origin: 'https://ex.test', linked, discovered, max, linkFirst });
  assert.deepEqual(pick(10, true), ['https://ex.test/', 'https://ex.test/about', 'https://ex.test/pricing',
    'https://ex.test/contact', 'https://ex.test/blog/a', 'https://ex.test/blog/b']);
  assert.deepEqual(pick(3, true), ['https://ex.test/', 'https://ex.test/about', 'https://ex.test/pricing']);
  assert.deepEqual(pick(10, false), ['https://ex.test/', 'https://ex.test/blog/a', 'https://ex.test/pricing',
    'https://ex.test/blog/b']);
  assert.deepEqual(pick(Infinity, true).length, 6);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `node plugins/stardust/skills/extract/scripts/test/crawl.test.mjs`
Expected: `✗ selectPages…` (`selectPages is not a function`), other checks still `✓`.

- [ ] **Step 3: Implement**
  - `selectPages` as specified above. Asset filter on the URL pathname:
    `/\.(pdf|png|jpe?g|gif|webp|avif|svg|ico|css|js|json|xml|txt|zip)$/i`. Same-origin check is `new URL(u).origin === origin` after normalization.
  - `parseArgs`: on `--max`, set `a.maxGiven = Number.isFinite(a.max)`. Default `maxGiven: false`.
  - `discover()`: read the entry page's `a[href]` list once (the existing BFS `page.evaluate`, moved up, after the `--pages` early return). Both the sitemap return and the BFS fallback call `selectPages({ entry, origin: args.origin, linked, discovered, max: args.max, linkFirst: args.maxGiven })`. BFS passes `discovered: linked`. Delete `withEntry`.
  - Header help for `--max`: `discovery cap (default 25; 0 = no cap; listed --pages are never dropped; an explicit N puts the entry page's links first)`.

- [ ] **Step 4: Run, expect pass**

Run: `node plugins/stardust/skills/extract/scripts/test/crawl.test.mjs`
Expected: every check `✓`, exit 0. If an existing `--help` assertion matches the old `--max` line, update it to the new text.

- [ ] **Step 5: Mutation check.** Temporarily set `linkFirst` to always false in `selectPages`. Rerun. Expected: the new check fails. Revert.

- [ ] **Step 6: Commit**

```bash
git add plugins/stardust/skills/extract/scripts/crawl.mjs plugins/stardust/skills/extract/scripts/test/crawl.test.mjs
git commit -m "feat(stardust): extract --max N picks the entry page's links first"
```

### Task 2: Docs, pointers and release

**Files:**
- Modify: `plugins/stardust/skills/extract/reference/ia-extraction.md` § Priority for the cap (rule home)
- Modify: `plugins/stardust/skills/extract/SKILL.md` Inputs `--cap` and Phase 1 step 6 (pointer)
- Modify: `plugins/stardust/skills/stardust/SKILL.md` hands-off "Volume caps" bullet (pointer)
- Modify: `plugins/stardust/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (stardust entry), `plugins/stardust/CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1's behavior: explicit `--max N` means link-first order.

- [ ] **Step 1: Rule home.** Open `ia-extraction.md` § Priority for the cap. At its top, add a short subsection "When the user names N". It says:
  - The agent passes `--cap N`, which becomes `crawl.mjs --max N`.
  - Order: entry page, its same-origin page links in document order, then the other discovered pages.
  - The page-type checklist and scoring below apply only when no N is named.

  Fold the same amount elsewhere in the file. Candidate: the twice-told "default 5 is small, proceed silently" rationale in § Informational output.
- [ ] **Step 2: Pointers.**
  - `extract/SKILL.md` step 6, "Selection heuristic" line. Add: "when the user names N, link-first order". Point to `reference/ia-extraction.md` § Priority for the cap.
  - `stardust/SKILL.md` volume-caps bullet, add: "a user-named N replaces both caps and uses link-first order (`../extract/reference/ia-extraction.md` § Priority for the cap)".
- [ ] **Step 3: Release.** Bump both version fields to `0.37.2`. CHANGELOG heading: `## 0.37.2 — a named page count starts from the entered page and its links (#158)`. Body of 3–5 lines: user feedback, the order, unchanged defaults, the test name.
- [ ] **Step 4: Verify**

Run: `npm run lint:stardust && node plugins/stardust/skills/extract/scripts/test/crawl.test.mjs`
Expected: lints exit 0. `prose-delta` reports a net change near zero for skill `.md` files.

- [ ] **Step 5: Commit**

```bash
git add plugins/stardust .claude-plugin/marketplace.json
git commit -m "docs(stardust): 0.37.2 — link-first order when the user names N"
```
