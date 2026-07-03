# Mode notes — rationale and provenance

Background for rules that live in `direct/SKILL.md`. Nothing here is
a rule; every rule these notes justify is stated inline in SKILL.md.
Read when you need the "why" behind a mode default or a refusal
condition (e.g. when a user challenges one).

## Default-mode-flip note (2026-04-29)

The skill changed its default behavior on 2026-04-29 to make Mode A
(brand-faithful) the default whenever the captured brand surface is
`signal-strong`, rather than activating only on explicit user
signals. Behavior summary:

- Before: ambiguous phrases like *"make it more modern"* rolled the
  full divergence seed and produced rebrand-shaped output.
- After: ambiguous phrases default to Mode A; rebrand requires
  explicit phrase signal or `--rebrand` flag.

The flip was driven by dogfood evidence that the typical stardust
use case (presales refresh of an existing site for a brand owner
with design fatigue) was getting the wrong default.

## Why the mode-detection precedence is asymmetric

Stardust's primary use case is migrating an existing site with a
design refresh; "make it modern" / "stunning new version" / "design
fatigue cure" are migration-shaped asks. Treating those phrases as
rebrand triggers (rolling a fresh divergence seed) produces output
that is recognisably a different brand from the one that asked for
the refresh — a published failure mode. The precedence catches the
common case as the default and reserves divergence-seed rolls for
explicit rebrand requests: the safer mode (Mode A — brand-faithful)
catches ambiguous phrases, and the riskier mode (rebrand / full
divergence-seed) requires the user to name it.

## Why Mode A skips the type/palette roll

Going through the motions of font-deck and palette picks when both
are already locked would be ceremony, producing
`picked_by = "user-constraint"` records that don't reflect any real
choice.

## Why Mode A+ exists

The median redesign candidate is a site whose brand is right but
whose *execution* of that brand is part of the problem — a generic
system body face, a palette whose only accent fails contrast on half
its surfaces. Strict Mode A reproduces those weaknesses; rebrand
throws away the brand. Mode A+ authorizes bounded, evidence-gated
upgrades between the two.

## Why the image-reuse contract is part of Mode A

A variant that swaps a captured subject portrait for a gradient
placeholder, or moves the captured hero photo to a card thumbnail,
erases the brand's most load-bearing trust signal — the named-people
stories that almost every nonprofit / service-led site has spent
years building. Semantic position-preservation is therefore part of
brand-faithful inheritance, not a separate content rule.

## Why the improvements list is load-bearing (Phase 2.5)

Without a written improvements list, *"make it better"* has no claim
the agent can defend, and each variant ends up inventing its own
"better" — producing rebrand-shaped output even with Mode A active.
The list is descriptive of the gap between the existing site and a
competent 2026 execution of the same brand, not prescriptive of
visual targets. Genuine empty-list cases occur when the captured
site is already at a high execution level on observable dimensions —
the honest answer is a reduced-scope proposal, not rationalised
filler items.

## Why the variant role contract replaced per-slot seed rolls

The previous multi-variant default (each variant rolls a fresh
divergence seed with anchor references picked per slot) produced
what the internal review called *"three rebrands"* output: each
variant was defensible standalone but none felt like the same brand.
Role differentiation (faithful + improvements / trait X amplified /
trait Y amplified) binds every variant to the captured surface.

## Where the C-cliff name comes from

The observed pattern where a 3-variant fork has A defensible, B
defensible, and C reading as *"unprofessional"* rather than *"a
third proposition."* The fix is not to soften C — it is to define C
against a captured trait instead of against B.
