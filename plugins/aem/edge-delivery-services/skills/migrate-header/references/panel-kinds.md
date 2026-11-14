# Choosing how each menu is built

Decide these from the capture before writing the nav document. Look at the shots yourself: open
each image, do not guess from the numbers alone.

## Each desktop menu: its panel kind

For each state of `<src>/open/open.json` with `newLinks > 0`, open `<src>/open/<file>` (the page at
1440x900 with that menu open) and read `panel` (its box, background, links and text):

| the open panel shows | kind | author it as |
|---|---|---|
| one short list of links under the label | simple list | a nested `<ul>` under the label in the nav document |
| several columns of links, maybe with column headings | columns | a fragment panel: a `columns` block, one column per group (heading + list) |
| a list of categories on one side that switches the links shown beside it | tabbed | a fragment panel: optional heading, then a `tabs vertical` block, one row per category (cell 1 the category label, cell 2 its list of links with their description text) |
| a few featured items with images or icons | cards | a fragment panel: a `cards` block, or `columns` |

- A panel mixing kinds (columns of links and a featured card) is a fragment with those blocks in
  the source's order.
- A tabbed panel shows its first category open, as on the source. Text after the tabs (a note,
  a "View all" link) follows the block in the fragment.
- When you cannot tell two kinds apart from the shot, open the menu on the live source
  (`playwright-cli`, your own session) and look at its DOM.

## Alignment: geometry, not judgement

From `panel.rect` at 1440 px wide:

- `w >= 1368` (95 % of the width): `full`.
- The centre within 24 px of 720: `header` when `w > 900`, else `center`.
- Otherwise: `trigger`.

Use the most common value as the main nav's `Dropdown Align`. A menu that differs needs its own
CSS.

## The mobile menu

`<src>/open/mobile-menu.png` is the burger opened at 390x844, and `mobile-item.png` is the same
menu after tapping its first item. They set the main nav's metadata:

| tapping the item | `Mobile Style` |
|---|---|
| expanded it in place: its sub-items appear under it, the other items stay | `accordion` |
| replaced the list with the item's own content, with a back control | `slide-in` |
| opened a full-screen layer with the item's content | `fullscreen` |

`Mobile Tools`: `bar` when the mobile header bar shows a search icon, an account icon or a call to
action besides the logo and the burger (`<src>/regions/<id>.mobile.png`); else `drawer`, or
`hidden` when the source's drawer does not show them either.

No `mobile-menu.png`: the capture could not open the burger. Open it on the live source at 390 px
and decide from what you see.

## Facts, not choices

These come from the capture; do not decide them from the shots:

- Each menu's trigger: `states[].trigger` (`hover` or `click`). The main nav's
  `Dropdown Trigger` is `hover` when any menu opens on hover.
- The breakpoint: `header.breakpoint.shownAt`.
- The scroll behaviour: `header.scroll` is a first guess. Check what each band does on the live
  source (rule 5).
