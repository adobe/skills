---
name: commerce-app-review
description: Use when validating an App Builder app before submitting to Adobe Exchange, or when the user mentions Adobe Commerce app compliance, extension review, marketplace submission, or Adobe Exchange listing. Checks security requirements, project structure, documentation completeness, and dependency health; reports MUST-have blockers and NICE-to-have recommendations and walks through each finding interactively.
license: Apache-2.0
---

# Self-review an App Builder app

Reviews a local app directory against Adobe's Commerce submission guidelines and walks through each finding interactively — MUST-have blockers first, then NICE-to-have recommendations.

## Inputs

- `APP_PATH` *(optional)* — path to the app root. Defaults to the current working directory.
- `APP_TYPE` *(required)* — `downloadable` or `non-downloadable`. A downloadable app allows merchants to download the source package; a non-downloadable app is installed directly from Adobe Exchange with one click.

## Procedure

### 1. Validate the path and app type

If `APP_PATH` is not provided, use the current working directory. Confirm it exists and is a directory. If not, stop and report:

> Path not found. Please provide the path to the root of your app codebase.

If `APP_TYPE` is not provided, ask:

> **Is this app downloadable or non-downloadable?**
> - **Downloadable** — merchants download the source package and deploy it themselves
> - **Non-downloadable** — merchants install directly from Adobe Exchange with one click

Do not proceed until both are confirmed.

Check whether `aio` is installed (e.g. `command -v aio`). This is a presence check only — do not attempt to authenticate at this stage. If `aio` is not found, note it once:

> Note: `aio` isn't installed. Walkthrough enrichment (Step 8) will use fallback knowledge
> unless `aio` is installed and authenticated before then.

Continue either way.

### 2. Load local references

Read `references/finding.md` and all files under `references/exceptions/` (paths relative to this skill file).

Load pattern files conditionally:
- references/patterns/cors-storefront-actions.md — always
- references/patterns/accs-rest-api-dependency.md — always
- references/patterns/aio-commerce-sdk.md — always
- references/patterns/admin-ui-sdk.md — only if commerce/backend-ui/1 is in app.config.yaml or ext.config.yaml, or @adobe/uix-guest/@adobe/uix-core in package.json

Pattern files take precedence over fetched guidelines. Exception files suppress findings from both.

If any file is not found, skip and continue.

### 3. Fetch the guidelines

Fetch both pages using `curl`. Use raw GitHub URLs — the rendered developer.adobe.com pages are not reliably accessible:

- **Submission guidelines**: `https://raw.githubusercontent.com/AdobeDocs/commerce-extensibility/refs/heads/main/src/pages/app-development/app-submission-guidelines.md`
- **Admin UI SDK checklist**: `https://raw.githubusercontent.com/AdobeDocs/commerce-extensibility/refs/heads/main/src/pages/admin-ui-sdk/app-review-checklist.md` — only if `commerce/backend-ui/1` is in `app.config.yaml` or `ext.config.yaml`, or `@adobe/uix-guest`/`@adobe/uix-core` in `package.json`

If a page is unreachable, note which one failed, proceed with the other, and warn the user that coverage is partial.

### 4. Read the app

Read these files in order:

1. `app.config.yaml` — extension points, actions, inputs, annotations, productDependencies
2. `package.json` — name, description, author, version, dependencies, scripts
3. `env.dist` / `env.example` / any `env.*` at the root — documented env vars
4. `README.md` — installation instructions, events, API requirements
5. `deploy.yaml` — app ID, APIs, workspaces
6. `install.yaml` — extension points (if Admin UI SDK detected)
7. Every `*.config.yaml` and `ext.config.yaml` under `src/` and `actions/`
8. Every `index.js` under `actions/`
9. `web-src/src/` — UI code, innerHTML, routing
10. `extension-manifest.json` — if Admin UI SDK detected

If a file does not exist, note it and continue.

### 5. Review

Build a complete list of checks from the pattern files and fetched guidelines. Then work through every item silently, one by one. Do not skip any item.

**Exclude the following entirely — do not check:**
- `npm audit`, `npx npm-check`, or any check requiring running npm
- Exchange listing URL, repository visibility, screenshots in Exchange listing
- Any check requiring a live Exchange listing, deployed environment, or external URL

For each item:
- Check it against the files read in Step 4
- If confirmed → record as FINDING with severity, file, and line number
- If an exception in `references/exceptions/` applies → suppress it
- If not applicable to `APP_TYPE` → skip it

**Before recording any FINDING, verify it in the actual files. If you cannot point to a specific file and line number, do not flag it.**

**Before flagging a missing package — verify it is directly imported in source files, not just a transitive dependency.**

After working through all items, collect all FINDINGs and assign codes: `MUST-<n>` and `NICE-<n>`. Merge closely related findings before assigning codes.

For each finding track:
- `SEVERITY` — `MUST` or `NICE`
- `DESCRIPTION` — one sentence, specific and actionable
- `FILE_PATH` — **absolute** path to the relevant file; empty for general issues. Render as a markdown link: `[relative/path](file:///absolute/path)`
- `LINE_NUMBER` — specific line; 0 for general issues
- `CATEGORY` — one or more of: `security` · `documentation` · `code` · `dependencies` · `other`

### 6. Present the raw findings list

Print a concise findings list — **no enrichment yet**. Format:

```
Found N MUST-have issue(s) and M NICE-to-have recommendation(s).

**MUST — blockers**
- MUST-1: <one-line description> (`<FILE_PATH>`, line <LINE_NUMBER>)
- MUST-2: …

**NICE — recommendations**
- NICE-1: <one-line description> (`<FILE_PATH>`, line <LINE_NUMBER>)
- NICE-2: …
```

Omit a group heading if it is empty. Omit the file reference when `FILE_PATH` is empty.

After the list, show:

> Type **walkthrough** to go through each finding · **MUST-n** or **NICE-n** to dig into a specific one · or ask anything.

Then wait for the user's response.

### 7. Respond to the user

- **"walkthrough"** (or equivalent intent) → go to Step 8
- **A finding code** (e.g. "MUST-2", "NICE-1") → enrich that finding and present it; show the actions line again and wait
- **Anything else** → answer it; show the actions line again and wait

Repeat until the user ends the session or all findings have been walked through.

### 8. Walkthrough mode

Work through all findings sequentially — MUST first, then NICE. Before starting, obtain the IMS token (see below).

- If the group is empty, say so and move on.
- For each finding in code order:
  1. Show a numbered header (e.g. `--- MUST issue [n/N] ---`)
  2. Enrich the finding and print it
  3. Show: `**"resolve it"**` to work on this finding together · `**"next"**` to move on · or ask anything
  4. Wait for the user's reply

After the last finding, close with a short encouraging message including how many findings were resolved (e.g. "X of N+M findings resolved") and wish the developer good luck.

---

## Obtain IMS token

Run once per session, the first time enrichment is needed:

```bash
IMS_TOKEN=$(aio auth login --bare 2>/dev/null)
```

- If `$IMS_TOKEN` is non-empty → use the documentation agent for enrichment.
- If empty → warn the user; instruct them to run `aio login` and restart for the best experience; ask whether to continue without enrichment or stop.

## Enrich a finding

1. **If IMS token is available**, query the documentation agent:

```bash
curl -s -X POST https://commerce-docs-prod-endpoint-d0ctgyebe7bec8e6.a02.azurefd.net/api/query \
  -H "Authorization: Bearer $IMS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "<topic derived from the finding>", "count": 5}'
```

Pick the `index` based on category:
- `security`, `deployment`, `code` → `app-builder-docs`
- `documentation`, `dependencies` → `commerce-extensibility-docs`
- default → omit `index`

2. **Read the actual file** at `FILE_PATH` and `LINE_NUMBER`. Generate a concrete before/after fix specific to the developer's code — not a generic example.

3. **Compose the enriched finding** using the format in `references/finding.md`.

If the agent returns no results, fall back to App Builder / Commerce knowledge and continue.

## Failure modes

- **Path not found** → stop and report; do not proceed
- **Guidelines page unreachable** → note which failed; proceed with the other; warn coverage is partial
- **`aio` not installed or not authenticated** → warn the user, instruct them to run `aio login`, and ask whether to continue without enrichment or stop
- **Documentation agent returns no results** → fall back to App Builder / Commerce knowledge; do not stop
