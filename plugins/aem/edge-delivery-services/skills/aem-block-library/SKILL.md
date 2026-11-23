---
name: aem-block-library
description: "Use when a new or changed AEM Edge Delivery Services block needs an entry in the block library that authors use to find and insert it: the Experience Workspace (formerly DA, Document Authoring) library or the Sidekick Library for Word and Google Docs projects. Covers finding the project's library, the block page, variants, the sheet row, library metadata and the steps that happen outside the repo. For tests that run against the library page use testing-blocks."
license: Apache-2.0
metadata:
  version: "1.0.0"
---

# Block Library Entry

## Find the project's library first

- **Existing pages.** Look in `./content/` for the library pages of other blocks. `/docs/library/blocks/<block>` is the most common location. Put the new page next to them.
- **Experience Workspace (DA):** a `blocks` sheet in the library folder lists the blocks, and the site config at `https://da.live/config#/{org}/{site}/` has a `library` tab that points to it.
- **Sidekick Library (Word, Google Docs):** `tools/sidekick/library.html` in the repo, and a `library` workbook with a `helix-blocks` sheet. The page loader needs no change for a new block.

## What an entry contains

- Happy path only: each variant once, with realistic content, including an image if the block has one (a placeholder source is fine). Edge cases (missing cells, long text, no image) never go in the library. Cover them in unit tests or on a drafts page such as `content/drafts/`.
- A `library-metadata` block with a `description` row that says when to use the block.
- Add only the page and the sheet row. No other files.

## Experience Workspace (DA)

1. One page per block under the library folder. A visual variant goes in the block's heading row in parentheses (`testimonial (dark)`) and becomes a class. Content variants (same markup, different content) get a heading above the block.
2. Add a row to the `blocks` sheet: `name`, and `path` as `https://content.da.live/{org}/{site}/{path of the new page}`, in the format of the existing rows (the page is in the folder the existing block pages are in).
3. The `library` tab of the site config needs a row (`title`, `path` = the sheet's `.json` URL). It exists already if other blocks show up; check and don't duplicate it. It lives outside the repo.

## Sidekick Library

1. One document per block, e.g. `/tools/sidekick/blocks/<block>`. Each variant is its own section (section break after it).
2. Add a row to the `helix-blocks` sheet: `name`, and `path` relative, as `/tools/sidekick/blocks/<block>` (no host, so it works on page, live and prod).
3. `library metadata` takes `name`, `description` and `searchtags`. Default content and auto-blocks need their own section with a `library metadata` block that has a `name`.
4. The example pages are published, so exclude `/tools/**` from indexing with bulk metadata if it is not already.

## Outside the repo

Local `./content/` edits are not visible to authors. Tell the user what remains.

- **Experience Workspace:** push the content (page and sheet), and check the site config `library` tab.
- **Word and Google Docs:** the local HTML and sheet JSON are only a preview of the entry. The user creates the block document and the `helix-blocks` row in the content source (SharePoint or Google Drive), then previews and publishes both. Follow a project-specific transfer workflow if one exists.
