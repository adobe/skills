# Pick-UI Template

HTML template the `brand` skill writes to `stardust/_palette-pick.html` during Phase 2 (Palette Selection). The designer opens this file in their browser, reads the five candidate palettes, and tells the skill a number (1–5).

The UI is self-contained HTML (embedded CSS, no external JS). No fetch, no network, no framework.

## Required inputs

The skill renders this template with five slots:

| Slot | Type | Source |
|---|---|---|
| `description` | string | the natural-language brief the designer gave OR the one synthesized from brand concept |
| `classifier_output` | object | `{ energy, contrast, saturation_level, hue_bias, ground_family }` — any field may be null |
| `candidates` | array of 5 | top-5 palettes from `_shared/palettes/<ground-family>/*.json` after filter + score |
| `recommended_index` | integer 1–5 | the default pick (hashed from description for determinism) |

Each candidate has:
- `name` — palette's display name from Coolors
- `hexes` — array of 5 hex strings
- `anchor` — one of the hexes, marked with ★ in the UI
- `source` — Coolors URL
- `classification` — `{ ground_family, hue_bias, saturation_level, energy, has_cream_family_swatch }`

## Full template

Paste this verbatim into `_palette-pick.html`; replace the `{{placeholder}}` slots with runtime data.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pick a palette · {{description}}</title>
<style>
  :root { --bg:#151515; --card:#1E1E1E; --card-border:#2A2A2A; --ink:#F2F2F2; --mute:#9A9A9A; --link:#9ED1FF; --highlight:#F2B96B; }
  *{box-sizing:border-box}
  body{font-family:-apple-system,"Inter","Helvetica Neue",sans-serif;margin:0;padding:40px 48px;background:var(--bg);color:var(--ink);line-height:1.5;font-size:14px}
  h1{font-size:24px;margin:0 0 4px;letter-spacing:-.01em;font-weight:700}
  .desc{font-family:"JetBrains Mono",ui-monospace,monospace;color:#D8D8D8;font-size:13px;background:#222;padding:10px 14px;margin:8px 0 4px;display:inline-block;border-radius:2px}
  .cls{color:var(--mute);font-size:11.5px;margin:8px 0 0;font-family:"JetBrains Mono",monospace}
  .cls span{background:#2F2F2F;padding:2px 8px;margin-right:6px;border-radius:2px;display:inline-block;margin-bottom:3px}
  .instr{color:var(--mute);font-size:13px;margin:28px 0 20px;max-width:72ch;line-height:1.55}
  .instr b{color:var(--highlight);font-weight:600}
  .pick-label{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--mute);margin:30px 0 10px;font-weight:500}
  .pick-label.alt{margin-top:36px}
  .card{background:var(--card);border:1px solid var(--card-border);border-radius:3px;margin-bottom:10px;overflow:hidden;position:relative}
  .card.recommended{border-color:var(--highlight)}
  .card .num{position:absolute;top:8px;left:10px;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.08em;color:var(--ink);background:rgba(0,0,0,.5);padding:2px 8px;border-radius:2px;z-index:2}
  .card.recommended .num{background:var(--highlight);color:#151515;font-weight:600}
  .swrow{display:flex;height:72px}
  .card.big .swrow{height:112px}
  .sw{flex:1;padding:8px 10px;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;letter-spacing:.04em;display:flex;flex-direction:column;justify-content:flex-end;min-width:0;position:relative}
  .sw .anchor{color:var(--highlight);font-weight:700;margin-left:2px}
  .sw .flag{position:absolute;top:6px;right:8px;font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--highlight)}
  .meta{padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
  .meta .name{color:var(--ink);text-decoration:none;font-weight:500;font-size:14px;letter-spacing:-.005em}
  .card.big .meta .name{font-size:16px;font-weight:600}
  .meta .name:hover{color:var(--link)}
  .meta .tags{color:var(--mute);font-family:"JetBrains Mono",monospace;font-size:10.5px}
  .footer{color:var(--mute);font-size:12.5px;margin-top:40px;line-height:1.6;max-width:72ch}
  .footer code{background:#2F2F2F;padding:2px 6px;border-radius:2px;color:var(--ink);font-family:"JetBrains Mono",monospace;font-size:11.5px}
</style>
</head>
<body>
<h1>Pick a palette</h1>
<div class="desc">{{description}}</div>
<div class="cls">
  <!-- One <span> per non-null classifier field, e.g.: -->
  <span>energy: 5</span>
  <span>contrast: 5</span>
  <span>saturation: 5</span>
  <span>hue_bias: hot</span>
  <span>ground_family: saturated</span>
</div>

<p class="instr">
  Five candidates from the bundled library — all colors come from
  <a href="https://coolors.co/palettes/trending" target="_blank" style="color:var(--link)">coolors.co trending</a>,
  classified by deterministic HSL heuristics. <b>Option 1</b> is the recommended pick
  (highest filter score). Options 2–5 are alternatives ranked by the same score.
</p>

<div class="pick-label">Recommended · option 1</div>

<!-- The card for the recommended pick (index 1). Bigger swatches, gold border. -->
<div class="card big recommended">
  <span class="num">1</span>
  <div class="swrow">
    <!-- 5 × .sw blocks, background:{{hex}} and color picked for contrast -->
    <div class="sw" style="background:#FF4E00;color:#000">#FF4E00<span class="anchor">★</span></div>
    <div class="sw" style="background:#1A140F;color:#fff">#1A140F</div>
    <div class="sw" style="background:#1E3A4F;color:#fff">#1E3A4F</div>
    <div class="sw" style="background:#6E6560;color:#fff">#6E6560</div>
    <div class="sw" style="background:#FDF6EF;color:#000">#FDF6EF<span class="flag">cream</span></div>
  </div>
  <div class="meta">
    <a class="name" href="{{source_url}}" target="_blank">{{palette_name}}</a>
    <span class="tags">saturated · hot · sat 5 · energy 5</span>
  </div>
</div>

<div class="pick-label alt">Alternatives · options 2 – 5</div>

<!-- Four alternative cards, index 2–5. Same structure, card.big removed. -->
<div class="card">
  <span class="num">2</span>
  <div class="swrow"><!-- 5 × .sw --></div>
  <div class="meta">
    <a class="name" href="{{source_url}}" target="_blank">{{palette_name}}</a>
    <span class="tags">{{ground}} · {{hue}} · sat {{sat}} · energy {{energy}}</span>
  </div>
</div>

<!-- repeat for 3, 4, 5 -->

<p class="footer">
  To pick, tell the assistant a number: <code>1</code>, <code>2</code>, <code>3</code>,
  <code>4</code>, or <code>5</code>. You can also type a palette name, or
  <code>refine</code> to change the description and re-run the classifier.
</p>

</body>
</html>
```

## Styling notes

- **Dark background (`#151515`)** — lets the swatches be the dominant visual element
- **Recommended card** gets a gold border (`#F2B96B`) so it's distinguishable at a glance
- **Swatch text color** chosen automatically from luminance: `#000` when `0.299r + 0.587g + 0.114b > 140`, else `#fff`
- **Cream-family flag** shown at the top-right of any swatch whose hex passes the v0.5.1 cream test — visible tell for the designer so they can see if cream accents slipped in
- **Palette name links** to the Coolors URL so the designer can click through and tune
- **Anchor marker (★)** on exactly one swatch per palette — the anchor candidate from classification

## Template generation algorithm

Pseudocode the skill follows at render time:

```
1. open pick-ui-template.html
2. substitute {{description}} with the brief
3. substitute classifier spans with one <span> per non-null classified dimension
4. for each of 5 candidates:
     a. assign index 1-5 (1 = recommended pick)
     b. render 5 swatches with background:<hex>, color auto-picked for contrast
     c. mark anchor hex with <span class="anchor">★</span>
     d. if is_cream_family(hex), add <span class="flag">cream</span>
     e. render .meta row with name + source link + classification tags
     f. mark card 1 as .card.big.recommended; cards 2-5 as .card
5. write to stardust/_palette-pick.html
6. tell the designer the file path and the "pick by number" instruction
```

## Reference example

See `/Users/paolo/excat/tmp/e2e-3/pick-sage.html` in the session repo for a rendered example (produced by the standalone `tools/pick-palette.py` during integration bench testing). That file uses the same structural layout this template describes.
