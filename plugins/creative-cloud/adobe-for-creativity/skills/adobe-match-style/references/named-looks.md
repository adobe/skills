# Named looks: starting recipes

Read this only when the user names a look instead of sharing a reference image. These are **starting points**, not fixed presets: adjust them to the photos (Step 2 of `SKILL.md`), and keep each value inside the tool's documented range.

Values use the recipe fields from `SKILL.md`. `regions` fills use `blendMode: "softLight"` unless noted.

Measured on the Adobe tools (Research-Adobe/expand-adobe-3p-skills, `datasets/qa2skill/match-photo-look/calibration/`): any `tempA`/`tempB` change darkens the photo by about 5 lightness units, so the recipes below that set temperature include `gamma` around 1.15 to make up for it. Temperature is lopsided: `tempB` +100 warms only slightly (about a quarter as much as `tempB` -100 cools), so warm looks also use a warm `wash` or warm `regions`.

| Look | What defines it | Starting recipe |
|---|---|---|
| **Kodak Portra 400** | Warm, soft skin; pastel colors; low contrast; lifted blacks; fine grain | `global`: `tempA` 8, `tempB` 70, `tempLuminance` 50, `gamma` 1.15, `contrast` -15, `darks` 15, `vibrance` -10 · `channels`: green -25 · `grain` 20 |
| **Cinestill 800T** | Cool tungsten balance; teal shadows; warm, glowing lights; strong grain | `global`: `tempA` -5, `tempB` -80, `tempLuminance` 50, `gamma` 1.15, `contrast` 15 · `regions`: background teal (30,110,130) at 20 · `channels`: red +15 · `grain` 35 |
| **Teal and orange** | Warm subject and skin against a cool teal background; punchy contrast | `global`: `contrast` 20, `vibrance` 10 · `regions`: subject orange (255,160,90) at 20; background teal (20,110,130) at 25 |
| **Wes Anderson pastel** | Bright, symmetrical, pastel pinks and yellows; low contrast; warm | `global`: `tempA` 12, `tempB` 60, `tempLuminance` 50, `contrast` -20, `gamma` 1.25, `saturation` -5 · `channels`: yellow +15, red +10 |
| **The Matrix** | Green cast over everything; cool, low saturation; crushed blacks | `global`: `tempA` -40, `tempB` -10, `tempLuminance` 50, `gamma` 1.1, `contrast` 25, `darks` -15, `saturation` -25 · `channels`: green +20 |
| **Blade Runner 2049** | Heavy orange haze or cold blue; low saturation outside one dominant hue; soft contrast | Orange variant: `global`: `tempA` 20, `tempB` 100, `tempLuminance` 50, `gamma` 1.15, `contrast` -10, `saturation` -20 · `wash`: (255,140,40) `softLight` |
| **Film noir** | Black and white; deep blacks; bright highlights | `preset`: a B&W high-contrast preset from `image_list_presets` · `global`: `contrast` 30, `darks` -20 · `grain` 25 |
| **Sepia / vintage** | Monochrome brown; faded blacks; grain | `mono`: hue 35, saturation 25, lightness 0 · `global`: `contrast` -10, `darks` 15 · `grain` 30 |
| **Neon / cyberpunk night** | Magenta and cyan; saturated; dark | `global`: `contrast` 20, `saturation` 25, `gamma` 0.85 · `regions`: background magenta (200,40,160) at 25 · `wash`: (0,200,220) `softLight` |

If a named look isn't listed, describe it along the five dimensions in `SKILL.md` Step 2 and say that the recipe is your reading of that look.
