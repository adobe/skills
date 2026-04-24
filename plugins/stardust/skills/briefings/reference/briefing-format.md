# Briefing Format

Briefings are human-authored structured documents that capture business intent. The agent helps draft them through conversation but the user owns the content.

Every briefing uses the same **structured** shape. Any section whose content is not yet known is written as `[TBD]` verbatim; downstream skills synthesize on-brand content for `[TBD]` fields and stamp provenance. Fidelity is a consequence of how much the user fills in, not a level the user selects upfront.

## Shape

| Shape | Sections authored | When it applies |
|---|---|---|
| **Structured (default)** | frontmatter + `# Intent` + `# Audience` + `# Key Messages` + `# Calls to Action` + `# Tone` | Always. Any field may be `[TBD]`. |
| **Fully specified** | + `# Copy` + `# Imagery` | When the user has committed to final words or image direction. Reached by filling in those sections — not by re-selecting a fidelity. |

You can deepen a briefing later — the skill supports re-entering and filling in `[TBD]` fields or adding `# Copy` / `# Imagery` to an existing file.

## Page Briefing Schema

```markdown
---
page: [Page Name]
path: /[url-path]
type: landing|product|about|contact|blog|custom
---

# Intent
[1–3 sentences: What is this page FOR? What should a visitor feel/do after seeing it?]

# Audience
[Who visits this page? Demographics, mindset, how they arrived (search, social, direct)]

# Key Messages
1. [Primary message — the one thing they must take away]
2. [Supporting message]
3. [Supporting message]

# Calls to Action
- Primary: [Main action — verb + object, e.g. "Explore Products"]
- Secondary: [Alternative action, e.g. "Browse Recipes"]

# Tone
[How should the voice adapt for this specific page? Reference brand voice if available, but specify adjustments.]

# Copy
[Section-by-section final copy. Only fill in for sections where you want exact wording preserved.]

## Hero
- Headline: [exact text]
- Subhead: [exact text]
- Primary CTA: [label + destination]

## [Section name]
- [field]: [value]

# Imagery
[Section-by-section image direction. Describe subject, style, composition, and mood. Include source hints if you have them.]

## Hero
- Subject: [what's in the image]
- Style: [photographic, illustrated, product capture, etc.]
- Source hint: [URL, file path, or "generate" if the build stage should create it]
- Alt text: [for accessibility]
```

## Site Briefing Schema

For multi-page sites, `stardust/briefings/_site.md` captures cross-cutting concerns:

```markdown
---
site: [Site Name]
pages: [homepage, products, about, contact]
---

# Purpose
[What is this website FOR as a whole?]

# Navigation
- [Primary nav items in order]
- [Footer nav structure if different]

# Shared Messaging
[Tagline, value proposition, or messaging that appears across pages]

# Content Hierarchy
[Which page is most important? How do pages relate to each other?]

# Content Reuse Map
[Define which content types are shared across pages. Each entry names the fragment type, which page owns it, and where it gets reused.]

| Fragment | Source Page | Reused On | Purpose |
|----------|------------|-----------|---------|
| [e.g. recipe-card] | [/recipes] | [/, /capabilities] | [Inspire use, cross-link to recipes] |
| [e.g. testimonial-card] | [/stories] | [/, /capabilities, /recipes] | [Social proof, cross-link to stories] |

Rules:
- The homepage should pull excerpts from every major content page
- Each inner page should include at least one reused section from a sibling page
- Reused content is an excerpt (3-4 items), not a full duplicate — it creates "see more" motivation
- Every reused section includes a CTA linking to the source page
```

Page briefings inherit context from the site briefing. They don't need to repeat shared information.

## Rules

1. The agent NEVER generates a briefing autonomously. It can help draft through conversation, but the user must review and approve the content.
2. Every structured section (`# Intent`, `# Audience`, `# Key Messages`, `# Calls to Action`, `# Tone`) appears on every briefing. If the user hasn't committed to a section yet, write `[TBD]` verbatim as the body of that section rather than omitting it. `# Copy` and `# Imagery` remain optional — add them only when the user has final words or image direction.
3. Briefings use plain language, not marketing jargon. "Make them want to buy" is better than "Drive conversion through compelling value articulation."
4. One briefing per page. The filename matches the page: `homepage.md`, `products.md`, `about.md`.
5. `# Copy` sections are authoritative — later stages (wireframes, build) must use the exact strings. If a section has no `# Copy` entry, downstream stages may generate placeholder copy.
6. `# Imagery` sections with a `Source hint` pointing to an asset must be respected by the build stage. Without a hint, the build stage generates a placeholder.
