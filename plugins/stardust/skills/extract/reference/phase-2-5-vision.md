# stardust:extract: phase 2.5, vision verification

The text of this part of `skills/extract/SKILL.md`, which points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 2.5 — Vision verification

Read the whole page through its thumbnail —
`node stardust/scripts/thumb.mjs stardust/current/assets/screenshots/<slug>.png --width 480`
(`skills/extract/scripts/thumb.mjs`, copied beside `crawl.mjs`; a
box-filter downscale, so 1-px rules and hairline borders survive; its
`--max-bytes` cap, 150 KB by default, re-encodes a heavy page narrower
first and crops only as a last resort, never below 60 % of the page) —
never the full-resolution screenshot, and read any detail as a crop of
the full capture. The check is of the WHOLE page: read the script's
stdout line before the image, and when it prints a share below 100
(`cropped at <n>px of <H> = <share>%`) run the same command with
`--offset <n>` and read `<slug>-thumb-<n>.png` too, repeating while its
`rows <n>-<end>px` line ends short of `<H>`. A recorded hands-off run's
thumbnails kept a median 28 % of each page and the check read them as
the page. **A thumbnail enters the context only after `thumb.mjs` has
written it (≤ 150 KB, or the floor thumbnail it named on stderr, exit 1)
— or the vision check runs in a subagent that reads the thumbnails and
returns one line per page**
(`<slug>: ok | recaptured | suspect — <note>`); a recorded hands-off run
read eight `*-thumb.png` files of 268–608 KB each into one context —
3.2 MB of pixels for eight verdicts.

On mismatch, re-run that page's capture with the escalation ladder
before proceeding: bump the wait mode one step
(`reference/playwright-recipe.md` § Wait modes), then headed Chrome
(§ Bot-management fallback), then a fresh browser context. Record
the outcome per page in `_crawl-log.json#visionCheck[]`:

```json
{ "slug": "pricing", "verdict": "recaptured", "notes": "record said zero CSS backgrounds; screenshot shows a full-bleed photo hero" }
```

`verdict` is `"ok" | "recaptured" | "suspect"` — `suspect` means the
mismatch survived the ladder; downstream phases treat that record as
unreliable. Vision is the **authoritative** capture check; the
heuristic defenses (low-media flag, `spaShellSuspect`, duplicate
hash) remain as cheap early signals but no longer gate alone.
