# Site Search Results Page and Contact Form

## Problem/Feature Description

Harbor Credit Union's public site runs on AEM Edge Delivery Services. The project was created last month from the current AEM Boilerplate and has not changed `scripts/scripts.js` or `scripts/aem.js` since. Authors write in Google Docs; a second team is moving to Document Authoring (DA). The site has no AEM Forms license.

Two features are requested:

1. **Search results page** at `/search`. The header search box sends visitors to `/search?q=<term>`. The page shows a search field pre-filled with the term and a list of matching pages (title, description, link) from the site's `/query-index.json`. Results are paged 10 at a time.
2. **Contact form** at `/contact`, and the same form on two branch pages (`/branches/downtown`, `/branches/harbor-point`). Fields: name, email, topic (select: Accounts, Loans, Other), message. On submit it POSTs JSON to `https://forms.harborcu.example/submit`. Each branch page must send its branch id (`downtown`, `harbor-point`) with the submission; `/contact` sends `general`.

The web producer left this comment on the ticket:

> Can we just use the Form block from the Block Collection? I remember you define the fields in a spreadsheet. And for search, maybe a "Search Results" block where authors fill in settings like results per page and which index to use?

We follow content-driven development: this task is only the content-model step. Do not write any JavaScript, CSS or HTML implementation yet.

## Output Specification

Write `MODEL.md` containing:

- For each feature, exactly what an author puts in the page document (show the authored content, e.g. headings, text, links or block tables in markdown), and where any per-page settings go.
- Which project folders/files the developer will create for each feature (names only, no code), and how the boilerplate turns the authored content into the working feature.
- A reply to the web producer's comment.
- What should happen next in the workflow after this model is agreed.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: inputs/project-tree.txt ===============
blocks/
  cards/
  columns/
  footer/
  fragment/
  header/
  hero/
  widget/
fonts/
icons/
scripts/
  aem.js
  consent-check.js
  consented.js
  scripts.js
styles/
head.html
404.html
