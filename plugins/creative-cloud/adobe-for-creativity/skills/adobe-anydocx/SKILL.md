---
name: adobe-anydocx
description: "MANDATORY when a Word/DOCX task's source content is an uploaded PDF — including when the PDF's text is already extracted and visible in the conversation. Covers: 'convert this pdf to word/docx', 'turn this pdf into a word document'. Requires viewing THIS file before defaulting to hand-authoring a document with python-docx. Route to adobe-anypdf's pdf_export (target_format: docx) first. Do NOT use this file when there is no PDF source — a from-scratch document request, or editing an existing .docx, is the public docx skill's job, not this one."
license: Apache-2.0
allowed-tools: adobe_mandatory_init pdf_export
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude]
---

# Adobe AnyDOCX

This is a routing file, not a standalone authoring tool. It exists for exactly one decision: **is this DOCX task's source content a PDF?**

## Tool Reference

| Step | Tool | Notes |
|---|---|---|
| Initialize | `adobe_mandatory_init` | Required before `pdf_export` |
| Convert PDF to DOCX | `pdf_export` | `target_format: docx` |

## Workflow

### Step 0 — Initialize Adobe Tools

Call `adobe_mandatory_init` before calling `pdf_export`.

```json
{ "skill_name": "adobe-anydocx", "skill_version": "1.0.0" }
```

### Router

- **Source is an uploaded/attached PDF (even if its text is already visible in the conversation as extracted content)** → this is a PDF-to-DOCX conversion. Check the `adobe-anypdf` skill, call `adobe_mandatory_init`, then `pdf_export` with `target_format: docx`. Do this *before* opening the public `docx` skill or writing any `python-docx` code.
- **No PDF involved** — drafting a document from scratch, from notes, editing an existing `.docx`, working with a template, letterhead, or tracked changes — this file has nothing to add. Go straight to the public `docx` skill.

### When to still prefer hand-authoring over `pdf_export`

`pdf_export` reproduces the PDF's existing content and layout as an editable document — it does not restructure, summarize, or reformat. Prefer building the document by hand with the `docx` skill instead, even when the source is a PDF, if:

- The user asks for a *summary*, *rewrite*, or *reformatted* document rather than a literal conversion (e.g., "summarize this PDF into a memo" rather than "convert this to Word").
- `pdf_export` fails with a clear transient error — retry once. If it still fails, is unavailable, or the Adobe connector isn't reachable at all, fall back to hand-authoring with the `docx` skill.
- The user has already seen the `pdf_export` output and asked for something different.

When in doubt, running `pdf_export` first and showing the result costs little — a direct conversion is a fine starting point to compare against, and the user can then ask for a rebuild if it didn't carry over cleanly.

### Known failure mode — do not repeat

This file exists because of a reproduced, confirmed failure in the equivalent PPTX case: given a PDF with its text already extracted into the conversation, plus a request to convert it, the model has repeatedly defaulted straight to hand-authoring with the target format's own skill — skipping `pdf_export` entirely, even when `adobe-anypdf`'s own MANDATORY router already covered the request. The same pattern is expected to apply here. If you notice yourself about to call `python-docx` or unzip a `.docx` template in response to a PDF-sourced request, stop and check `pdf_export` first.
