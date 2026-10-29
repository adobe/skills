# Validate the New Hero Video Block Before Opening the PR

## Problem/Feature Description

Acme's marketing site runs on AEM Edge Delivery Services, with content authored in Document Authoring (da.live, org `acme`, site `acme-site`). A developer has finished a new `hero-video` block on the branch `feature-hero-video` and handed it to you to validate before the pull request is opened. You are working in that developer's checkout of the repository (see the input files).

The block shows an authored poster image and heading. On desktop it swaps the poster for a muted, looping background video; on smaller screens it keeps the poster and adds a play button that opens the video.

Nothing exists yet to test it with. You need to:

1. Create a test page that uses the block (one plain instance with a poster, heading and video link). The reviewer will open the same page on the branch preview, `https://feature-hero-video--acme-site--acme.aem.page/drafts/hero-video`, so the page has to end up in DA as well; you also want to look at it locally first, before anything is published.
2. Write a Playwright script that opens the test page on the local dev server, waits until the block has finished loading, captures the block's accessibility tree, takes screenshots at mobile, tablet and desktop sizes, checks that the video element only appears at desktop width, and fails on browser console errors.
3. Write down exactly how you will run the validation and what you will hand back to the developer.

You cannot run a browser or the AEM CLI in this environment; write the files and commands as you would run them.

## Output Specification

- The test page HTML file, at the path in the checkout where you would create it.
- The Playwright script as `check-hero-video.mjs`.
- `NOTES.md` covering: the commands to start the local server and the exact local URL you will open; how you will get the test page into DA for the reviewer; the order of the validation steps you will run before saying the block is done; and where the Playwright script lives and what happens to it afterwards.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: .git ===============
gitdir: /Users/dev/work/acme-site/.git/worktrees/feature-hero-video

=============== FILE: package.json ===============
{
  "name": "@acme/acme-site",
  "private": true,
  "version": "1.3.0",
  "description": "Acme marketing site",
  "scripts": {
    "lint:js": "eslint .",
    "lint:css": "stylelint \"blocks/**/*.css\" \"styles/*.css\"",
    "lint": "npm run lint:js && npm run lint:css",
    "lint:fix": "npm run lint:js -- --fix && npm run lint:css -- --fix"
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

=============== FILE: blocks/hero-video/hero-video.js ===============
const DESKTOP = window.matchMedia('(min-width: 900px)');

function buildVideo(src) {
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('aria-hidden', 'true');
  const source = document.createElement('source');
  source.src = src;
  source.type = 'video/mp4';
  video.append(source);
  return video;
}

export default function decorate(block) {
  const picture = block.querySelector('picture');
  const heading = block.querySelector('h1, h2');
  const link = block.querySelector('a[href$=".mp4"]');
  const videoSrc = link ? link.href : null;
  if (link) link.closest('p')?.remove();

  const media = document.createElement('div');
  media.className = 'hero-video-media';
  if (picture) media.append(picture);

  const text = document.createElement('div');
  text.className = 'hero-video-text';
  if (heading) text.append(heading);

  block.replaceChildren(media, text);
  if (!videoSrc) return;

  const show = () => {
    if (DESKTOP.matches && !media.querySelector('video')) {
      media.append(buildVideo(videoSrc));
    } else if (!DESKTOP.matches) {
      media.querySelector('video')?.remove();
    }
  };

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'hero-video-play';
  play.setAttribute('aria-label', 'Play video');
  play.addEventListener('click', () => window.open(videoSrc, '_blank'));
  text.append(play);

  DESKTOP.addEventListener('change', show);
  show();
}

=============== FILE: blocks/hero-video/hero-video.css ===============
.hero-video {
  position: relative;
}

.hero-video .hero-video-media video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (width >= 900px) {
  .hero-video .hero-video-play {
    display: none;
  }
}
