# stardust:extract: sibling-site discovery

The text of this part of `skills/extract/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

After the primary crawl (Phases 2–2.5), harvest candidate same-brand
origins from evidence **already captured** — no extra navigation:

- footer / nav links out to other properties
- "our brands" / "our companies" pages
- `hreflang` alternates on other domains
- subdomain families (`shop.`, `careers.`, country subdomains)
- `og:site_name` matches across captured pages

List candidates with confidence + the evidence line in the crawl
report and in `_crawl-log.json#siblingCandidates[]`:

```json
{ "origin": "https://example.co.uk", "confidence": "high", "evidence": "hreflang alternate on 4/5 pages", "decision": "included" }
```

- **Interactive:** propose — *"found 3 candidate sibling properties —
  include as `--brand-source`?"* — and proceed on the answer.
- **Hands-off** (`state.json.handsOff` is true): auto-include up to
  **2 high-confidence** candidates as brand-sources; record the
  decision in `siblingCandidates[].decision`.

Discovery is capped and cheap: harvesting reads captured evidence
only, and each included sibling gets the shallow brand-source
capture (≤ 3 pages). It must never balloon the crawl.
