# Key Figures Block — From Test Page to Reviewable PR

## Problem/Feature Description

Acme's marketing site (GitHub repo `acme/website`) runs on AEM Edge Delivery Services. Authors write pages in Document Authoring at `https://da.live/#/acme/website`. Code previews at `https://main--website--acme.aem.page/`. Authors insert blocks from the site's block library; the DA config's `library` tab points its Blocks entry at `https://content.da.live/acme/website/docs/library/blocks.json`.

Product marketing wants a new `key-figures` block: a horizontal row of two to four big numbers ("98%", "12M", "140+"), each with a short label underneath and, optionally, a small source link (e.g. "Source: 2025 annual report"). It will sit in the middle of landing pages. No page uses this block yet and the authors have not written any content for it.

The tech lead does not want to wait for authors. Please create the test content yourself (covering the cases the block must handle), check it against your local dev server while you build, and get it into the site's content so the reviewer can open the PR's branch test link and see the block working. Then implement the block and prepare the PR.

You are working in a git worktree of the repository checked out on branch `key-figures` (see `.git`). Other agents are working on other branches in sibling worktrees of the same repo and have their own dev servers running.

The sandbox has no AEM CLI, no browser and no network access. Do not try to run AEM or git commands; write them down exactly as you would run them.

## Output Specification

Produce the following files:

1. `NOTES.md` containing:
   - A **Content model** section describing how authors will structure the block in a document (rows, cells, what goes in each cell, optional parts).
   - A **Steps** section: a numbered list, in the exact order you would perform them, of everything from starting the dev server to the reviewer being able to open the test link. Each step that involves a command or HTTP request must show the exact command/request in a code block. Include the exact local URL(s) you would load to check the test page.
2. The test content file(s), saved at whatever path in the project your workflow requires for them to be served locally and synced to the site's content.
3. `blocks/key-figures/key-figures.js` and `blocks/key-figures/key-figures.css` implementing the block.
4. `PR.md` containing the pull request description you would submit.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: .git ===============
gitdir: /Users/dev/code/acme-website/.git/worktrees/key-figures

=============== FILE: AGENTS.md ===============
# AGENTS.md

Edge Delivery Services. Read a block first. Omissions are in the repo or known.

## Avoid
- `scripts/aem.js` is vendored. Never edit.
- Markup comes from the backend. `curl localhost:3000/x.plain.html` first.
- `buildAutoBlocks` rewrites content before your block runs.
- Authors omit and add cells. Decorate defensively.
- No build step; devDependencies only.
- Scope CSS to `.blockname`; `-wrapper`/`-container` are section classes.
- `fragment/fragment.js` is the only cross-block import. Otherwise use `/scripts/`.

## Outdated
- `fstab.yaml`, `helix-query.yaml`, `paths.json` are retired. Config lives at tools.aem.live.

## Remember
- `npx -y @adobe/aem-cli up`: local code, previewed content.
- Merging `main` ships code; content publishes separately.
- A PR without a `{branch}--{repo}--{owner}.aem.page/{path}` link is rejected.
- All committed files are served. Use `.hlxignore`.

=============== FILE: .gitignore ===============
.hlx/*
coverage/*
logs/*
node_modules/*

helix-importer-ui
.DS_Store
*.bak
.idea

# Ensure these files are tracked
!CLAUDE.md
!AGENTS.md

=============== FILE: package.json ===============
{
  "name": "@acme/website",
  "private": true,
  "version": "1.3.0",
  "description": "Acme marketing site on AEM Edge Delivery Services",
  "scripts": {
    "lint:js": "eslint .",
    "lint:css": "stylelint \"blocks/**/*.css\" \"styles/*.css\"",
    "lint": "npm run lint:js && npm run lint:css",
    "lint:fix": "npm run lint:js -- --fix && npm run lint:css -- --fix"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/acme/website.git"
  },
  "devDependencies": {
    "@babel/eslint-parser": "7.29.9",
    "eslint": "8.57.1",
    "eslint-config-airbnb-base": "15.0.0",
    "eslint-plugin-import": "2.32.0",
    "stylelint": "17.16.0",
    "stylelint-config-standard": "40.0.0"
  }
}

=============== FILE: blocks/columns/columns.js ===============
export default function decorate(block) {
  const cols = [...block.firstElementChild.children];
  block.classList.add(`columns-${cols.length}-cols`);

  // setup image columns
  [...block.children].forEach((row) => {
    [...row.children].forEach((col) => {
      const pic = col.querySelector('picture');
      if (pic) {
        const picWrapper = pic.closest('div');
        if (picWrapper && picWrapper.children.length === 1) {
          // picture is only content in column
          picWrapper.classList.add('columns-img-col');
        }
      }
    });
  });
}

=============== FILE: styles/styles.css ===============
/* excerpt */
:root {
  /* colors */
  --background-color: white;
  --light-color: #f8f8f8;
  --dark-color: #505050;
  --text-color: #131313;
  --link-color: #3b63fb;
  --link-hover-color: #1d3ecf;

  /* fonts */
  --body-font-family: roboto, roboto-fallback, sans-serif;
  --heading-font-family: roboto-condensed, roboto-condensed-fallback, sans-serif;

  /* heading sizes */
  --heading-font-size-xxl: 55px;
  --heading-font-size-xl: 44px;
  --heading-font-size-s: 24px;

  /* body sizes */
  --body-font-size-s: 19px;
  --body-font-size-xs: 17px;
}
