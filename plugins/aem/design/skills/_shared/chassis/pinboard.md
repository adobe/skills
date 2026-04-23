---
chassis: pinboard
version: "0.2"
scope: artifact-agnostic (applies to brand boards, prototypes, and other aem-design artifacts)
---

# Pinboard

Non-linear, collage presentation. No sticky nav, no numbered sections, no linear flow — the artifact is a spatial arrangement of pinned cards, notes, stamps, photographs, and handwritten annotations. The reader moves through it as though walking along a corkboard.

This chassis describes a **presentation pattern** only. It does not name which sections get rendered — that is the data contract's job. A renderer reads the artifact's data contract for section list, then reads this chassis for how to present those sections as clusters.

Reference artifact in this repo: `tmp/e2e-3/aem-design/brand-board-v3-pinboard.html` (Nonna's Arsenal "Pinboard" variant).

## Intent

Feels like a working pinboard in a studio. Appropriate when the seed's register is `zine`, `tabloid`, `memoir`, or `supermarket flyer`, or when the brand's own identity is inherently scrapbook-adjacent (youth collectives, craft groups, community organisations, dance schools, archives-of-moments).

Also appropriate when the designer wants to deliberately refuse the document chassis and signal that the brand is alive rather than catalogued.

## Navigation

**Option A — no persistent nav.** The reader scrolls a single long pinboard. Orientation comes from the spatial layout itself, not from link targets.

**Option B — floating index card.** A single small card pinned at the top-left of the viewport, listing clusters as short labels. Non-sticky — it scrolls with the page.

**Do not add a sticky top bar to a pinboard.** It breaks the frame. If an artifact absolutely needs persistent navigation, use a chassis other than pinboard.

## Hero pattern

The "hero" is a cluster, not a headline. Three elements pinned together:

- Brand mark or page-title on a cream card, center-left
- A handwritten tagline on a sticky note, rotated -4° to +6°, in Caveat or similar
- A pinned photograph or illustration (polaroid frame, photo corners) related to the subject, rotated slightly

No conventional oversized headline. No CTAs in the hero cluster — actions live on a separate "invitation" card further down.

## Eyebrow conventions

Handwritten labels or stuck-on ticket stubs, NOT numbered eyebrows. Examples:

- "The paint samples" (handwritten, underlined, slight angle)
- "Saturday's route" (typewritten, on a separate card)
- "Memos & scrawls" (stamped, rotated -3°)

Labels are themselves pinboard elements — they carry photo corners or tape.

## Spacing rhythm

Scrapbook overlap. Cards rotate between -6° and +6° in rotation. Some cards overlap at the edges. Tape diagonals cross between clusters. Coffee rings and ink smudges are permitted as textures. Generous vertical space between clusters (150–200px) so each cluster reads as its own plane.

## Typography register

Multi-family chaos — 5 to 9 type families sharing the artifact. Typical combination: handwritten (Caveat / Homemade Apple) · typewritten (Special Elite / Courier Prime) · poster slab (Abril Fatface / Alfa Slab One) · magazine serif italic (Yeseva One) · rubber stamp (Rubik Wet Paint) · sign-writer (Bungee Shade) · body serif (Lora / DM Serif Display). Each cluster picks its own 2–3 from the deck.

No type system in the classic sense. The coherence comes from the shared ground (kraft paper, cream, notebook-ruled), not from a unified type scale.

## Demo / visual presentation style

Each section becomes a **cluster** on the pinboard. A cluster is a loose arrangement of 3–6 pinned elements sharing a visual theme: cards, notes, photographs, stamps, handwritten labels. Clusters are separated by space, not by dividers.

When the data contract asks a section to display demos (motifs, components, items in a collection, stops on a route, etc.), render each demo as a **pinned element within a cluster** — not as grid cells. A demo might be: a stamped card, a polaroid with a caption, a typewritten memo, a ticket stub. Arrange 3–6 demos per cluster with slight rotation variance.

## Cross-cluster linking

Each cluster should carry at least one handwritten annotation that links it to another cluster ("see also: voice →", "cf. the motifs cluster", "back to intro"). These are spatial cross-references — they may resolve to hyperlinks on a real artifact, but their visual form is marginalia, not menu items.

## What this chassis is NOT

- Not a classic archive — no numbered eyebrows, no horizontal grid, no sticky nav
- Not a dashboard — no cards-as-widgets, no meters, no status language
- Not a magazine — no column grid, no editorial rhythm, no pull quotes in typeset form
- Not a SaaS landing page — actively rejects that chassis

## Caveat — pinboard vs. collage-maximalism

This chassis pairs structurally with the **Collage-maximalism kit** entry in `_shared/divergence-toolkit.md` § 1 Motif moves. Picking the pinboard chassis does NOT excuse hitting the anti-toolbox. The chassis is the structural shell (clusters in space, not sections in a list). The motifs inside those clusters still count against the per-hit justification rule.

A pinboard that uses ALL of (rubber stamps · handwritten annotations · pinned cards · rotated date-blocks · ripped edges · typewriter captions) is the Collage-maximalism kit and needs a brand-specific justification for that combination — even though the chassis itself is appropriate.

## Example reference

La Palatine's site. A Cy Twombly workbook. An Apartamento interview spread when they go scrapbook. A considered teenager's bedroom wall. The margins of a well-used cookbook.
