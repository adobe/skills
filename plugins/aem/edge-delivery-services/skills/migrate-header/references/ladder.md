# The self-check ladder

Each step is clean before the next. Values:

| name | value |
|---|---|
| `$WEB` | the web CLI installed in step 1 of the skill |
| `<source>` | the source page URL |
| `<page>` | your page on the local server, `http://localhost:3000/<path>` |
| `<baseline>` | the same page before your work, `https://main--<repo>--<owner>.aem.page/<path>` |
| `<src>` | the capture, `.migrate-header/source` |
| `<out>` | the checks' output, `.migrate-header/out` |
| `<bp>` | the source's breakpoint, `open.json` `header.breakpoint.shownAt` |

Add `--format text` to every command: it prints the check's lines. Without it, a command prints
one JSON document with `clean`. Exit 0 means the check ran, clean or not: read the lines.

## 1. Structure and links

```bash
$WEB header check menus <page> <src>/open/open.json --format text
$WEB header check panels <page> <src> <out>/open --format text
node <skill>/scripts/hrefs-check.mjs <src> drafts
```

- `menus`: every menu opens as the source's (hover or click, on its visible label), shows at
  least 80 % of its links, and closes as the source's. `FAIL <label> (<trigger>): …` says which
  part failed.
- `panels`: each open panel's pixels inside the source panel's box (at most 1.5 %), its hrefs
  equal to the capture's, and the mobile menu (at most 2.0 %). The shots are in `<out>/open/`,
  next to the source's in `<src>/open/`: open both when a line fails.
- `hrefs-check.mjs`: every link of the nav document and its fragments is a link of the capture
  (or a fragment of yours). It prints each other one and exits 1.

## 2. Pixels at 1x

The map gives the capture's region ids (`<src>/page.json` `regions[].id`) -> selectors on your page.
For one region holding the whole header: `{ "<id>": "body > header" }`.

```bash
$WEB header check pixels <page> <src> <out> --map .migrate-header/map.json --format text
$WEB header check pixels <page> <src> <out> --map .migrate-header/map.json --tablet --format text
$WEB header check pixels <page> <src> <out> --map .migrate-header/map.json --mobile --format text
$WEB header check cls <page> 1440,1200,<bp>,820,390 --format text
```

- `pixels`: each region at `dH=0` and `mismatch=0%` (both shots on white; `side=` shows both).
  The `FULL` line is the whole page. On a page that is not the source page migrated, it says
  nothing about the header, so compare it with its value before your work: a header can change
  the page outside its own region (a closed panel that shows in a full-page shot).
- `cls`: every width under 0.05. A shift means the header changed size after the first paint:
  check `--nav-height` and that nothing in the header waits for a font or an image without a
  size.

## 3. Text properties and positions

Every text of the header matched with the source's. Add to every command:
`--hide-css <src>/overlays.json --source-cache <src>/text-cache --baseline <baseline> --format text`

```bash
# closed
$WEB header check text <source> <page> --sizes 1440,1200,1100,992,900,820,700,650,480,390x844 …
# each menu open (labels and triggers in open.json); the short windows show a panel that does not fit
$WEB header check text <source> <page> --sizes 1440,1200,<bp>,1440x700,<bp>x800 --open "<label>" --trigger <hover|click> …
# the mobile menu open
$WEB header check text <source> <page> --sizes 390x844,460x1000,600x1200,820x1100 --mobile-menu …
# scrolling: wheel down to 600, back up to 500, then to the top; each step compared
$WEB header check text <source> <page> --sizes 1440,820,390x844 --scroll 600,500,0 …
```

For the open sizes, leave out the widths under `<bp>` (no desktop menu there).

Clean: `0 differ` at every size. The lines:

- `<size> "<text>": <property> <source> -> <page>`: a computed property (camelCase) or the text's
  box (`x`, `y`, `w`, `h`). Fix the cause (the font, a padding, the layout), not the box.
- `icon "<name>": x a -> b`: an icon out of place.
- `"(the page below the header)": y a -> b`: the header's height, or where it leaves the page,
  differs.
- `only on the source` / `only on the page`: a missing or changed label.
- `(N inherited from the baseline, not counted)`: what the page already had before you.
- `not clean at: <sizes>`: re-run only those sizes (`--sizes`) while fixing.

## 4. 2x pixels

The four text commands of step 3 again, with `--scale 2 --shots <out>/x2/<state>` (one `<state>`
per command: `closed`, `open-<label>`, `mobile-menu`, `scroll`): `0 differing pixels` at every
size. Open the two shots of a size that is not clean (`<prefix>-<size>-source.png` and
`-page.png`).
- An open menu's count is split: `in the header and open panel` is yours. `below them` is yours
  too when your header moved the page; otherwise it is the body of a page that is not the source
  page.
- At 2x a sub-pixel position shows: an icon drawn as an `<img>` or a CSS mask where the source
  has an inline SVG, or a `top: -0.5px` nudge.

## 5. Lint

```bash
npx eslint blocks/header blocks/tabs
npx stylelint "blocks/header/*.css" "blocks/tabs/*.css"
```

(`blocks/tabs` only when you installed it.)

## Running the ladder

- While fixing: re-run only what failed, and only the sizes a text command lists in
  `not clean at:`.
- At the end: run every command of the ladder in full once, **one command per tool call**
  (several calls at once are fine), and read its whole output. Never chain the commands, and
  never pipe them into `tail` or `head`: a stalled check must show.
- A check that could not run to its end prints an error document (`CHECK_FAILED`, exit 1).
  Nothing was checked, so it is not a result. Fix the cause (is `aem up` still running? does
  the page load?) and run the same command again. For `text`, the message names the sizes that
  failed and holds the other sizes' lines: re-run those sizes.
- Exit 2 is a usage error (a bad option, a map key naming no region of the capture), or
  `playwright-cli` or the CLI's image libraries missing.
