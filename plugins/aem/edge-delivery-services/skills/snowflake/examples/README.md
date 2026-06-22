# Worked examples

This directory is intentionally light on bundled artifacts. Sample
conversions live in the R&D repo this skill was distilled from; they
serve as references but should not be copy-pasted as-is into a new
run (they're project-specific commits with their own asset paths,
branch names, and DA roots).

For a current snapshot of worked iterations, see the
`snowflake/iter-*-close` tags (or the project's equivalent
naming) in the source repo. Each iteration directory typically
contains:

```
.snowflake/projects/<NNN>-<slug>/
  README.md                       run summary, source URL, status
  notes.md                        full phase log
  learnings.md                    project-specific findings
  input/                          captured source HTML + external assets
  output/                         generated artifacts (template, fragments,
                                  CSS, animations JS, DA doc)
  diff/                           local + production screenshots
```

## Patterns demonstrated across past runs

These are the source shapes the methodology has been tested
against. When you encounter a similar pattern in a new conversion,
the matching rule in `knowledge/learnings.md` and
`knowledge/methodology.md` should apply.

| Pattern | Where it shows up |
|---|---|
| Stardust-style provenance with `data-section` attrs | Most generator-produced static pages |
| Section first-class collisions (multiple `section.section`) | Generators that use utility-class CSS |
| Hero as a `<div>`, not `<section>` | Sources with scroll-driven hero designs |
| No `<header>` tag (nav lives in a `<div>`) | Hand-coded / Figma-derived sources |
| Background-image slot writer (CSS-driven photos) | Cards with `style="background-image:url(...)"` |
| External CSS file (not just inline `<style>`) | Sources with shared site-wide stylesheets |
| Inline `<script>` blocks + external lib (Lenis, GSAP) | Scroll-animation-heavy pages |
| Self-hosted fonts (CORS issues if cross-origin) | Brand-owned typography |
| Local-only source (no public URL) | Bespoke prototypes; needs vendor strategy |
| `<br>` in headlines (stripped by DA pipeline) | Source markup that intends visual line breaks |

For each pattern, the corresponding rule in `knowledge/methodology.md`
(Generate phase or Round-trip phase) tells you what to do.
