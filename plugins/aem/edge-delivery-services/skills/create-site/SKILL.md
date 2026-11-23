---
name: create-site
description: "Use this when a user wants to create a brand-new AEM Edge Delivery site from scratch: no GitHub repository or content exists yet, or a repo made from the boilerplate template is not connected to content yet. Triggers include 'set up a new site', 'create a new EDS project', 'onboard a new site'. Covers creating the repo from the boilerplate, installing aem-code-sync, choosing the content store (DA at admin.da.live or Source Bus at api.aem.live), seeding nav, footer and homepage, and returning a live preview URL. For importing existing pages use page-import; for blocks on an existing site use content-driven-development."
license: Apache-2.0
metadata:
  version: "1.3.0"
---

# Create a New AEM Edge Delivery Site

**Do NOT use for:** importing or migrating pages (**page-import**), applying a brand to a fresh project (**brand-setup**), or blocks on an existing site (**content-driven-development**).

## Prerequisites

- A GitHub account that can create repositories in the target org, and `gh` authenticated (`gh auth status`) or a token with `repo` scope.
- An Adobe IMS account with access to the content store (see **da-auth**).

## Step 1: Gather inputs

Ask for the GitHub org (`{{ORG}}`), repository name (`{{REPO}}`, also the site name), and a display name (`{{SITE_NAME}}`, derived from the repo name if not given). Ask which **content store** (`{{STORE}}`) the site uses, DA or Source Bus; do not guess. Org, repo and branch cannot contain `--`, and `main--{{REPO}}--{{ORG}}` must stay within 63 characters.

## Step 2: Create the repository

If the user already made a repository from the boilerplate, confirm which one and go to Step 3.

## Step 3: Install aem-code-sync and pick the content store *(user action)*

Tell the user:

> 1. Open https://github.com/apps/aem-code-sync/installations/new
> 2. Choose **Only select repositories**, select **{{ORG}}/{{REPO}}**, and save.
> 3. In the setup wizard on tools.aem.live that follows, choose the content source: **{{STORE}}**. (If the wizard is skipped, a script can set it in Step 4.)
>
> Reply "done" when complete.

Wait for confirmation. Then check, without credentials, that the site exists: `curl -s -o /dev/null -w '%{http_code}' https://admin.hlx.page/ping/{{ORG}}/{{REPO}}` returns 200 (404 means not set up). Do not use `/status/` for this: it returns 401 without a token.

## Step 4: Confirm or switch the content store

A site's store is `content.source` in its site config; `fstab.yaml` is deprecated and ignored once the config service holds the site. Read the config with the IMS token from **da-auth** (`GET https://admin.hlx.page/config/{{ORG}}/sites/{{REPO}}.json`):

| Store | `content.source` |
|---|---|
| DA | `{"type": "markup", "url": "https://content.da.live/{{ORG}}/{{REPO}}"}` |
| Source Bus | `{"type": "sourcebus"}` |

To change it (admin or site config permission needed): `POST https://admin.hlx.page/config/{{ORG}}/sites/{{REPO}}/content.json` ([Update Content Location](https://www.aem.live/docs/config-service-setup)). Send back the full `content` object you read, with only `source` changed (`{"type": "sourcebus"}`, or the DA values above to go back). A changed store gets a new Content Bus ID: nothing previewed or published before is carried over, and index and sitemap config must be recreated. How content moves between stores is not documented: assume it does not move and copy it by hand. Switch before seeding content, not after.

## Step 5: Seed the content

Get a token with **da-auth** for the chosen API. Create `nav`, `footer` and `index` pages with **da-content**, which has the write call and HTML rules for each store (DA and Source Bus differ). The homepage needs an `<h1>`.

`aem content` only talks to DA: for a Source Bus site write pages through the API.

## Step 6: Preview and hand off

Preview each page (`/nav`, `/footer`, `/`) with the preview call for the store; see **da-content**. Expect 200 or 201, then open the site's `.aem.page` preview.

Hand the user the preview URL, the repo URL and the editing links for the store, and offer next steps: more pages, **brand-setup**, **content-driven-development**.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Step 3 ping returns 404 | Code Sync not installed on this repo; resend the link |
| Preview is 404 right after setup | Nothing previewed yet; run Step 6 |
| 401 or 403 on content calls | See **da-auth**; check the API matches the store |
| Content calls find nothing in a site that has content | Wrong store; read `content.source` (Step 4) |
