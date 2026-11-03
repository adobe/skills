# Reading the header checks' output

## Problem/Feature Description

A developer is rebuilding the header of `https://www.example.com/` as the header block of their
AEM Edge Delivery Services project, 1:1 with the source. The capture is in
`.migrate-header/source`, the page is served by `aem up` at `http://localhost:3000/`, and the web
CLI is installed as `$WEB`. They ran the closed-header text check:

```
$WEB header check text https://www.example.com/ http://localhost:3000/ --sizes 1440,1200,992,820,390x844 --hide-css .migrate-header/source/overlays.json --source-cache .migrate-header/source/text-cache --format text
```

It printed this and exited 0:

```
1440x900 "Products": fontWeight 500 -> 400; w 71.2 -> 68.9
1440x900 "Pricing": x 498.4 -> 495.2
1440x900 "(the page below the header)": y 96 -> 98
1440x900 icon "Search": x 1302 -> 1303.5
1440x900 text styles: 3 differ of 14 matched texts
1200x900 "Products": fontWeight 500 -> 400; w 71.2 -> 68.9
1200x900 "Pricing": x 418.4 -> 415.2
1200x900 text styles: 2 differ of 14 matched texts
992x900 text styles: 0 differ of 14 matched texts
820x900 text styles: 0 differ of 9 matched texts
390x844 text styles: 0 differ of 7 matched texts
not clean at: 1440x900,1200x900 (re-run those with --sizes while fixing)
```

The same check with `--mobile-menu --sizes 390x844,460x1000` printed an error document and exited 1:

```json
{ "error": { "code": "CHECK_FAILED", "message": "1 of 2 sizes could not be compared (460x1000); the lines of this run:\n390x844 text styles: 0 differ of 22 matched texts", "hint": "re-run those with --sizes 460x1000" } }
```

The developer asks: "The first command exited 0, so the closed header is done, isn't it? And the
mobile check said 0 differ, so I can move on to the 2x step?"

The project's `blocks/header/header.css` has, among others:

```css
.header.block {
  --header-nav-font-weight: 400;
  --header-nav-gap: 2rem;
}

header .header-tools .icon-search img {
  width: 20px;
  height: 20px;
}
```

The source's computed styles show the nav labels at `font-weight: 500`, and the search icon as an
inline `<svg>` 19.5 px wide.

## Output Specification

Answer the developer: say whether each check is done, explain what each line of the output means,
say what to change in the header (and what not to change), and give the exact commands to run next.
Do not run anything; write the answer only.
