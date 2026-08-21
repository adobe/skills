---
name: adobe-create-pdfs-from-data
description: >
  Perform a full InDesign data merge from a CSV/TSV and an .indd template (or a PDF that gets
  converted to .indd automatically). Use this skill whenever the user wants to merge a data file
  with a layout template — including visiting cards, certificates, badges, catalogs, mailers,
  labels, invoices, or any per-row personalisation. Triggers on: "data merge", "InDesign merge",
  "merge my CSV with InDesign", "batch export PDF from template", "variable data InDesign",
  "personalise each row", or any request combining an .indd / PDF template with a data file.
  Use this skill even when only two of the three inputs (template, data, images) are mentioned —
  and even when the user never uses the phrase "data merge".
license: Apache-2.0
allowed-tools: adobe_mandatory_init asset_inline_preview asset_preview_file asset_initialize_file_upload asset_finalize_file_upload convert_pdf_to_indd export_idml generate_indd_mapping_prompt prepare_indd_merge_template document_merge_data_layout
metadata:
  version: 1.0.1
  visibility: public
---

# InDesign Data Merge Skill

Orchestrates the complete InDesign data merge pipeline. The naive path — calling
`document_merge_data_layout` directly — often fails because the template must have its
data-merge fields **linked to the correct data columns** before merging. This skill ensures
that linkage is in place first, including automatic placeholder creation when the template
has none, and PDF-to-INDD conversion when the user only has a PDF layout.

**Pipeline at a glance:**

| Phase | What happens | Gate |
|-------|-------------|------|
| **0** | Adobe init | — |
| **1a** | Convert PDF template → `.indd` (skip if already `.indd`) | ⛔ GATE 1 |
| **1b** | Confirm `.indd` URL and data file are available | — |
| **2** | Export IDML; detect existing merge placeholders | — |
| **3** | Create placeholders via LLM mapping *(only if Phase 2 found none)* | ⛔ GATE 2 |
| **4** | Run `document_merge_data_layout` | — |

---

## Tool Reference

| Step | Tool | Notes |
|------|------|-------|
| Initialize Adobe tools | `adobe_mandatory_init` | Always call first |
| Inspect PDF pages | `asset_inline_preview` | Returns rendered preview per page |
| Preview PDF pages (fallback) | `asset_preview_file` | Use if `asset_inline_preview` unavailable |
| Upload condensed template PDF | `asset_initialize_file_upload` + `asset_finalize_file_upload` | Required before `convert_pdf_to_indd` |
| Convert PDF → INDD | `convert_pdf_to_indd` | Use extractedDocumentPresignedUrls as `inddUrl` |
| Export IDML | `export_idml` | Outputs presigned IDML URL for inspection |
| Generate mapping prompt | `generate_indd_mapping_prompt` | Read-only; returns prompt — you run it through an LLM |
| Create placeholders in INDD | `prepare_indd_merge_template` | Only after user approves mapping |
| Run data merge | `document_merge_data_layout` | Template + data → merged PDF |

---

## ⛔ MANDATORY GATES

Two rules are non-negotiable and override all efficiency instincts.

### Gate 1 — PDF template: analyse layout before converting

Never call `convert_pdf_to_indd` on a user-supplied PDF without first inspecting its
page layout structure. A multi-page PDF (e.g. a prior merged output) produces a multi-page INDD
which breaks the merge. Always distil it to a single-layout condensed PDF first.

### Gate 2 — Mapping: show and wait before creating placeholders

Never call `prepare_indd_merge_template` in the same turn you generate or display the mapping JSON.
Show the mapping summary + raw JSON, ask for approval, and **end the turn**. Only call
`prepare_indd_merge_template` after the user explicitly approves in a later turn.

---

## Workflow

### Step 0 — Initialize Adobe Tools

```json
{ "skill_name": "adobe-create-pdfs-from-data", "skill_version": "1.0.1" }
```

Call `adobe_mandatory_init` once, before any other Adobe tool.

---

### Step 1a — Convert PDF Template to INDD *(skip if already `.indd`)*

**When to run:** The user's template is a PDF (or any non-INDD layout). If you already have a
usable `.indd` URL, skip directly to Step 1b.

#### Sub-step 1 — Inspect all pages

Record the user-supplied PDF URL as `originalPdfUrl`.

Call `asset_inline_preview` on the PDF (or `asset_preview_file` as fallback). Record `totalPages`.

If `totalPages == 1`: set `templatePdfUrl = originalPdfUrl` and skip to Sub-step 5.

#### Sub-step 2 — Compare page layouts visually

Look at each preview image. Ask: *"If I removed all text and image content and compared only
the skeleton — frame positions, structural regions — would this page match another page?"*

Group pages by layout skeleton into `layoutGroups`:
```
layoutGroups = {
  "layout-A": [1, 2, 3, ...],   // pages sharing layout A
  "layout-B": [N+1, ...],        // pages with a distinct layout B
}
```

Pick `templatePages` as a **single** representative page:
- If `layoutGroups` has exactly 1 entry: `templatePages = [first page in that group]`.
- If `layoutGroups` has >1 entry: ask the user which layout group to use (or default to the group with the most pages) and set `templatePages` to **one** page from that group.

Tell the user:
> "Your PDF has {totalPages} pages. I found {N} unique layout(s). I'll use page {templatePages[0]} as the template. (If you need multiple layouts, we can run separate merges per layout.)"

#### Sub-step 3 — Extract only the template pages

Download the PDF from `{originalPdfUrl}` and extract **only** page(s) `{templatePages}` (1-indexed) to `template-condensed.pdf` using PyMuPDF (fitz). Report the absolute file path as `intermediatePdfLocalPath`.

Record the path as `intermediatePdfLocalPath`.

#### Sub-step 4 — Upload the condensed PDF

```
asset_initialize_file_upload({ path: "template-condensed.pdf", media_type: "application/pdf" })
// PUT the local file bytes to the returned upload URL, then:
asset_finalize_file_upload({ filename: "template-condensed.pdf", transfer_document: <from initialize response> })
```

Record the resulting presigned URL as `templatePdfUrl`.

#### Sub-step 5 — Convert to INDD

```
convert_pdf_to_indd:
  pdfSourceUrl:                        {templatePdfUrl}
  outputFormat:                        "indd"
  embedLinks:                          false
  waitForCompletion:                   true
  includeAdobeZipDownloadLinksInResult: false
```

Use the first entry in **`extractedDocumentPresignedUrls`** as `inddUrl`. If that field is
missing, re-run with `embedLinks: true`. Do not attempt to download or unzip the output ZIP.

---

### Step 1b — Prerequisite Check

Confirm all inputs are accessible (attached files, URLs from conversation, or prior tool calls):
- **`.indd` URL** — if missing, prompt the user to upload their template
- **Data file** — CSV, TSV, or other delimited text; if missing, ask the user
- **Image assets** *(optional)* — any images referenced by the data file (e.g. photo columns)

If any file is a local attachment without a URL, upload it first:
```
asset_initialize_file_upload → asset_finalize_file_upload
```

Record `inddUrl` and `dataUrl`. Proceed only when both are confirmed.

#### Collect image assets *(if the data file references images)*

Parse the header row of `dataUrl`. If any column values look like image filenames or paths
(common with `@`-prefixed image fields in InDesign templates), collect those images:

1. For each unique image filename referenced in the data, obtain a presigned URL — either from
   the user's supplied URLs, or by uploading local files via `asset_initialize_file_upload` +
   `asset_finalize_file_upload`.
2. Build `additionalImageFiles`: a map of `{ "filename.jpg": "<presignedUrl>", ... }` covering
   every unique image referenced across all rows.

Record `additionalImageFiles` (or `{}` if no image columns are present).

---

### Step 2 — Export IDML and Inspect for Placeholders

#### Export IDML

```
export_idml:
  assets:
    - sourceUrl: {inddUrl}  destination: "template.indd"
```

Record the presigned `idmlUrl` from the response.

If `export_idml` fails (missing execute URL), tell the user you cannot proceed with
automatic placeholder creation and ask whether they want to continue manually.

#### Inspect for existing placeholders

Fetch and unzip the IDML. Build `docAnalysis` capturing every candidate merge target:

- **Text frames**: `uid`, bounds, current text content, any existing `<<fieldName>>` or `<AppliedDataMergeField>` tokens
- **Image frames**: `uid`, bounds, aspect ratio, any `@`-prefixed image field names

Extract `idmlPlaceholders: string[]` — unique field names stripped of `<<`/`>>` wrappers.

**If placeholders are found:** skip Phase 3 and go directly to Step 4 using `inddUrl`.

**If no placeholders are found:** proceed to Step 3.

---

### Step 3 — Create Placeholders *(only if Step 2 found none)*

#### Step 3a — Read data headers

Parse the header row of `dataUrl`. Treat the file as delimited text; infer the delimiter if
ambiguous. Preserve exact column name strings as `dataColumns: string[]`.

#### Step 3b — Generate mapping JSON

Call `generate_indd_mapping_prompt` — this returns a prompt string only; it does not call an LLM:

```
generate_indd_mapping_prompt:
  userRequest:      {user's original request}
  tier:             "standard"   (use "complex" for dense templates; "modification" for edits)
  idmlPresignedUrl: {idmlUrl}
  csvInfo:
    headers:      {dataColumns}
    data_types:   {inferred types}
    sample_data:  {first 2–3 rows}
```

Run the returned prompt through an LLM requiring JSON-only output. Record as `mappingJson`.

#### Step 3b.1 — Validate / filter the mapping

Call `generate_indd_mapping_prompt` again with the same inputs, adding:
```
  mappingJson: {mappingJson}
```

If the response includes `filteredMappings` (hallucinated UIDs removed), use it as the working
mapping. Fix any `errors` and re-validate until `isValid: true`.

After the first successful validation, record:
- `originalMappingJson` — the first validated mapping (use `filteredMappings` if returned)
- `originalIdmlUrl` — the `idmlUrl` from Step 2 (never overwrite with a post-edit version)
- `originalInddUrl` — the `inddUrl` from Step 1b (never overwrite with `mappedInddUrl`)

#### Step 3b.2 — ⛔ Show mapping and END TURN (Gate 2)

Your response for this step must contain exactly:
1. A human-readable summary of text/image mappings (placeholder name → CSV column, frame UID)
2. The raw mapping JSON in a code block
3. This confirmation question as the **final line**:
   > "Please confirm this mapping (or tell me what to change). I'll apply it to create
   > placeholders in your `.indd` and then run the merge."

**After that line — no more tool calls, no further narration. End the turn.**

**If the user requests changes**, enter a modification loop:
- Apply only the user's requested deltas on top of `originalMappingJson` — never use an
  intermediate draft or `mappedInddUrl` as the base
- Re-run Step 3b.1 validation with `tier: "modification"`, passing `originalIdmlUrl` and
  `originalMappingJson` in `modificationContext`
- Re-present the updated mapping and ask for confirmation again — do not call
  `prepare_indd_merge_template` until the user approves

#### Step 3c — Apply placeholder mapping to INDD

*Only callable after user explicitly approves in a later turn.*

```
prepare_indd_merge_template:
  assets:
    - sourceUrl: {originalInddUrl}  destination: "template.indd"
  params: {filteredMappings or validated mappingJson}
```

Record the first presigned URL from the response as `mappedInddUrl`.

---

### Step 4 — Run the Data Merge

```
document_merge_data_layout:
  templateSourceUrl:    {mappedInddUrl or inddUrl}
  templateFileName:     "template.indd"
  dataSourceUrl:        {dataUrl}
  additionalImageFiles: {additionalImageFiles}   # omit or pass {} if no image columns
  outputSpecs:          [{ outputMediaType: "application/pdf" }]
  recordRange:          "All"
```

Return download links to the user:
> "Data merge complete — {N} record(s) rendered. Here are your download links:"

---

## Decision Tree

```
User requests data merge
        │
Phase 0: adobe_mandatory_init
        │
Already have .indd URL?
   YES → Step 1b
   NO  → Template is PDF?
           YES → Step 1a.1: inspect all pages
                   → single page? → convert_pdf_to_indd (original URL)
                   → multi-page?  → identify unique layouts → extract condensed PDF
                                  → upload → convert_pdf_to_indd → inddUrl
           NO  → Step 1b (ask for .indd upload)
        │
Step 1b: confirm inddUrl + dataUrl
        │
Step 2: export_idml → parse IDML for placeholders
        │
   Placeholders found?
   YES → Step 4: document_merge_data_layout
   NO  → Step 3a: parse data headers
         Step 3b: generate_indd_mapping_prompt → LLM → mappingJson
         Step 3b.1: validate → filteredMappings
         ⛔ STOP — show mapping + ask approval — END TURN
              │
         [Next turn] user approves?
         YES → Step 3c: prepare_indd_merge_template → mappedInddUrl
         NO  → modify against originals → re-validate → ⛔ STOP again
        │
Step 4: document_merge_data_layout → return download links
```

---

## Error Handling

| Situation | Action |
|-----------|--------|
| `export_idml` fails / missing execute URL | Inform user that automatic placeholder creation is unavailable; ask if they want to continue manually |
| `prepare_indd_merge_template` fails / missing execute URL | Ask deployer to set `ADOBE_CAPABILITY_SMART_MAPPING_EXECUTE_URL`; stop |
| Data file delimiter unclear | Ask the user what delimiter is used and whether the first row is a header |
| Mapping JSON invalid after validation | Re-run LLM with the validation errors; require JSON-only output; retry until `isValid: true` |
| `document_merge_data_layout` fails | Surface the raw error; suggest checking that template variable names match CSV column headers exactly |
| `convert_pdf_to_indd` fails | Confirm the PDF URL is accessible; retry with `embedLinks: true`; if still failing, ask user for a native `.indd` |
| No `.indd` and PDF conversion unavailable | Ask user to export their template as `.indd` directly |

---

## Admin Notes (IDCS Environment)

The IDML export and smart-mapping tools require these environment variables (configure them in your deployment environment):

| Variable | Used by |
|----------|---------|
| `ADOBE_CAPABILITY_IDMLEXPORT_EXECUTE_URL` | `export_idml` |
| `ADOBE_CAPABILITY_SMART_MAPPING_EXECUTE_URL` | `prepare_indd_merge_template` |
| `ADOBE_CLIENT_ID`, `ADOBE_CLIENT_SECRET`, `ADOBE_API_KEY`, `ADOBE_IMS_ORG_ID`, `ADOBE_CLIENT_CODE`, `ADOBE_IMS_TOKEN_URL`, `ADOBE_API_BASE_URL` | All Adobe tools |
