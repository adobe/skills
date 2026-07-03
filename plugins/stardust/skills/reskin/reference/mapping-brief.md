# The mapping brief — contract

`stardust/reskin/mapping.md` is the decision record between the two
captures: every content slot from the content model assigned to a
donor module from the enumerated vocabulary. It is authored in
Phase 3, **before any rendering**, and it gates rendering: a page
whose brief fails the bars below is not rendered.

The brief exists because the alternative — deciding layout slot by
slot mid-render — is where silent improvisation happens. The
validation experiment (H5) showed every mapping decision is decidable
from the two artifacts alone: slot anatomy
(`content-model/<slug>/content-model.json`) vs module anatomy
(`stardust/reskin/donor-modules.md`). No render context needed, no
judgment arbitrary enough to require a human.

## Entry schema

One table row (or block) per slot, for **every** slot in the content
model — no slot may be absent from the brief:

| Field | Contract |
|---|---|
| `#` / slot id | The content-model slot (`s01`), or split sub-slot (`s07-news`, `s07-events`) |
| Content | One-line anatomy: what the slot carries (eyebrow / h-level / body / CTAs / media) |
| Donor module | A module id from `donor-modules.md` (`M4`), or `—` for new-module |
| Rationale | One line grounding the assignment: slot anatomy vs module anatomy |
| Status | `mapped` \| `new-module` \| `chrome` \| `carried-invisible` |

Plus a **Stats** block (mapped ratio, new-modules list), a **Deltas**
block (chrome swaps + the normalization ledger entries), and a
**Judgment calls** list. See the worked example that validated this
contract: the experiment's mapping of 12 slots onto a 16-module donor
vocabulary at 91% mapped, 1 new-module, 1 chrome swap.

## Status semantics and gates

- **`mapped`** — the slot renders as a named donor module, possibly
  with a *module transformation* noted in the rationale (e.g.
  carousel slides → static card grid when the donor has no carousel
  vocabulary — a layout decision, **not** a content delta; the
  slides' text and images are all carried).
- **`new-module`** — the donor vocabulary has no module for this
  anatomy (the experiment's case: a search form on a donor with no
  search anywhere). Requirements:
  1. The entry **names the donor tokens it composes** — input spec,
     primary button spec, radii, spacing. A new module is donor
     vocabulary recombined, never a third design system.
  2. It appears in the Stats block's explicit new-modules list.
  3. Nothing is ever improvised mid-render: a renderer needing a
     module the brief doesn't grant stops, and the brief is amended
     first.
- **`chrome`** — nav / footer swapped for donor chrome carrying the
  source's links (labels and destinations preserved — the
  `../../migrate/reference/content-preservation.md` rules apply to
  chrome too). Chrome slots are **excluded from the content-gate
  scope** and each swap is a documented delta (`D1`, `D2`, …) in the
  Deltas block.
- **`carried-invisible`** — non-visual content inside the byte
  scope: sr-only / visually-hidden a11y landmarks, skip-target
  headings. Real sites keep their only h1 here. None of the other
  statuses fit: it isn't `chrome` (it is inside the gate scope, so
  its bytes must survive), `mapped` is wrong (no donor module has an
  anatomy for invisible text), and `new-module` is wrong (a
  new-module entry must compose donor tokens; this composes none).
  Contract: the slot is carried **verbatim into an equivalent
  visually-hidden element** (the rendered page's own sr-only
  utility), stays inside the content-gate scope, and adopts no donor
  tokens. Note the heading level carried — an sr-only h1 is still
  the page's h1.

**Gate: mapped ratio ≥ 80%** over content slots (`chrome` and
`carried-invisible` both excluded from the denominator — one is out
of scope, the other has no module to map to by definition). Below
80% the donor vocabulary doesn't cover this content — stop per
SKILL.md § Stop conditions: widen the donor capture (more donor
pages usually means more modules) or get explicit sign-off on a
larger new-module list. Do not lower the bar silently.

## Slot splitting

Section ≠ slot. When one captured slot holds two logical regions (the
experiment's single `fullwidth` div holding News *and* Events), split
it into sub-slots in the brief (`s07-news`, `s07-events`) so each
mapping decision is atomic. The split is a brief-level construct —
the content model is not edited — and slot-coverage still asserts the
parent slot's full text, so a split can't shed content.

## Casing / text-transform policy

Declare it once in the brief; it binds the renderer:

- Captured text is **rendered-case** (`innerText` reflects
  `text-transform` — see `reference/content-model.md`
  § Rendered-case text). The byte gate compares rendered text on
  both sides.
- The underlying text is never edited to change case. Casing is
  applied **via CSS `text-transform` only**, mirroring what the
  source rendered.
- When source casing and donor style collide (uppercase-tracked
  source eyebrows vs a donor's sentence-case eyebrows), **byte
  fidelity wins**: keep the rendered casing, adopt the donor's
  eyebrow color/weight/size tokens. Note the tension as a judgment
  call in the brief.

## Icon-ligature text

Icon fonts of the Material Symbols family put the ligature **name**
in the DOM as text — a source "more" link is literally
`chevron_right Read more` in `innerText`, so the ligature name is in
the content model, in the byte-gate reference, and (via the ordered
stream's `text` nodes) in whatever the renderer emits. Decide its
treatment in the brief, per ligature family, one of:

- **carry as text** (the default — byte fidelity): the renderer
  emits the ligature name in a marked span; without the icon font it
  renders as the literal word. Honest, gate-clean, ugly — name it as
  a judgment call and as the eyeball verdict's weak point if it
  shows;
- **carry + adopt the icon font**: same bytes, but the span sets the
  icon font family so the ligature renders as the glyph. Only if the
  font's license allows (same rule as donor fonts);
- **normalize it away**: a shared-ledger entry (`N*`) that strips
  the icon text nodes on the source side — then the renderer must
  not emit them either. This is a *content removal*, so it takes an
  explicit ledger entry with a why; never just edit the strings.

What is never allowed: silently dropping or rewording the ligature
text in the renderer — that is a byte-gate failure by construction
(`reference/gates.md` § Failure modes).

## Deltas block

The single audit surface for every deviation between the live source
page and the gated comparison:

- `D*` chrome swaps (what was swapped, what carries over, why it is
  out of gate scope);
- `N*` normalization ledger entries, copied from the page ledger
  (`stardust/reskin/normalize/<slug>.mjs`) — the brief cites them,
  the ledger executes them.

If a delta is not in this block, it does not exist: any other
source↔render difference is a gate failure, not a delta.

## Flag, don't fix

Source garbage discovered while mapping — broken JSON-LD URLs,
wrong-locale labels, duplicated links — is carried verbatim
(fidelity over repair) and **flagged** in the brief's judgment-calls
list for the human. Silently fixing it breaks the byte gate; silently
keeping it without a flag ships a known defect unreviewed.
