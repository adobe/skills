# AI readability — the checker, the two metrics, and the block rules

Loaded on demand: when the AI-readability gate fails, when a block adds text to the DOM, when a
listing, fragment or chrome decision is being made, or when a customer quotes a "Citation
Readability Score". Four migrations (a family-entertainment chain, a semiconductor company's replica,
a UK package-holiday retailer, a beverage brand pilot) each reverse-engineered a different model of
the checker from the defect class they happened to have, and each spent a round on the wrong fix.
The formula below is read from the extension's own analyzer code (v3.1.0, 2026-09) and reproduced to
the word on one site; do not model it again.

## 1. What Adobe's "AI Content Visibility Checker" computes

```
score = min(100, servedWords / renderedWords × 100)      missingWords = |renderedWords − servedWords|
```

- **Served** ("Agent view"): the page fetched again from the browser with a `ChatGPT-User` user
  agent, no JavaScript. Cookies and site auth ride along; on 403/5xx it falls back to a normal UA.
- **Rendered** ("Human view"): the live DOM serialised after load, as **textContent** — hidden text
  (`display:none`, `[hidden]`, `aria-hidden`, `inert`, collapsed panels) counts fully as rendered.
- Both sides drop `script` (JSON-LD is kept as text), `style`, `template`, media elements, cookie/
  consent containers, and — **by default, the popup number** — every nav/header/footer landmark
  (`nav, header, footer, [role=navigation], [role=banner]`, and class/id names like `.header`,
  `.footer`, `.menu`, `.nav`). A UI toggle counts them back in.
- Tokeniser: whitespace split after punctuation normalisation; URLs kept whole. `noscript` text
  counts on the served side only.
- It is a **count ratio, not a word-set comparison**. The side-by-side diff the tool shows is a
  markdown line diff for display; the score ignores it.

Consequences that follow directly, all measured:

| fact | why |
|---|---|
| What lowers the score is the **number of words JavaScript adds** to the DOM | denominator grows, numerator does not |
| Hidden text is neutral | a served FAQ page with 96 % of its body behind collapsed `[hidden]` answers scores 100 |
| Header/footer fetched at runtime are neutral by default | landmarks are stripped from both sides; inlining chrome into every document moved nothing |
| Wrapping authored text in a generated `<a>` is neutral | hrefs are not text; the diff view shows extra `[`/`](href)` lines, the score does not |
| Text served but removed by JS (metadata block, section metadata, a stashed chrome block) **inflates** the served side | it can mask real deficits — never rely on it |
| Short pages are punished hardest | a fixed runtime payload (a 60-word search panel) is a bigger share of a 250-word page |
| Score bands: ≥95 "Perfect", ≥75 "Good", ≥40 "Fair", else "Poor" | what the customer reads |

## 2. Two metrics — keep them apart

| metric | question | instrument | who cares |
|---|---|---|---|
| **Checker score** | ratio of served words to rendered-DOM words in `main` | `scripts/ai-readability.mjs` (exact reimplementation, both toggles) | the customer's number; the release gate |
| **Served-text parity** | which rendered *words* never appear in the served HTML, per region | same script, `servedGap` per block | non-rendering LLM crawlers; the D12 key-facts rule |

A page can be 100 on the first and still carry a runtime-fetched nav, a fragment and index cards
that no non-rendering crawler reads. A page can be 100 % served-text-complete and score 60 because a
carousel clones its slides. Report both; gate on the first; never promise the first from work on the
second.

## 3. Cause classes and remediation

| cause (rendered words the document does not have) | typical size | remediation |
|---|---|---|
| **Loop clones** (Splide/Swiper geometry: 2×perView copies of every slide, full text, `aria-hidden` + `inert`) | a 5-card rail → 17 cards; 40–60 points on a home page | clones are **presentational**: empty text nodes (TreeWalker), `alt=""`, no `href`, `loading=lazy`, no `role`/`aria-*`; or a loop-less scroll-snap track |
| **Index-fed listings** (block fetches `/query-index.json`, builds every card) | 65 location cards ≈ 850 words; 50 points | document-first listings (§ 4, rule 3) |
| **Runtime fragments** (`<a href="/fragments/x">` → block fetches `.plain.html`) | a form or newsletter 60–330 words per page | inline citation-critical copy; keep UI-label fragments and **credit** them in the report |
| **Definition-driven forms** (block renders labels, sections, options from `data/forms/*.json`) | 335 words on an enquiry page | block accepts authored field rows; JSON stays an import format |
| **Generated labels, counts, duplicates** ("Show more", "N results", sr-only helpers, a cloned chip for another breakpoint, an accordion header cloned for mobile) | 1–5 points, but every page | author the label list; place one element with CSS `order`; drop unauthored sr-only text |
| **Runtime chrome** (`/nav`, `/footer`) | 60–170 words | neutral by default; see § 5 before inlining |
| **Vendor widgets** (calculators, locators, chat, forms a third-party script writes into a mount — class `T` in the dynamics inventory) | 200–400 words per page | author the widget's default-state copy as a block row (labels, result line, fine print) with reserved heights; the block removes it when the vendor renders — ≈0 points and the page stays citable. Never a bare `--exclude-blocks`: the exclusion needs its decision entry (§ 6) |
| **Hidden text**, breakpoint variants, collapsed panels | 0 points | nothing — do not "clip instead of hide" for the score |

## 4. Block rules (deploy § block authoring, alongside EW1–EW10)

1. **`decorate()` adds no words.** Every string a visitor can read is authored — including block
   control labels (Previous/Next, Open, the "N of M" *label*), which are locale-specific on every
   non-English site and belong in the block's label-list row (rule 3). Generated text is allowed
   only for the runtime *values* (live hours, "N results", prices, the N and M themselves) and each
   one is named in the gate allowlist as `block + string`, never per page.
2. **Clones are presentational.** Anything a block duplicates for geometry carries no text, alt,
   href, role or aria. The EW `stripInstrumentation()` pass and this rule apply to the same nodes.
3. **Document-first listings (fallback-first).** The generator writes one authored row per listed
   item carrying the card's text — for grouped listings a heading row per group, then item rows,
   then one label-list row (`<ul>` of the block's UI strings). The block renders from rows and uses
   the index only for non-text fields (images, coordinates) and to **top up** pages published after
   the last write; re-runs recognise their own rows and replace them. Index-only rendering is
   right for thousands of items or per-user results, and such a page needs an authored summary.
   A data-fed band with authored fallback rows for the default state costs ≈0 points.
4. **Fragments carry UI, not copy.** A fragment link is a hole in the served page. Newsletter,
   promo and form copy that should be citable is authored inline; a search panel or share bar can
   stay a fragment. Where a fragment is inlined, keep a `fragment | /fragments/x` section-metadata
   row so a re-sync tool can refresh it from the single source.
5. **Forms accept authored rows.** Field label, help text, option lists and success copy are rows;
   the block may still read a JSON definition for validation and posting.
6. **Card-as-link is a CSS stretch, not a generated wrapper.** Neutral for the score, but it fixes
   the accessible name (one tab stop, the CTA text) and is the EW3/EW6 shape: root
   `position:relative`; the authored CTA (or heading) link gets `.x__link::before { content:"";
   position:absolute; inset:0; z-index:1 }`; the CTA `<p>` must not be positioned (an absolutely
   positioned arrow glyph collapses the overlay to the `<p>` — put the glyph on `a::after` as an
   `inline-block`); anything clickable above it (a play pill) gets `z-index:2`.

## 5. Site chrome — a documented option, not the default

Inlining `/nav` and `/footer` into every document (a trailing block lifted out in `buildAutoBlocks`
and served to `loadFragment('/nav'|'/footer')` in place of the fetch) makes header and footer
readable to non-rendering crawlers and removes two runtime fetches. It does **not** change the
checker's default score, and it costs: nav/footer copy in every document (a 371-link mega-menu is
larger than most info pages), every chrome edit becomes a tool re-run plus a full-site redeploy
(≈5 min per 150 pages with the batch driver), and authors see the block in DA. Two of three owners
asked declined it. Offer it only when the owner wants served-text parity on chrome; ship the code
before the content so live never renders the raw block; put the re-sync tool and the redeploy
driver in the hand-off. Under hands-off this is **never self-resolved**: it is a row of the plan-time
owner decision batch (rollout Phase D / `dynamics-plan`) carrying the cost above and the alternative
(accept the default score, which strips landmarks); until answered, chrome stays a runtime fragment.
`davids-model-lint` flags a `header`/`footer`/`nav`/`page-chrome` block inside a content document
(🟡 CHROME) so the decision is visible in the log.

## 6. The gate

```bash
node skills/deploy/scripts/ai-readability.mjs --origin https://main--site--org.aem.live \
     [--paths stardust/rollout/pages.txt | /path …] [--min 98] [--token-env SITE_TOKEN] \
     [--exclude-blocks client-app,widget,form] [--allowlist stardust/ai-readability-allowlist.json] \
     [--json stardust/qa/ai-readability.json] [--verbose] [--wait <ms>] [--har <file> [--har-url <regex>]]
```

Per page it prints three numbers and a cause table: **strict** — the checker's popup number
(landmarks ignored), plus the toggle-off variant; **code** — strict with referenced fragment documents
credited to the served side and the `--exclude-blocks` app blocks removed from the rendered side
(isolates block-decoration defects from content-architecture decisions); **servedGap** — rendered
words absent from the served HTML, attributed per block (metric 2).

Gate on `code ≥ --min` (default 98) — the part the block code owns. Report `strict` as the customer
number with what is agent-invisible *by design* and its cost (`fragments cost N pts` per page), so the
owner sees a decision, not a bare 84. Where it runs: the deploy atomic contract on the **published**
page; the `qa` `ai-readability` check (same code); `audit` on sampled pages. String allowlist entries
name a block and the runtime string they excuse, with a reason; the script prints every entry used.

**Excluded blocks carry a decision (gate).** `--exclude-blocks` removes a block's words from the
`code` denominator only when the allowlist carries a complete `exclude` entry for it —
`{ "block", "exclude": true, "reason", "fallback": "authored" | "owner-accepted", "decision": "<dyn row>" }`,
`decision` citing the `dynamic-features.md` § Decision batch row (no second file). A word-removing
exclusion without one prints `FAIL undecided exclusion: <block> −N words` and exits 1 (the bar's
code); blocks that removed no words and fragments are untouched. The entry is the escape hatch (no
flag): `authored` = the default-state copy is a block row removed on render; `owner-accepted` = the
strict gap is accepted and printed. Hands-off authors the default state (`fallback: authored`); when
the copy cannot be captured headless the page **fails and stays on preview** (D1/D16), listed among
the open rows — never weakened. `authored` is proven only when the vendor renders: `--har <file>`
replays a recorded vendor session headless (`--har-url` scopes it), `--wait <ms>` lets a late widget
settle, and the excluded block's `servedGap` shows whether the copy is word-complete. The `qa`
check runs the same scorer; it takes these decisions once it reads the allowlist (qa lane).

Facts to carry into any conversation with the owner: the tool ignores header, nav and footer by
default; it fetches as a crawler first and falls back to the pre-JavaScript HTML; hidden text does
not count against the page; the number moves with word counts, so a short page with one runtime
widget can read "Fair" while a long page with the same widget reads "Perfect".
