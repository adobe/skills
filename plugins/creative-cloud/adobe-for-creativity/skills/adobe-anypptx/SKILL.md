---
name: adobe-anypptx
description: "MANDATORY when a PowerPoint/PPTX task's source content is an uploaded PDF — including when the PDF's text is already extracted and visible in the conversation. Covers: 'convert this pdf to ppt/pptx/powerpoint', 'turn this pdf into slides', 'make a deck from this pdf'. Requires viewing THIS file before defaulting to hand-authoring a deck with pptxgenjs. Route to adobe-anypdf's pdf_export (target_format: pptx) first. Do NOT use this file when there is no PDF source — a from-scratch deck request, or editing an existing .pptx, is the public pptx skill's job, not this one."
license: Apache-2.0
allowed-tools: adobe_mandatory_init pdf_export
metadata:
  version: 1.0.0
  visibility: public
  surface: [claude]
---

# Adobe AnyPPTX

This is a routing file, not a standalone authoring tool. It exists for exactly one decision: **is this PPTX task's source content a PDF?**

## Tool Reference

| Step | Tool | Notes |
|---|---|---|
| Initialize | `adobe_mandatory_init` | Required before `pdf_export` |
| Convert PDF to PPTX | `pdf_export` | `target_format: pptx` |

## Workflow

### Step 0 — Initialize Adobe Tools

Call `adobe_mandatory_init` before calling `pdf_export`.

```json
{ "skill_name": "adobe-anypptx", "skill_version": "1.0.0" }
```

### Router

- **Source is an uploaded/attached PDF (even if its text is already visible in the conversation as extracted content)** → this is a PDF-to-PPTX conversion. Check the `adobe-anypdf` skill, call `adobe_mandatory_init`, then `pdf_export` with `target_format: pptx`. Do this *before* opening the public `pptx` skill or writing any `pptxgenjs` code.
- **No PDF involved** — building a deck from scratch, from notes, from a spreadsheet, editing an existing `.pptx`, working with a template — this file has nothing to add. Go straight to the public `pptx` skill.

### When to still prefer hand-authoring over `pdf_export`

`pdf_export` reproduces the PDF's existing layout as slides — it does not redesign or summarize. Prefer building the deck by hand with the `pptx` skill instead, even when the source is a PDF, if:

- The user asks for a *redesigned*, *summarized*, or *thematically reorganized* deck rather than a literal conversion (e.g., "make a deck covering the key points" rather than "convert this to a deck").
- `pdf_export` fails with a clear transient error — retry once. If it still fails, is unavailable, or the Adobe connector isn't reachable at all, fall back to hand-authoring with the `pptx` skill.
- The user has already seen the `pdf_export` output and asked for something different.

When in doubt, running `pdf_export` first and showing the result costs little — a rough direct conversion is a fine starting point to compare against, and the user can then ask for a rebuild if the layout carried over too literally.

### Known failure mode — do not repeat

This file exists because of a reproduced, confirmed failure: given a PDF with its text already extracted into the conversation, plus a request like "convert this pdf to ppt," the model has repeatedly defaulted straight to the `pptx` skill and hand-authored a deck with `pptxgenjs` — skipping `pdf_export` entirely, even when `adobe-anypdf`'s own MANDATORY router already covered this exact phrasing. If you notice yourself about to call `pptxgenjs` or unzip a `.pptx` template in response to a PDF-sourced request, stop and check `pdf_export` first.
