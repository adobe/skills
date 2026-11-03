# Rebuilding a header 1:1: `web header`

`web header capture` records a site's header as data: its region, every menu open, the
breakpoint, the scroll behaviour and the mobile menu. `web header check <check>` compares a page
you build with that capture and with the live source. Use the checks as a ladder: each step
clean before the next, and the header is done when every step is clean.

The goal is a header nobody can tell from the source when swiping between the two: at any width,
closed, with every menu open, with the mobile menu open, and while scrolling down and back up.

## Install

The checks need `sharp`, `pngjs` and `pixelmatch`, which are optional dependencies of the CLI.
Without them a `header` command exits 2 (`UNSUPPORTED`) before any browser starts. Install the
CLI as a package, pinned to a commit of adobe/skills, with pnpm's git subfolder install:

```bash
DIR="$HOME/.cache/adobe-skills/web-cli-<sha7>"
[ -x "$DIR/node_modules/.bin/web" ] ||
  npx -y pnpm@<version> add --dir "$DIR" "github:adobe/skills#<sha>&path:/plugins/web/cli"
WEB="$DIR/node_modules/.bin/web"
```

In a clone of adobe/skills, `npm install` in `plugins/web/cli` does the same for
`node plugins/web/cli/dist/web.mjs`. The checks also need `playwright-cli` on PATH, like every
browser command.

## How the pages are held still

Both pages are loaded the same way in every check, so a difference is the build's and not the
load's:

- A/B-testing services are blocked, and `Math.random` is seeded.
- Every `setInterval` of 2 s or more is stopped, so a rotating text shows its first item.
- No splash dialog is opened.
- Consent and other overlays are hidden by the capture's rules (`<dir>/overlays.json`).
- Lazy content is loaded and animations are finished before anything is measured.

Checked against itself, a source scores 0 on every check. A reading on the source's own body
(a carousel, its own load shift) is the source's, not the build's.

## The loop

1. Capture the source once: `$WEB header capture <source-url> <src>`. It writes
   `<src>/page.json` (the header's regions and their boxes at 1440x900, 820x1180 and 390x844),
   `<src>/overlays.json`, full-page shots, `<src>/regions/` (crops and computed-style dumps) and
   `<src>/open/` (`open.json`, a shot and a style dump per open menu, `mobile-menu.png`).
2. Build the header on your page, served locally, from the source's computed styles and the
   capture's data: copy how the source does it (a transform, content sizing, a flex column),
   not the numbers of one shot.
3. Run the ladder below on your page. Fix, re-run only what was not clean, and run every command
   in full once at the end.

## The ladder

Each command prints one JSON document with `clean`; `--format text` prints the check's lines.
Read the lines, not the exit status: 0 means the check ran, clean or not.

1. **Structure and links**
   - `$WEB header check menus <page> <src>/open/open.json`: every menu of the capture opens on
     the page as the source opens it (hover or click, on its visible label), reveals at least
     80 % of the source's links, and closes as the source closes it.
   - `$WEB header check panels <page> <src> <out>/open`: the pixel mismatch inside each source
     panel's box (at most 1.5 %), the revealed hrefs against the capture's (as multisets), and
     the mobile menu against `<src>/open/mobile-menu.png` (at most 2.0 %).
2. **Pixels at 1x**: `$WEB header check pixels <page> <src> <out> --map <map.json>` at desktop,
   `--tablet` and `--mobile`. The map gives the capture's region ids -> selectors on your page
   (`{ "header": "header .nav-wrapper" }`). Clean: every region with height delta 0 and
   mismatch 0 %. The `FULL` line is the whole page, so you can see a header that changes the page
   outside its own region. `$WEB header check cls <page> 1440,1200,992` gives the layout shift of
   a load at each width (clean under 0.05).
3. **Text properties and positions**, every text of the header matched with the source's:
   - closed: `$WEB header check text <source-url> <page> --sizes 1440,1200,1100,992,900,820,700,650,480,390x844 --hide-css <src>/overlays.json --source-cache <src>/text-cache`
   - each menu open: `… --sizes 1440,1200,<breakpoint>,1440x700 --open "<label>" --trigger <hover|click>`
     (labels and triggers in `open.json`; the short windows show a panel that does not fit)
   - the mobile menu open: `… --sizes 390x844,460x1000,600x1200,820x1100 --mobile-menu`
   - scrolling: `… --sizes 1440,820,390x844 --scroll 600,500,0` (wheel down to 600, back up to
     500, then to the top; each step compared)
4. **2x pixels**: the same text commands with `--scale 2 --shots <out>/x2/<state>`: `0
   differing pixels` at every size. Open the two shots of a size that is not clean.

`--source-cache <dir>` keeps the source's states between runs (loaded once, shared by every text
command). `--baseline <url>` points at your page before the header work: a difference it already
had, with the same value on your page, is reported as inherited and not counted. The header's own
texts and where the page below it starts are never inherited.

## Reading the lines

`text` (one line per difference, then a summary per size):

```
1000x900 "Blog": fontWeight 600 -> 700; letterSpacing normal -> 0.2px
1000x900 "icon "Close"": x 907 -> 927
1000x900 "(the page below the header)": y 96 -> 104
1000x900 only on the source: "About"
1000x900 only on the page: "Different label"
1000x900 text styles: 1 differ of 4 matched texts, 2 on one side only
not clean at: 1000x900,700x900 (re-run those with --sizes while fixing)
```

- `"<text>": <property> <source> -> <page>`: a computed property (camelCase) or a box (`x`, `y`, `w`, `h`)
  of that text on the source and on your page. Fix the property, not the box: a box follows from
  the font, the padding, the layout.
- `icon "<name>"`: icons (an svg or img of its own, or an icon-only control drawn by CSS) are
  paired by position. Draw each icon as the source does: where the source has an inline SVG, so
  does the build (an `<img>` or a CSS mask snaps to whole pixels and shows at 2x).
- `(the page below the header)`: where the page's main content starts. The header's height or
  position differs.
- `only on the source` / `only on the page`: a label missing or changed.
- `; N differing pixels at 2x (… in the header and open panel, … below them)`: with `--shots`.
- `not clean at:` the sizes to re-run with `--sizes` while fixing.

`menus`: `OK   <label> (<trigger>): 3 of 3 links`, or `FAIL` with the reason (did not open, could
not be closed, too few links). `panels`: `OK   <label> (<trigger>): panel 0.4 %, 12 of 12 hrefs`,
then `mobile menu: 0.8 %`. `pixels`: one row per region,
`header  src@0+96  eds@0+96  dH=0  mismatch=0%  side=<file>` (`src`: the source, `eds`: your page;
`side.png` shows both), then `MISSING` (a map selector that matched nothing on your page) and
`NOT SHOWN` (a region the source does not show at this width: not compared).

## Exit codes

- **0**: the check ran, `clean` true or false.
- **1**: `CHECK_FAILED`, the check did not run to its end (a page that did not load, a size that
  could not be compared, a browser call that failed). Nothing was checked, so it is not a result:
  fix the cause (is the dev server up?) and run the same command again. For `text`, the message
  names the sizes that failed and holds the other sizes' lines.
- **2**: a usage error (a bad option, a map key that names no region of the capture), or
  `playwright-cli` or the image libraries missing, before any browser starts.

## Browsers

Each command opens its own browsers under generated session names and closes them when it ends,
however it ends. Several commands can run at once. `text --parallel <n>` (default 4) loads that
many sizes at a time.
