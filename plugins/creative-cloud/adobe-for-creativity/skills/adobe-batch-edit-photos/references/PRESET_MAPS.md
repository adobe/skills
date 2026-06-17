# Preset Maps

## Look → Preset Naming Signals

Use these signals to classify each preset returned by `image_list_presets` into a look bucket.

| Look | Naming signals to match |
|------|------------------------|
| **Auto (balanced)** | `Auto`, `Balanced`, `Natural`, `Neutral`, `Default`, `Adobe Color`, `Standard` |
| **Warm & Golden** | `Warm`, `Golden`, `Glow`, `Sunset`, `Cozy`, `Amber`, `Warm Pop` |
| **Bright & Airy** | `Airy`, `Bright`, `Light`, `Clean`, `Pop`, `Lift`, `Fresh` |
| **Moody & Cinematic** | `Moody`, `Cinematic`, `Dark`, `Drama`, `Dramatic`, `Shadow`, `Deep` |
| **Cool & Fresh** | `Cool`, `Blue`, `Clear`, `Crisp`, `Sky`, `Azure` |
| **Vibrant & Punchy** | `Vibrant`, `Punchy`, `Bold`, `Vivid`, `Pop`, `Saturate` |
| **Muted & Film** | `Film`, `Muted`, `Fade`, `Faded`, `Analog`, `Grain`, `Vintage`, `Matte` |

**Classification rules:**
- Assign each preset to at most one look. When a name matches multiple looks, assign it to the closest overall character (e.g. soft warm pop → Warm & Golden; high-contrast punchy pop → Vibrant & Punchy).
- Prefer `Adaptive:` prefixed presets for look-driving.
- Pick at most **2 presets per look** — one primary (strong match) and one optional secondary. Apply primary first, secondary only if it adds something different.
- If no preset matches a look, that look runs with color-temperature and manual adjustments only (no preset).

## Selective Adaptive Preset Buckets

Used only when the user opts into selective enhancements (Step 5e). Assign buckets from the same preset list.

| Bucket | Naming signals | Applied when |
|--------|---------------|--------------|
| **Subject / Person** | `Subject`, `Person`, `Pop`, `Warm Pop`, `Portrait`, `Skin`, `Body` | Face, Torso, or Skin detected |
| **Sky** | `Sky`, `Blue Drama`, `Dark Drama`, `Cloud`, `Horizon`, `Outdoor` | Sky detected |
| **Background** | `Background`, `BG`, `Blur Background`, `Bokeh`, `Depth`, `Defocus` | Background detected |
| **Body Parts / Clothes** | `Clothing`, `Outfit`, `Clothes`, `Hair`, `Torso`, `Body Part` | Clothing or Hair detected |

**Rules:** Pick at most 1 preset per bucket. Leave empty if no match — do not force a poor fit. These buckets are separate from the Look→Preset Map; a preset can appear in both.
