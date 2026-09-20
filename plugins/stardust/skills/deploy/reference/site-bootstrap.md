# Site bootstrap — repo, mountpoint, Code Sync, seed, before the first deploy

Read:
- § Read when — the trigger: Setup says there is no EDS origin, or deploy/rollout prerequisite 2 fails;
- § Inputs — coordinates and credentials, all by name;
- § The six steps — one command, one pass bar, one capped wait each; run in order, stop at the first failure;
- § Denials and hands-off — what a permission denial does to the run (it is not a blocker for author-only work);
- § Never — the lines this procedure does not cross.

An EDS origin is an implicit prerequisite of every deploy: a repo Code Sync builds, a `fstab.yaml` mountpoint, a DA folder with three seed documents, a preview host that answers 200. Three field projects lost hours to discovering these one by one, or to a bootstrap that was declared done with an empty DA folder. This chapter moves the whole sequence to Setup and gives it a pass bar per step.

## Read when

- Master Setup step 8 ran (the ask reaches `deploy` or `rollout`) **and** there is no origin: `node skills/stardust/scripts/preflight-transports.mjs --org <org> --repo <site>` reports the repo absent (`gh-repo` 404 with the org reachable) or `admin-read` 404 for `<org>/<site>/main`, and `state.json.site.eds` is absent.
- `deploy` § When to use prerequisite 2 (a vanilla `aem-boilerplate` at the repo root) is unmet, or `rollout` Phase A finds no target.
- An origin named in the ask, or an owner-decided `target` row pointing at an existing site, **skips** this chapter: record `site.eds.bootstrappedBy: "existing"` and verify steps 4–6 only.
- An owner-named bootstrap skill in the ask runs instead; the plugin still verifies steps 4–6 and records `bootstrappedBy: "<skill name>"`. Never probe skill descriptions to find one — a description match is not a contract.

**Interactive:** one question, up front — "org/site?" with the `target` default (`stardust/decisions.md` row `target`: `<org>/sdt-<slug>`, private). Then every remote-creating command is printed before it runs. Never ask at the end. **Hands-off:** the default is applied and the row marked `default-applied`; the six steps run at Setup, never after migrate (master § Hands-off mode).

## Inputs

| input | from | notes |
|---|---|---|
| `<org>/<site>` | `stardust/decisions.md` row `target`, else an existing `fstab.yaml` or git remote | the plugin ships the shape, never an org name |
| `GH_PAT` | by name, `state-machine.md` § Credentials key lookup order | classic PAT with `repo` scope — the installation API rejects the `gh` OAuth token and fine-grained PATs |
| `CODE_SYNC_INSTALLATION_ID` | by name, same env files as `GH_PAT` | account-specific and **not discoverable by API** (`GET /user/installations` rejects every user token); the owner supplies it once: GitHub → Settings → Applications → AEM Code Sync → Configure — the id is the URL's last segment. Never hardcode one in skill text |
| `DA_TOKEN` | by name (`da-token-check.mjs`) | `da-deploy-protocol.md` § DA_TOKEN lifecycle |

Absent `GH_PAT` or `CODE_SYNC_INSTALLATION_ID` stops the **bootstrap**, not the run: one instruction naming the variable and the env file's class, the `blocked` line with `owner:` (below), author-only work goes on.

## The six steps

Each step: the command, the pass bar, the capped wait. A failed bar stops here — never continue past it, never skip to "seed" on an unsynced repo.

1. **Repo from the template.** `gh repo create <org>/<site> --template adobe/aem-boilerplate --private` (REST alternative: `gh api -X POST repos/adobe/aem-boilerplate/generate -f owner=<org> -f name=<site> -F private=true`). The template copy is asynchronous: poll `gh api repos/<org>/<site>/commits --jq length` until ≥ 1, at most 6 × 5 s. Private by default (`target` row) — the form most likely to pass a permission classifier; `--public` only on an owner-decided row.
2. **Mountpoint.** Clone, write `fstab.yaml` with `mountpoints:` → `/: https://content.da.live/<org>/<site>/` (the boilerplate no longer ships one), commit, push `main`. Pass bar: the file is on `origin/main`. Never `PUT`/`POST` the config service instead — it needs an org API key the run does not hold; `fstab.yaml` is honoured for a new site.
3. **Code Sync installation.** `GH_TOKEN=$GH_PAT gh api -X PUT /user/installations/$CODE_SYNC_INSTALLATION_ID/repositories/$(gh api repos/<org>/<site> --jq .id)` → 204. This is the step the OAuth token cannot do; a 403 here means the PAT class, not the org.
4. **Served code.** `node skills/deploy/scripts/served-check.mjs https://main--<site>--<org>.aem.page/scripts/aem.js --wait 180` exits 0, then `GET https://admin.hlx.page/sidekick/<org>/<site>/main/config.json` answers 200 (the site config auto-created). Exit 124 = not synced within the cap: re-check step 3, `POST https://admin.hlx.page/code/<org>/<site>/main/*` once, re-run the same command.
5. **Seed, preview-only.** For `index`, `nav`, `footer`: fetch the template's own published body fragment (`https://main--aem-boilerplate--adobe.aem.live/<doc>.plain.html`), `PUT` it through the protocol's single-page form (`da-deploy-protocol.md` § Deploy steps 1–3: sanitise, multipart `data`, then `POST /preview/`). Three documents, three previews, no `POST /live/` (D16). These are the boilerplate documents the protocol marks overwritable — Step 6 chrome and the first migrated page replace them.
6. **Homepage answers.** `node skills/deploy/scripts/served-check.mjs https://main--<site>--<org>.aem.page/ --wait 180` exits 0, and `/nav.plain.html`, `/footer.plain.html` answer 200 (`served-check.mjs … --absent about:error`). Then write `state.json.site.eds` — `{ org, site, repoUrl, previewHost, liveHost, private, bootstrappedAt, bootstrappedBy }` — and `site.deployUrl` = the preview host. Live publish stays the explicit `deploy-batch.mjs … --publish` run or `ship.sh` (D1).

The pass bar of the chapter is step 6, not step 1: a repo without a served `/scripts/aem.js` and a previewing `/` is not an origin. `stardust/rollout/rollout.json` carries no copy of these coordinates — `state.json.site.eds` is the single source.

## Denials and hands-off

Steps 1, 2 (the push) and 3 are privileged actions (`skills/stardust/reference/harness-permissions.md` § Two classes); 4–6 are instruments. On a denial the run asks exactly once — approve, or run the printed command — else it appends `event: "blocked"` with `owner: "<the exact command>"` to `stardust/status.jsonl`, writes the command into `stardust/.work/ship.sh` (`reference/ship-script.md`), leads the state report, journal and reply with `Blocked on owner:`, and continues on author-only work (extract, direct, prototype, replica Phases 1–4, migrate). It never retries a variant of the denied command, never invents a preview URL, never treats a local harness render as the origin. Hands-off changes nothing above: the default is applied, the six bars stay, the seed stays preview-only.

## Never

- Touch `scripts/aem.js` or any runtime file; the template ships as-is.
- Publish the seed (`POST /live/`), or gate on it — it is boilerplate content.
- Print a token, `cat` an env file, or write a credential into `state.json` (classes and names only).
- `POST`/`PUT` the config service, or hardcode a Code Sync installation id.
- Declare the bootstrap done before step 6 passed — "the DA folder is empty" was the recorded failure.
- Continue a `deploy`/`rollout` transport step against an origin that failed a bar; author-only work is the only work that goes on.
