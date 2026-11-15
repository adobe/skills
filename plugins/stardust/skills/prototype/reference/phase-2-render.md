# stardust:prototype: phase 2, render the proposed page

The text of this part of `skills/prototype/SKILL.md`, which keeps the heading and points here. "Above" and "below" refer to the order of the sections in that file.

### Phase 2 — Render the proposed page

Render `stardust/prototypes/<slug>-proposed.html` per
`reference/proposed-file-shell.md` § Required structure. Hard
requirements there:

- `:root` token block as the first content of the first `<style>`
  (per `skills/stardust/reference/token-contract.md`).
- Structural data attributes on every section (per
  `skills/stardust/reference/data-attributes.md`).
- Provenance block as the first child of `<head>`.
- Self-contained: no external CSS, no external JS.
- The site's favicon inlined in the head as a data: URI when
  `stardust/current/assets/favicon.<ext>` exists (per
  `reference/proposed-file-shell.md` § Hard requirements #8).
- Content preserved from the current page (hero copy, CTAs, nav,
  body) unless `direction.md` authorises content changes.
- **Content sourcing hierarchy** (`reference/proposed-file-shell.md`
  § Content sourcing hierarchy): every literal value rendered must
  come from `current/pages/<slug>.json`, then voice samples, then
  direction-authorised changes — or be rendered with the mandatory
  PLACEHOLDER visual signature. Stats, addresses, quotes, tax IDs,
  hours, prices, named-person words must never be invented. The
  proposed file's `_provenance.unsourcedContent[]` lists every
  placeholder so migrate can refuse to ship unverified content.

Delegate the heavy creative lift to `$impeccable craft`:

- Pass the page content and the resolved direction as the feature
  description.
- Reference DESIGN.md / DESIGN.json as the design system.
- Pass `direction.md` § Anti-references and § Divergence inputs as
  hard constraints (so craft does not silently veer off the resolved
  direction).
- Skip craft's "north star mock" generation step (direction.md is the
  brief). Skip craft's "shape" call (already done if Phase 1 needed
  it).

**Modern-web-guidance consult.** When the render implements
scroll-driven animation, view transitions, anchor positioning,
container queries, or perf-sensitive hero media, and the
`modern-web-guidance` plugin is installed, search it
(`npx -y modern-web-guidance@latest search "<query>"`) and follow
the retrieved guide; cite the guide id in
`_provenance.guidesConsulted[]`. Skip silently when the plugin is
absent.

After craft returns, validate the output:

- `:root` block present and complete (token-contract.md).
- Data attributes on every section (data-attributes.md).
- Anti-toolbox audit clean (each hit justified per divergence-toolkit.md
  § 1; record audit results in `DESIGN.json.extensions.divergence.anti_toolbox_hits`
  with the audit's amendments noted).
- Impeccable hard rules respected (OKLCH, type ratio ≥ 1.25, no
  reflex slop).
- **Content sourcing scan** — every literal value in the rendered
  output traces to one of the allowed sources
  (`reference/proposed-file-shell.md` § Content sourcing hierarchy).
  Any value that doesn't is either wrapped in a `[data-placeholder]`
  element with the mandatory visual signature, or the validation
  fails. Build the `_provenance.unsourcedContent[]` list during
  this scan.

If validation fails, do not write the file. Surface the failure to
the user with the specific rule violated and a suggested fix.

#### Craft-time disciplines (pre-write validators)

Four disciplines fire on the rendered file *before* it lands on
disk. These run after craft returns its output and before the file
is written; failure refuses the write with a substitute proposal
(Discipline 6) or a rule citation (7, 8), and Discipline 9 registers
detector ignores rather than refusing.

**Discipline 6 — Reflex-reject font pre-flight.** Grep the
declared `font-family` declarations against the reject list in
`skills/stardust/reference/divergence-toolkit.md` § Reflex-reject
fonts. If `≥ 3` reject-list families hit, refuse to write and
propose dimensionally-equivalent off-list substitutes from the
substitute table.

The check fires only on rendered files whose `font-family`
declarations the agent had freedom to pick. **Mode A renders with
captured display + body families pinned (per
`direct/SKILL.md` § Mode A — Brand-faithful mode) bypass the
check** — the inherited families are not a reflex choice. Record
the bypass reason in `_provenance.reflexRejectAudit.bypassed` with
the captured families named.

**Discipline 7 — Variable-font axis engagement.** When the resolved
direction's `expressive` or `distinctiveness` axes have moved past
their default (per
`skills/stardust/reference/intent-dimensions.md` §§ 2 + 5), engage
≥ 1 variable-font axis non-trivially per page using deck recipes
from the divergence toolkit. The toolkit's font decks expose named
axis recipes:

- `serif-luxury` deck → Fraunces axis recipe: `opsz 144, SOFT 100, WONK 1`
- `bauhaus-functional` deck → Bricolage axis recipe: `opsz 96, wght 600`
- `tactile-humanist` deck → Recursive axis recipe: `MONO 1, CRSV 0, CASL 0.5`

Static-weight static-style across all type on a page that claims
expressive or distinctive movement fails the check.

**Static-only-family precedence (friction carve-out #1).** Family
substitution rules when the captured/pinned display font does not
ship a variable axis:

1. If the captured/pinned display font is variable, engage its
   axes per deck recipes (standard path).
2. If the captured display font is **static-only by family**
   (Bellfort, GT Sectra static, hand-lettered custom cuts whose
   `woff2` files don't expose a parseable `fvar` table without
   runtime inspection), **exempt the display family** from the
   check and engage the **body family's axes** instead (typically
   `wght` and `ital` on a workhorse like Public Sans or Hanken
   Grotesk).
3. **Document** the family's static-only status in
   `DESIGN.json.extensions.divergence.font_deck.notes` so downstream
   pages don't re-run the check.

A pre-flight that blindly grep'd for `font-variation-settings`
would fire on every brand-faithful render of a static-only-display
brand. The exemption keeps the spirit of the discipline (engage
variable behavior where it exists) while honoring the letter when
the captured family literally has no axes to engage.

Off-deck accent fonts must ship with named **expressive positions**
(`marginal-tag`, `pointer-scribble`, `headline-callout`,
`badge-fill` — see toolkit § Font deck — expressive positions).
A face introduced without a position is a reflex pick, not an
expressive position.

**Discipline 8 — Fidelity tier (`--fidelity=quick|refined|production`).**

- `quick` (default) — sketch fidelity. Brief decisions land;
  micro-decisions stay provisional.
- `refined` — adds a craft micro-pass per
  `reference/fidelity-refined-pass.md`: formal type scale as CSS
  custom properties, `font-variant-numeric: tabular-nums` on inline
  digits, `text-wrap: balance` on headings + `text-wrap: pretty`
  on body + `hanging-punctuation: first` on `html`, sliding
  left-rule on nav hover, hairline hover on list items,
  kicker + title + baseline-aligned more-link section-head triplet,
  italic display couplet replacing structurally-vague `<b>`,
  bottom-of-sidebar reworked as typographic plate.
- `production` — `refined` + WCAG AA audit on every render + harden
  pass (loading states, error states, content-overflow edges).

The tier is declared in the run invocation; persisted in
`_provenance.fidelity`. Default is `quick`.

**Discipline 9 — Copy-cadence detector bypass under verbatim
fidelity.** This extends the Mode-A reasoning of Discipline 6 from
fonts to prose. impeccable's design detector ships prose-voice rules
(`em-dash-overuse`, `marketing-buzzword`, and similar copy-cadence
checks) that assume the copy is the agent's to rewrite. Under
`ia-fidelity: verbatim` — or any faithful/Mode-A render where the body
copy is `captured-verbatim` — that assumption is false by
construction: the prose is the source brand's, reproduced exactly per
the content-sourcing hierarchy, and rewriting it to satisfy a cadence
rule *is* the fabrication the fidelity setting exists to prevent. So
when the rendered file's copy classification is `captured-verbatim`
(per Discipline 5's `voiceClassification`), register those copy-cadence
rules as intentional ignores for the `<slug>-proposed.html` files
before the design hook fires — the same way Discipline 6 bypasses the
font reflex-reject check for pinned families. Scope the ignore to the
proposed files only, **never** to the project's own source (blocks,
styles, components), where the rules still apply because that copy
*is* the agent's. Record the bypass in
`_provenance.copyCadenceBypass` with the rules ignored and the
classification basis. A 2026-06-26 SaaS-site run hit this: the hook
flagged em-dashes and "enterprise-grade" on the site's own headings
("Built on Enterprise-Grade Components") under a verbatim direction,
and the only correct response was to leave the captured copy untouched
and record the bypass.

Bound the bypass: it covers prose-cadence rules only. Structural and
craft detector rules (`design-system-radius`, contrast failures,
reflex layout slop) are *not* exempted by verbatim fidelity — those
govern the agent's own CSS and structure, which faithful mode does not
freeze. Listing a rule under this bypass requires it be a copy-voice
rule whose subject is the captured prose.
