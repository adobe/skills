# Creative-brief intake

Load this when the user uploads, pastes, or attaches a document that looks like a creative/marketing
brief — before any workflow has been named. This intake flow covers **product banners at scale only**
(v1 scope). For other featured workflows, see [`featured-and-templates.md`](featured-and-templates.md).

> **Golden vs. featured:** this intake path builds the **featured** product-banners-at-scale template
> from a brief (agent-facing). A bare user "run banners at scale" with no brief is a **golden** run
> request — route it to `list_golden_workflows`, not here. See [`diagnostics.md`](diagnostics.md) →
> "Running a golden demo by name."
>
> **Intake selects ONLY from the featured catalog.** A creative-brief / intake experience classifies
> and builds exclusively from featured workflows (`list_featured_workflows` / `get_featured_workflow`)
> — it NEVER reads from or surfaces `list_golden_workflows`. Golden is the user-facing bare-run
> surface, not an intake source; the two catalogs never cross here.

## What counts as a creative brief

- Signals: campaign/brand name, target audience, messaging/CTA, a list of ad sizes/dimensions, visual
  direction, production notes.
- If the doc is clearly something else (an invoice, a contact sheet, loose asset files with no brief
  text), don't treat it as intake — fall through to normal `run-workflow` behavior.
- DOCX checkbox note: `☒` means checked/selected, `☐` means unchecked. Record `☒` selections as given;
  never treat an unchecked `☐` as an answer.

## Step 1 — Classify: is this "product banners at scale"?

| Signal in the brief | Verdict |
| --- | --- |
| Display/web banners, multiple standard IAB ad sizes (leaderboard, MREC, skyscraper, mobile banner), product photography + headline/CTA, "scaled"/"at scale"/many variants, per-size or per-SKU copy | **Supported** — product banners at scale |
| Video, motion, spin/360, 3D scene/render | Not supported (today) |
| Retargeting-specific dynamic-user-state ads as the explicit ask (not just "banners") | Not supported (today) |
| Localization-only (same creative, just translate) with no size/scale request | Not supported (today) |
| Packaging / packshots / catalogs-and-circulars / promotional-pricing-only | Not supported (today) |
| Print-only deliverables (no digital ad sizes) | Not supported |

State this explicitly to yourself before proceeding: even though `get_featured_workflow` and
[`featured-and-templates.md`](featured-and-templates.md) know about a dozen featured workflows, **this intake flow only routes to
`product-banners-at-scale`.** Do not auto-route to a different featured workflow just because it seems
"close enough" — that is a deliberate v1 scope limit, not an oversight.

If the brief is ambiguous or mixed (e.g. "banners AND a launch video"), ask one clarifying question
naming the ambiguity before deciding. Only stop once you're confident the primary ask isn't
banners-at-scale.

## Step 2 — Not supported: what to say

> Right now I can only run intake for **product banners at scale** (display/web banner ads in
> multiple sizes, built from product imagery + copy). Your brief looks like it's asking for
> **[name what was detected — e.g. video, retargeting, localization, packaging]**, which isn't
> supported through this intake flow yet.
>
> I can stop here, or — if you'd like — we can build a custom workflow from scratch with
> `compose_workflow` instead. Just let me know.

Rules:

- Only offer `compose_workflow` as an **opt-in** — never invoke it automatically just because the
  brief didn't match.
- Never silently pick a different named featured workflow (e.g. `retargeting`) instead.

## Step 3 — Three-state field resolution (fill / ask / absent)

| State | Meaning | Rule |
| --- | --- | --- |
| **Fill** | Brief states it explicitly | Use verbatim — never reinterpret or reword |
| **Ask** | Brief implies the field exists but the value is missing or unclear | Ask one focused question |
| **Absent** | Brief never mentions it, and the field is optional | Leave unset — don't guess a default and don't ask |

Key sub-rules:

- Never infer or guess a missing **required** value — always ask. A required field with no evidence is
  "ask," not "absent."
- Ask **one question at a time** for narrative fields (audience, messaging, CTA). It's fine to **batch**
  the asset-upload ask — e.g. "please share: your product image(s), your InDesign/PSD template if you
  have one, any custom fonts, and a CSV if you want per-row copy" — since those are independent uploads,
  not sequential judgment calls.
- Never re-ask something already given in the brief. If the user says "it's in the brief," re-read it,
  correct your extraction, and move on.
- **Non-standard size rule**: if the brief lists a size close to but not a standard IAB size (e.g.
  720x90 where 728x90 is standard), flag it and ask — never silently "correct" it.

## Step 4 — Minimal required-fields checklist

| Field | Required? | Format / notes | Ask (paraphrase is fine) |
| --- | --- | --- | --- |
| Product image(s) | Required | jpeg, jpg, png, webp | "Please share your product image(s) — jpg, png, or webp." |
| Ad sizes | Required | list of pixel dimensions | "What sizes do you need (e.g. 300x250, 728x90)?" |
| Headline / body copy | Required | text, per-variant if multiple | — |
| CTA | Required | text | — |
| Template (`.indd`/`.psd`) | Optional | indd, psd, idml, zip — if absent, the featured workflow's default template is used | "Do you have your own InDesign or Photoshop template, or should I use the default?" |
| Fonts | Optional | otf, ttf, woff, woff2, zip | "Any custom fonts you'd like applied?" |
| Merge CSV (scaled/per-row copy) | Optional | csv — `@`-prefixed columns hold uploaded asset **filenames**; the CSV needs a column for each template placeholder (matched **case-insensitively**; image columns keep the `@`). Case alignment is handled by the deterministic rewire, not the CSV. Pass it to `compose_workflow` inline as `csvData` **or** by reference as `csvUrl` (a presigned/public URL the server fetches — you don't have to read the file yourself). See [`featured-and-templates.md`](featured-and-templates.md) for the full `@image` rule, the `csvData`-vs-`csvUrl` precedence, and the coverage pre-flight. **The CSV is supplied twice:** once to `compose_workflow` (`csvData`/`csvUrl`, routing-only — decides image wiring, not baked into the graph) and again to `run_workflow_submit` in `inputs[]` for the input-files node (`mimeType: "text/csv"`, the runtime CSV) | only ask if the brief implies more than a handful of variants/rows |
| Brand guidelines | Optional | pdf | only ask if the brief references a brand kit/style guide not otherwise supplied |

Total variant count is roughly `sizes × copy-variants` — useful for sanity-checking scope, not a field
to ask about directly.

## Step 5 — Run it (MCP tool sequence)

This is intake-specific sequencing only — the mechanics are already documented elsewhere; don't
re-explain them here.

**Assemble all inputs before composing.** Do not call `compose_workflow` or `run_workflow_submit`
until every required input is in hand and resolved — template uploaded, the merge CSV resolved (see
below), all images, and all fonts. Never compose or submit against placeholder or
partial inputs: recomposing on the real data later wastes cycles and can strand a half-wired graph.

**Do not read the CSV's bytes to pass it.** Hand it to `compose_workflow` by reference as `csvUrl`
(a presigned/public URL — the server fetches **and validates** it); fall back to inline `csvData` only
when you already have the raw text in hand. Prefer `csvUrl` whenever the file is large, multi-line, or
only reachable via a presigned URL you can't fetch in-sandbox (`csvUrl` wins if both are given).
Cross-checking `@image` basenames against the heroes you're uploading is an **optional, best-effort**
step — never a precondition to compose. If you can't read the CSV in-sandbox (egress block,
presigned-only URL), **skip the cross-check and pass `csvUrl` anyway** and let the server validate it.
**Never ask the user to paste the CSV just so you can read it** — passing the URL to the tool is the
whole point.

1. `get_featured_workflow({ query: "product banners at scale" })` — full discovery/confirm flow in
   [`featured-and-templates.md`](featured-and-templates.md). Call it even though this skill only
   supports one production type — don't assume the `prepared` shape without calling.
2. **No `compose_workflow` fallback for "no match" here.** If `get_featured_workflow` returns no match
   (e.g. catalog not loaded), stop and report the error — do not silently switch to `compose_workflow`.
   (`compose_workflow` may still be used later in this same run for the custom-template-rewire path per
   `featured-and-templates.md` — that's a different case from "no match.")
3. Upload any provided assets via `upload_asset` — see [`asset-input.md`](asset-input.md) for path/URL/
   paste handling and the permission-error flow.
4. If a custom template was provided, follow the deterministic rewire fast path in
   [`featured-and-templates.md`](featured-and-templates.md) — call `compose_workflow` with
   `customTemplateUrl` and `featuredWorkflowName`; the server fetches and compares tags internally.
   If the user supplied custom fonts, pass them here ONCE as `compose_workflow`'s `fonts` field
   (`[{ presignedUrl, name, storageType }]`) — they are cached with the session and broadcast
   automatically on submit, so you do NOT re-send `defaults.fonts` on `run_workflow_submit`.
4b. If a custom template **and** a CSV were both provided, run the tag ↔ CSV **coverage** pre-flight
   from [`featured-and-templates.md`](featured-and-templates.md) (`get_indesign_tags` / `get_psd_tags`
   diffed against the CSV headers **case-insensitively**) **before** submitting. Stop and report only a
   genuinely missing column or a missing `@` on an image column — not a case difference. When you pass
   the CSV as `csvUrl` (or `csvData`), the server runs this same coverage/validation server-side and
   returns a structured `csv_validation_failed` (missing columns) or `csv_fetch_failed` (bad URL), so
   the local diff is an optional early check, not a hard prerequisite — lean on the server's result
   when you can't read the CSV in-sandbox. The case fix
   is structural: the deterministic `compose_workflow(customTemplateUrl=…)` path rebinds each merge port
   to the template placeholder's exact case, which is what actually prevents the long-running InDesign
   107013 merge failure (re-casing the CSV header does nothing — that text is discarded).
5. `run_workflow_submit` (with `useSessionDefaults: true` on the rewired session). **If a merge CSV
   is in play, you MUST re-supply it here** — the `csvData`/`csvUrl` you passed to `compose_workflow`
   was **routing-only** and is NOT in the session. Send an `inputs[]` entry for the input-files node
   (`content: [{ url, mimeType: "text/csv" }]`, the same CSV again); `useSessionDefaults` does not
   cover it. Read the compose result's `next_step.required_inputs` for the exact input-files
   `node_id` — omitting it fails the run with `[parse-data] no CSV wired to input-file port`. Then poll
   `run_workflow_get_status` → present outputs using the strict 3-step
   "Presenting outputs" sequence already defined in [`SKILL.md`](../SKILL.md) — don't redefine it here.
   Extract the URLs from the response's `OUTPUT URLS:` text block (not the trailing JSON blob), per
   [`asset-input.md`](asset-input.md) — this matters for large scaled batches whose response overflows.
6. On failure: `inspect_run`, per [`diagnostics.md`](diagnostics.md).

## Example creative brief (for reference/testing)

> Sample brief for testing — not real customer content.
>
> **Campaign:** Trailhead Gear Co. — Spring Trail Collection
> **Brand:** Trailhead Gear Co.
>
> **Target audience:** Outdoor enthusiasts, ages 25–40, active on weekends, follow hiking and
> camping content, browsing gear and trail-review sites.
>
> **Messaging:**
> Headline: "Built for the trail. Ready for anything."
> CTA: Shop the Collection →
>
> **Ad sizes:** 300x250, 728x90, 160x600, 300x600
>
> **Visual direction:** Real outdoor photography, natural light, product shown in use on-trail.
>
> **Notes for production:** All sizes share the same headline and CTA — only layout and image crop
> vary. Product images and logo will be provided separately.

Use this to sanity-check Step 1 (should classify as supported) and Steps 3–4 (should ask for product
images and a template preference, since neither is in the brief, but should NOT re-ask for sizes,
headline, or CTA).

