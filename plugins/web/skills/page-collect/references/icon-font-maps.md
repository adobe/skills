# Icon Font Maps

Placeholder for future icon font codepoint → SVG mapping tables.

When the icon collector detects an icon font (element with
pseudo-content rendered in a known icon font family), it currently
flags the entry in the manifest with `source: "icon-font"` and
`nameConfidence: "low"` without extracting an SVG.

## Future: Auto-conversion

To enable automatic icon font → SVG conversion, populate this file
with lookup tables mapping Unicode codepoints to SVG path data for
common icon font families:

- Font Awesome (free set)
- Material Icons / Material Symbols
- Phosphor Icons
- Heroicons

Each table maps `{ codepoint: string, name: string, svg: string }`.
The collector would detect the font family, look up the rendered
codepoint, and emit the corresponding SVG.
