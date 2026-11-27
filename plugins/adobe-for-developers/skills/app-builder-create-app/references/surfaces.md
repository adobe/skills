# Surfaces: prerequisites and how to try the app

`<local>` is the URL `aio app dev` prints after "To view your local application" (usually `https://localhost:9080`). `aio app dev` also prints an Experience Cloud Shell link for every app; use it only for `excshell`. Before the first preview, the developer opens `<local>` once and accepts the browser's certificate warning. The certificate is self-signed and generated for local development. If the 20-second acceptance window in `aio app dev` passes, that's fine: opening `<local>` and accepting the warning later works too.

| Surface key | Needs | Try it locally |
|---|---|---|
| `excshell` | App Builder only | Use the Experience Cloud link `aio app dev` prints: `https://experience.adobe.com/?devMode=true#/custom-apps/?localDevUrl=<local>` (on stage: `experience-stage.adobe.com`). |
| `cf-admin`, `cf-admin-selected` | AEM as a Cloud Service author access | `https://experience.adobe.com/?devMode=true&ext=<local>&repo=<author-host>#/@<org-short-name>/aem/cf/admin/` |
| `cf-editor` | AEM as a Cloud Service with the new Content Fragment editor | Open a fragment in the editor, copy the browser URL, and add `devMode=true&ext=<local>` to the part **before** `#`. |
| `assets-browse`, `assets-details`, `assets-view` | AEM Assets as a Cloud Service with Assets View (UI extensions need Assets Ultimate) | `https://experience.adobe.com/?devMode=true&ext=<local>&repoId=<author-host>#/@<org-short-name>/assets/workspace/` (note `repoId`, not `repo`). |
| `experience-hub` | AEM as a Cloud Service with Experience Hub | Start with the standalone view of the widget: `<local>/index.html#/<folder-name>`. In-product preview (best effort, not yet confirmed in docs): open AEM Experience Hub, copy the URL, and add `devMode=true&ext=<local>` before `#`. Check `search_adobe_docs` for *"Experience Hub extension preview"* first. |
| `universal-editor` | AEM Sites as a Cloud Service with Universal Editor | Open a page in Universal Editor. In the editor's **Location** field (not the browser bar), add `devMode=true&ext=<local>` to the page URL, after `?`, or after `&` if the URL already has a `?`. Then reload. |
| `workfront` | A Workfront instance on experience.adobe.com | In the Workfront browser tab, open the developer console and run `localStorage.setItem('extensionOverride', '<local>')`, then reload. After a Stage deploy, set the same key to the deployed app URL instead. If the menu item doesn't appear, check the browser console for errors and call `search_adobe_docs` for *"Workfront UI extension local testing"*. |

How to fill in the placeholders:
- `<author-host>`: the AEM author host, for example `author-p1234-e5678.adobeaemcloud.com`, without `https://`.
- `<org-short-name>`: the part after `#/@` in the developer's own experience.adobe.com URL, for example `wknd`. Ask them to copy it rather than guessing.

General rule for any AEM UI (from Adobe's "Verify an extension" guide): open the AEM UI the extension plugs into, copy its URL, and add `devMode=true&ext=<local>` to the query part before `#`.

## After a Stage deploy

- Experience Cloud Shell: the deploy prints *"To view your deployed application in the Experience Cloud shell"* with a link.
- AEM templates (except Workfront): a post-deploy hook prints an **Extension Manager preview** link (`https://experience.adobe.com/aem/extension-manager/preview/…`) that loads the Stage build without publishing it.
- Nobody else in the org sees the extension until it's deployed to Production and approved (see the deploy skill).
