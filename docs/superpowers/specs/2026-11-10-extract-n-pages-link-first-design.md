# extract: link-first page order when the user names N

## Why

User feedback: when someone enters a URL and asks for N pages, they expect
those N to start from the page they entered. Today the crawler fills the
slots in sitemap order, so the pages the entry page links to are often cut.

## Goal

When the user names N, `stardust/scripts/crawl.mjs` picks pages in this order:

1. the entry URL (home or any other page),
2. the same-origin pages it links to, in document order, up to N,
3. other discovered pages (sitemap order, as today) up to N.

## Non-goals

- No change when N is not named. The 5-page checklist + scoring stays.
  The crawler's default 25 stays. The hands-off 100/20 roster stays.
- No change to `--pages` (an explicit list is never reordered or dropped).

## Approaches

- **A. In `crawl.mjs` (picked).** The probe page already sits on the entry
  URL inside `discover()`. Deterministic, testable, about 10 lines.
- B. Docs only, agent builds a `--pages` list by hand: drifts run to run.
- C. A new `--order links` flag: an option nobody needs apart from N.

PR review update: the first trigger (any explicit `--max`) also fired on
default and roster caps that pass `--max`. The trigger is now a
`--link-first` flag that only a user-named N sets. The order stays in
`crawl.mjs` as in A.

## Design

- "N named" = `--link-first --max <n>`. `--max` alone never turns it on.
- Without `--link-first`, today's order stays, for any `--max`.
- Linked pages = `a[href]` on the rendered entry page, same origin.
  They are normalized and deduped with `normalizeUrl` / `dedupeKey`.
  They keep document order: header nav, then body, then footer.
- Links to asset files (`.pdf`, images, `.css`, `.js`, `.xml`, `.zip`)
  are skipped, so they do not use up a slot. My call:
  `ia-extraction.md` § Filtering already excludes them.
- Remaining slots come from the sitemap list, as today. With no sitemap,
  the entry links already are the list.
- Agent side: a user-named N ("only 30 pages", "extract 10 pages") maps to
  `--cap N` → `crawl.mjs --link-first --max N`. In hands-off, a user-named N replaces
  the 100/20 roster defaults (my call: the user said what they want).

## Touches

- `skills/extract/scripts/crawl.mjs`: arg parse records that `--max` was
  given. `discover()` orders link-first when it was. Pure helper exported
  for the test.
- `skills/extract/scripts/test/crawl.test.mjs`: entry first, links in
  order, asset links skipped, sitemap fill, cap respected, no-N unchanged.
- `skills/extract/SKILL.md` Phase 1 step 6 and
  `reference/ia-extraction.md` § Priority for the cap: one rule home,
  one pointer.
- `skills/stardust/SKILL.md` hands-off volume caps: one pointer line.
- Release: patch bump (`plugin.json`, root `marketplace.json`, CHANGELOG).

## Left to the builder

Exact wording of the doc lines (fold elsewhere to keep the prose delta flat,
per `plugins/stardust/AGENTS.md`).
