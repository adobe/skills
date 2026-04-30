# When to reach for each impeccable command

Stardust orchestrates the 23 impeccable commands. This file is the
runtime guide for picking which command fits a resolved direction.

**Source of truth.** The canonical command list is impeccable's own
`scripts/command-metadata.json`. Read it at runtime and treat it as
authoritative. The descriptions below are stardust's *redesign-flavored*
notes on **when** to reach for each — not what each command does
internally (impeccable's `reference/<command>.md` owns that).

If impeccable adds or renames a command, this file may lag — fall back
to `command-metadata.json` and the per-command reference.

---

## Build category

### `teach`
Reach for it: when stardust is about to write a target `PRODUCT.md` for
the first time. Use it inside `$stardust direct` to author the target
strategy file from the resolved direction. Do not invoke during a
freeform phrase if `PRODUCT.md` already exists — re-running silently
overwrites authored intent.

### `document`
Reach for it: when seeding the target `DESIGN.md` and `DESIGN.json` from
the extracted current state plus the resolved direction. Stardust calls
this from `$stardust direct` immediately after `teach` (or after manual
editing of `PRODUCT.md`). Also reach for it if the user asks for a
"design system snapshot" of either the current site or the proposed one.

### `shape`
Reach for it: whenever the user's intent moves the **expressive axis**,
**distinctiveness**, **tone**, or pins an **audience**. `shape` produces
the Design Brief that those moves need. Almost always the first build
command in an expressive redesign.

### `craft`
Reach for it: to actually build a redesigned page. Stardust's
`prototype` sub-command delegates here. Always preceded by `shape` if
the direction is at all expressive.

### `extract` (impeccable's, not stardust's)
Reach for it: only inside an existing redesigned site, when the user is
later consolidating shared patterns. Rare during a stardust-driven
redesign, common after migration when the new site is stabilising.

---

## Evaluate category

### `critique`
Reach for it: as the **first action of any "make it better" phrase**, and
as the **last verification step** before polish. Run it against
`stardust/current/` to score the existing site, and against a candidate
prototype to score the redesign. The output drives the priority of the
refine commands.

### `audit`
Reach for it: when constraints include `a11y-first` or `perf-first`, or
when the user's phrase mentions accessibility, performance, or
responsiveness. Independent of `critique` — they score different things.

---

## Refine category

### `polish`
Reach for it: as the **final step of every plan** unless the user is
mid-iteration on a single page. Polish presupposes a design system —
stardust ensures `DESIGN.md` exists before reaching for it.

### `bolder`
Reach for it: when the expressive axis moves *toward* `drenched` or
distinctiveness moves toward `distinctive`/`singular`. Stronger signal
than `craft` alone for amplifying.

### `quieter`
Reach for it: when the expressive axis moves *toward* `restrained`, or
when the user says "less", "calmer", "more refined".

### `distill`
Reach for it: when the user wants to *remove* something — "less
corporate", "less cluttered", "simpler". Pairs well with `quieter` for
restraint moves and with `bolder` for "remove the noise so the bold
moves land".

### `harden`
Reach for it: when constraints include `legacy-content-preserved`, when
the user mentions edge cases, error states, i18n, RTL, or when the
existing site has obvious data-volume problems (long names, wrapping
issues, empty states).

### `onboard`
Reach for it: when the redesign affects the first-run experience or
empty states. Often dropped from a redesign plan unless the user
specifically calls out onboarding.

---

## Enhance category

### `animate`
Reach for it: only when motion is part of the intent ("more dynamic",
"smoother", "feels alive"). Not a default move — animation reflexes
land in slop quickly.

### `colorize`
Reach for it: when the palette is part of the move. Either the existing
palette is wrong for the new direction, or the user explicitly mentions
color. Stardust's palette library (`direct/reference/palettes/`) feeds
this.

### `typeset`
Reach for it: whenever the expressive axis or tone moves. Type is the
single most expressive token in a redesign; almost always part of an
expressive plan.

### `layout`
Reach for it: when **density** moves, when the existing site has rhythm
problems, or when the redesign is structural rather than cosmetic.

### `delight`
Reach for it: rarely. Only when the user's intent explicitly calls for
personality or memorable touches *and* the design system can support it
without slop. Not a default move.

### `overdrive`
Reach for it: only when the user explicitly asks to push limits ("go
all-out", "make it a moment", "experimental"). Stardust will not
volunteer overdrive — too easy to over-deliver.

---

## Fix category

### `clarify`
Reach for it: when copy, labels, or error messages need work. Often part
of an a11y-driven plan; sometimes part of "less corporate" (corporate
tone often hides in the copy).

### `adapt`
Reach for it: when the redesign needs to land on a different device or
medium than the current site (e.g., the existing site is desktop-only and
the redesign needs mobile, or print-ready, or email).

### `optimize`
Reach for it: when constraints include `perf-first`, or when the audit
surfaces P0/P1 performance issues.

---

## Iterate category

### `live`
Reach for it: inside `$stardust prototype` for in-browser variant
exploration. Stardust delegates fully to `$impeccable live` — do not
reimplement.

---

## Common sequences

### "make it better" (no direction)
`critique` → `detect --json` → refine commands by P-level → `polish`.

### Expressive move (any direction)
`shape` → `bolder`/`quieter`/`distill` (pick by axis) → `typeset` →
`colorize` → `craft` → `critique` → `polish`.

### Constraint-driven (a11y / perf)
`audit` → `harden` (a11y) or `optimize` (perf) → `clarify` → `polish`.

### Anti-default ("modernise it", "less corporate")
`detect --json` → `shape` (anti-references = slop list) → `distill` →
`typeset` → `colorize` → `critique` → `polish`.

---

## What stardust does not call directly

- `pin` / `unpin` (impeccable management commands) — stardust uses its
  own sub-command surface.
- Standalone `live` outside a `prototype` context.

Everything else in `command-metadata.json` is fair game when the
resolved direction calls for it.
