# Pattern catalogue

Pick by class and by whether the target already has an implementation (greenfield vs existing
library). Each pattern: intent · authoring contract · what the mechanism must do · verification
(flows, not presence). Where the mechanism is non-obvious a minimal reference implementation is
embedded as an **example the run adapts** — the plugin ships contracts and tooling, not blocks:
across three migrations no block was reused as-is, every site's CSS is lifted from the source, and
an existing library must be fed rather than forked.

| pattern | classes | disposition | greenfield | existing library |
|---|---|---|---|---|
| `search-index-backed` | S | index-backed | query index + results page + block | feed the library's search (off-origin-data.md) |
| `listing-index-backed` | L, R | index-backed | listings.md | same |
| `modal-loader` | M | rebuild-native | link marker + one runtime module | library's own dialog |
| `chrome-interaction` | M | rebuild-native | motion-observe evidence → header/footer JS | keep |
| `media-as-url` | V | embed-passthrough | player URL as content | same |
| `forms` | F | rebuild-native | forms.md | forms.md § existing library |
| `client-compute` | F | client-only | one block: controls + inline logic | same |
| `consent-gated-tags` | T, A | embed-passthrough | owner config, disabled | library martech behind a host guard |
| `off-origin-data` | A, S, D | data-fed | snapshot + `Source` row | endpoint indirection + shim (off-origin-data.md) |
| `sheet-sync` | D | data-fed | — | `scripts/sync-sheets.mjs` |
| `client-rendered-page` | CR | static-snapshot | settled DOM; blank = human capture | same |
| `locale-tree` | I18N | rebuild-native | locale-trees.md | same |
| `decided-out` | X, A | decided-out | register row | library guards |

## search-index-backed

**Intent.** Search is a service, not a page. The header form's action must never become a
root-relative link to nowhere. **Contract.** A `/search` page with the results block; the header
form posts `?q=` (accept the source's parameter name too). **Mechanism.** Query index configured
through the admin config service (`PUT/POST admin.hlx.page/config/<org>/sites/<site>/content/query.yaml`,
the DA token is authorised — no UI), one bulk `POST /index/<org>/<site>/<ref>/*` with the page list,
a `text` property for excerpts; the block ranks title > description > path, clips excerpt windows
around matches **after skipping the breadcrumb + title lead** the `text` property starts with,
pages client-side, reflects the query into the inputs. Second corpora (a non-migrated library) are
explicitly not reproduced. Per locale tree: one results page each and a `lang` index property.
**Verify.** A known term returns the expected page; pagination; excerpt sample.

```js
// example — index fetch, token-AND ranking, client paging (adapt selectors, copy, sizes)
async function search(q, { index = '/query-index.json', pageSize = 20, page = 1 } = {}) {
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const rows = []; for (let off = 0; ; off += 500) { const j = await (await fetch(`${index}?offset=${off}&limit=500`)).json(); rows.push(...j.data); if (off + 500 >= j.total) break; }
  const score = (r) => terms.reduce((s, t) => s + (r.title?.toLowerCase().includes(t) ? 3 : 0) + (r.description?.toLowerCase().includes(t) ? 1 : 0) + (r.path?.includes(t) ? 1 : 0), 0);
  const hits = rows.map((r) => ({ r, s: score(r) })).filter((x) => terms.every((t) => `${x.r.title} ${x.r.description} ${x.r.text || ''}`.toLowerCase().includes(t))).sort((a, b) => b.s - a.s);
  return { total: hits.length, items: hits.slice((page - 1) * pageSize, page * pageSize).map((x) => x.r) };
}
```

## modal-loader

**Intent.** Pages the source opened in an overlay (a contact form on 49 pages, video pills) stay
ordinary pages and ordinary links. **Contract.** The converter appends `#modal` to any link whose
source carried the modal-load class; the target is a normal page; its dialog heading comes from a
`modal-title` metadata row **on the target page** (on the source it lived on the trigger, with
several variants per target — take the majority across captures, log the variance, never pick a
translation). **Mechanism.** One runtime module: click delegation on `a[href$="#modal"]`; fetch
`<path>.plain.html`; run the site's `decorateMain` + `loadSections` inside a `<dialog>` whose
measures are lifted from the live modal; focus trap, Escape, overlay click, ✕, body scroll lock;
media hrefs embed the player iframe in the large size (autoplay appended here, never authored);
on fetch failure navigate instead. Import only `aem.js` and receive `decorateMain` as an argument —
importing `scripts.js` is a cycle. **Verify.** Click → dialog with the target's heading and its
fields; Escape closes; the target still serves standalone.

```js
// example — scripts/modal.js (styles lifted per site into styles/modal.css)
import { loadCSS, loadSections } from './aem.js';
export default async function openModal(href, { decorateMain, playerHosts = [] } = {}) {
  await loadCSS(`${window.hlx.codeBasePath}/styles/modal.css`);
  const isMedia = playerHosts.some((h) => href.includes(h));
  const dialog = document.createElement('dialog'); dialog.className = `modal modal--${isMedia ? 'large' : 'medium'}`;
  dialog.innerHTML = '<div class="modal__content"><div class="modal__header"><h2 class="modal__heading"></h2><button type="button" class="modal__close" aria-label="Close dialog">×</button></div><div class="modal__body"></div></div>';
  dialog.querySelector('.modal__close').onclick = () => dialog.close();
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { document.body.classList.remove('modal-open'); dialog.remove(); });
  document.body.append(dialog); document.body.classList.add('modal-open'); dialog.showModal();
  const body = dialog.querySelector('.modal__body');
  if (isMedia) { body.innerHTML = `<iframe src="${href.replace(/#modal$/, '')}&autoplay=true" allow="autoplay; encrypted-media; fullscreen" allowfullscreen title="Video"></iframe>`; return; }
  try {
    const url = new URL(href, window.location.href); url.hash = '';
    const doc = new DOMParser().parseFromString(await (await fetch(`${url.pathname}.plain.html`)).text(), 'text/html');
    dialog.querySelector('.modal__heading').textContent = doc.querySelector('meta[name="modal-title"]')?.content || doc.querySelector('h1')?.textContent || '';
    doc.querySelectorAll('h1').forEach((h) => h.remove());
    const main = document.createElement('main'); main.append(...doc.body.children); body.append(main);
    if (decorateMain) decorateMain(main); await loadSections(main);
  } catch { dialog.close(); window.location.href = href.replace(/#modal$/, ''); }
}
```

## media-as-url

**Intent.** The player URL is the content. **Contract.** A link to the vendor player URL carrying
account, player and video id, plus `#modal` for overlays; inline via the site's video/embed block.
Ids come from the detector's V rows **per page and per locale** (six of fourteen locale twins
carried a different id), never from copy, never reused by path. Drive the probe from every
target-less CTA, not a hand-made list. **Verify.** Iframe present **and** a playback request to the
vendor observed with status < 400; with auth scoped to the origin (parity-report.md).

## client-compute

**Intent.** Calculators, filters, score lookups, comparisons: controls + inline logic, no network.
**Signature.** A form (or control group) without action, inline scripts with no `fetch`/XHR.
**Contract.** One block per tool; inputs as rows where they are content (labels, ranges, options),
logic in block JS. **Rule.** Never flatten a client-compute section into a prose block — the
deploy/rollout block triage must refuse to convert a section the inventory marks `client-only` or
modal-bearing into a generic block. **Verify.** Known input → known output.

## consent-gated-tags

**Intent.** Nothing about a tag stack can be re-wired autonomously (domain-bound CMP scripts, report
suites, property ids), but everything observed can be pre-filled. **Contract.** One owner-facing
`scripts/site-config.js`: every observed vendor with ids and endpoints, all `enabled: false`; no
per-page authoring. **Mechanism.** A consent phase loads the CMP with the recorded id and gates the
rest on its groups; a consented phase builds the data layer from page metadata, then loads the tag
manager, analytics, marketing, feedback vendors from config. RUM vendors recorded, not proposed.
First-party collector subdomains need a CNAME on the new host — an owner item. Capture scripts keep
suppressing the banner. Existing library: its martech already does this; keep it behind a hostname
guard on sandbox hosts and document the config. **Verify.** Consent declined → no request to any
gated host; accepted → host-list parity with `_dynamics.json`. Status in the parity report reads
`scaffolded-awaiting-owner`, never "dropped".

## forms → forms.md · off-origin-data → off-origin-data.md · listings → listings.md · locale → locale-trees.md

```js
// example — JSON post with honeypot; empty submission refused; endpoint from config (forms.md)
export async function submit(form, endpoint) {
  if (!endpoint) return form.submit(); // native post when the owner has not named one
  if (form.querySelector('[name="website"]')?.value) return null; // honeypot
  if (!form.checkValidity()) { form.reportValidity(); return null; }
  const data = Object.fromEntries(new FormData(form).entries());
  const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, page: window.location.pathname, timestamp: new Date().toISOString() }) });
  return res.ok;
}
```

## chrome-interaction

Header/footer behaviour (hover dropdowns, search overlay, sticky banner, back-to-top,
time-of-day greeting) is M `chrome only`. Evidence is motion observation (replica's
`motion-observe`), not the detector. Dropdown panels are captured as structure (columns → items
{label, link, description, action}), via a hover probe, not as flat link lists. Clock-dependent
strings are behaviour: reproduce the function with thresholds read from the live JS, never the
captured string.

## client-rendered-page

`CR` with main empty at load. Capture the settled DOM (network idle + non-empty landmark + byte
threshold). A still-blank capture is `needs-human-capture`, batched with every other bot-walled
surface into one request; check first that the source renders for a real user
(`skipped-source-broken` otherwise). Never migrate blank, never fabricate.

## decided-out

Session-bound (sign-in, shortlists, recent searches), regulated capture, features whose consumer is
not on the migrated pages. Register row: feature · reason · production statement. Links kept;
library guards left in place.
