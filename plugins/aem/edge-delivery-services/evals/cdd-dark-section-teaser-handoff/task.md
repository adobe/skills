# Teaser Block in Dark Sections — Take Over a Colleague's Branch

## Problem/Feature Description

Acme's marketing site (GitHub repo `acme/website`) runs on AEM Edge Delivery Services. It was set up in June 2026 from the current AEM boilerplate; authors write pages in Document Authoring at `https://da.live/#/acme/website`.

Authors have started putting the existing `teaser` block into sections they style as dark (Section Metadata with Style `dark`). `styles/styles.css` already gives dark sections a dark background and light text, but the teaser card keeps its light card background and dark button, so it looks out of place. Design wants teasers inside dark sections to have a transparent card background, light text, and a white outlined button. Teasers in normal sections must not change.

A colleague started this on branch `teaser-dark` and then went on leave. You are taking over the branch. Their hand-off message:

> I made a test page, content/drafts/teaser-dark.html, and ran `aem content push` yesterday. I opened PR #57 with the test link https://teaser-dark--website--acme.aem.page/drafts/teaser-dark but the reviewer says it's a 404.
>
> Also, the teaser on my test page never gets the dark styling. As far as I can see, our aem.js no longer turns Section Metadata into classes (decorateSections doesn't touch it), so I started adding a `applySectionMetadata` helper to scripts.js. It's not working yet. Haven't touched teaser.css.

The sandbox has no AEM CLI, no browser and no network access. Do not try to run AEM or git commands; write them down exactly as you would run them.

## Output Specification

Leave the branch in the state you would push, and write:

1. `NOTES.md` with:
   - **Why the teaser isn't dark**: the root cause on the colleague's branch and how you fixed it.
   - **Why the PR link 404s**: the cause and what has to happen for the reviewer's link to work.
   - **Steps**: a numbered list, in order, of what you would do from here until the reviewer can review, with every command or HTTP request shown exactly in a code block and the exact local URL(s) you would check.
2. Any changes to the project files (code and test content) needed for the feature.
3. `PR.md`: the updated PR description.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: .git/HEAD ===============
ref: refs/heads/teaser-dark

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

=============== FILE: package.json ===============
{
  "name": "@acme/website",
  "private": true,
  "version": "1.3.0",
  "scripts": {
    "lint:js": "eslint .",
    "lint:css": "stylelint \"blocks/**/*.css\" \"styles/*.css\"",
    "lint": "npm run lint:js && npm run lint:css",
    "lint:fix": "npm run lint:js -- --fix && npm run lint:css -- --fix"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/acme/website.git"
  }
}

=============== FILE: content/.da-config.json ===============
{
  "org": "acme",
  "site": "website",
  "rootPath": "/drafts"
}

=============== FILE: content/drafts/teaser-dark.html ===============
<body>
  <header></header>
  <main>
    <div>
      <h1>Teaser in dark sections</h1>
      <p>Test page for the teaser block inside a dark section.</p>
    </div>
    <div>
      <div class="teaser">
        <div>
          <div><picture><img src="https://content.da.live/acme/website/drafts/media/trail.jpg" alt="Hikers on a ridge trail"></picture></div>
          <div>
            <h2>Plan your next trip</h2>
            <p>Routes, gear lists and weather in one place.</p>
            <p><strong><a href="/trips">Start planning</a></strong></p>
          </div>
        </div>
      </div>
    </div>
    <div>
      <div class="section-metadata">
        <div>
          <div>Style</div>
          <div>dark</div>
        </div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>

=============== FILE: content/index.html ===============
<body>
  <header></header>
  <main>
    <div>
      <h1>Acme Outdoors</h1>
      <p>Gear and guides for every trail.</p>
    </div>
    <div>
      <div class="teaser">
        <div>
          <div><picture><img src="https://content.da.live/acme/website/media/tent.jpg" alt="Tent at dusk"></picture></div>
          <div>
            <h2>New: four-season tents</h2>
            <p>Built for snow loads and high winds.</p>
            <p><strong><a href="/tents">Shop tents</a></strong></p>
          </div>
        </div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>

=============== FILE: blocks/teaser/teaser.js ===============
export default function decorate(block) {
  const row = block.firstElementChild;
  if (!row) return;
  const [imageCell, bodyCell] = [...row.children];
  if (imageCell && imageCell.querySelector('picture')) {
    imageCell.classList.add('teaser-image');
  }
  if (bodyCell) bodyCell.classList.add('teaser-body');
}

=============== FILE: blocks/teaser/teaser.css ===============
.teaser > div {
  display: flex;
  flex-direction: column;
  background-color: var(--light-color);
  border-radius: 8px;
  overflow: hidden;
}

.teaser .teaser-image img {
  display: block;
  width: 100%;
  height: auto;
}

.teaser .teaser-body {
  padding: 24px;
  color: var(--text-color);
}

.teaser .teaser-body a.button:any-link {
  background-color: var(--text-color);
  color: var(--background-color);
}

@media (width >= 900px) {
  .teaser > div {
    flex-direction: row;
  }

  .teaser .teaser-image,
  .teaser .teaser-body {
    flex: 1;
  }
}

=============== FILE: styles/styles.css ===============
/* excerpt */
:root {
  --background-color: white;
  --light-color: #f8f8f8;
  --dark-color: #1f2a24;
  --text-color: #131313;
  --link-color: #3b63fb;
}

main > .section {
  margin: 40px 0;
}

main > .section > div {
  max-width: 1200px;
  margin: auto;
  padding: 0 24px;
}

main > .section.dark {
  background-color: var(--dark-color);
  color: var(--background-color);
  padding: 40px 0;
}

=============== FILE: scripts/aem.js ===============
// excerpt (vendored from the boilerplate, unmodified)
function decorateSections(main) {
  main.querySelectorAll(':scope > div').forEach((section) => {
    const wrappers = [];
    let defaultContent = false;
    [...section.children].forEach((e) => {
      if (e.tagName === 'DIV' || !defaultContent) {
        const wrapper = document.createElement('div');
        wrappers.push(wrapper);
        defaultContent = e.tagName !== 'DIV';
        if (defaultContent) wrapper.classList.add('default-content-wrapper');
      }
      wrappers[wrappers.length - 1].append(e);
    });
    wrappers.forEach((wrapper) => section.append(wrapper));
    section.classList.add('section');
    section.dataset.sectionStatus = 'initialized';
    section.style.display = 'none';
  });
}

=============== FILE: scripts/scripts.js ===============
// excerpt
import {
  decorateIcons,
  decorateSections,
  decorateBlocks,
  readBlockConfig,
} from './aem.js';

// ... buildAutoBlocks, decorateButtons omitted ...

// WIP (teaser-dark): aem.js no longer applies section metadata, do it here
function applySectionMetadata(main) {
  main.querySelectorAll('.section-metadata').forEach((sm) => {
    const section = sm.closest('.section');
    const meta = readBlockConfig(sm);
    Object.entries(meta).forEach(([key, value]) => {
      if (key === 'style') {
        value.split(',').map((s) => s.trim()).forEach((cls) => section.classList.add(cls));
      } else {
        section.dataset[key] = value;
      }
    });
    sm.parentElement.remove();
  });
}

export function decorateMain(main) {
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  applySectionMetadata(main);
  decorateBlocks(main);
  decorateButtons(main);
}
