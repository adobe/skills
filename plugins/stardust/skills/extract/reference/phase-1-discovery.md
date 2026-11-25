# stardust:extract: phase 1, discovery

The text of this part of `skills/extract/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 1 — Discovery

Discover the page inventory before crawling. Procedure in
`reference/ia-extraction.md`. In summary:

1. Fetch `<origin>/sitemap.xml`, then `<origin>/sitemap_index.xml`,
   then check `robots.txt` for `Sitemap:` directives.
2. If no sitemap is reachable, run a same-origin BFS crawl from
   `<url>`, depth-limited to 3, link-extracting from rendered HTML.
3. Filter the discovered URL list: same origin only, exclude
   `mailto:`, `tel:`, anchor-only links, query-only variations,
   common asset paths (`.css`, `.js`, `.pdf`, image extensions).
4. De-duplicate trailing-slash variations.
5. Apply the junk-page filter (`reference/ia-extraction.md` §
   Junk-page filter) unless `--no-junk-filter` is set. Surface the
   filtered list to the user as overridable.
6. Apply the cap (default 5, or `--cap`, or `--all` for no cap)
   and **proceed silently**. Print an informational summary of
   what was kept and what was cut — but do **not** gate on user
   confirmation. Users who want different scope set it
   spontaneously at command time:

   ```
   $stardust extract https://example.com              # default 5 pages
   $stardust extract https://example.com --cap 25     # bump to 25
   $stardust extract https://example.com --all        # lift the cap
   $stardust extract https://example.com --pages home,about,pricing
   $stardust extract https://example.com --single     # just the entry URL
   ```

   The agent reads spontaneous scope intent from the user's prompt
   (e.g. "extract all pages", "look at just the home and pricing",
   "do a full crawl") and applies the equivalent flag. No
   re-confirmation needed once intent is clear.

   Informational output (not a prompt — proceed immediately):

   ```
   Discovered 38 pages on https://example.com (sitemap.xml).
   Filtered as likely junk (5): /test/, /sample-page/, /holiday1/, ...
   Selecting 5 highest-priority pages:
     - / (home)
     - /about
     - /pricing
     - /products
     - /contact

   Cut (28 pages, --all to lift): /blog/post-1, /blog/post-2, ...

   Extracting...
   ```

   Selection heuristic: when the user names N, link-first order (the
   entered page, then its links). Otherwise page-type checklist first,
   then score-based ranking. See `reference/ia-extraction.md` § Page
   selection and § Priority for the cap.

7. Write the discovered list to `stardust/current/_crawl-log.json`
   (created if absent) with `_provenance` and the full discovery
   reasoning, including `filteredAsJunk[]` and `userChoice`. This is
   an audit trail, not a state file.
