# `:root` token contract

Every prototype and every migrated page renders against the project-root
`DESIGN.md` tokens, exposed as CSS custom properties on `:root`. The
contract below is the **interface** between stardust's renderers and
any downstream consumer (a future EDS skill, a framework component
library, a design handoff).

Carried from stardust v1 (design-guide.md) and aligned with
impeccable's DESIGN.md token names.

## The block

Every prototype's `<style>` block must start with a `:root` block
exposing the desktop tokens:

```css
:root {
  --heading-font-family: 'Brand Heading', serif;
  --body-font-family:    'Brand Body', sans-serif;

  --heading-xxl: 72px;
  --heading-xl:  56px;
  --heading-lg:  40px;
  --heading-md:  28px;
  --body:        18px;
  --body-sm:     15px;

  --line-height-heading: 1.1;
  --line-height-body:    1.55;

  --color-bg:     /* DESIGN.md colors.background */;
  --color-fg:     /* DESIGN.md colors.text-primary */;
  --color-accent: /* DESIGN.md colors.primary */;

  --spacing-xs:  4px;
  --spacing-sm:  8px;
  --spacing-md:  16px;
  --spacing-lg:  24px;
  --spacing-xl:  48px;
  --spacing-2xl: 96px;

  --section-padding: 96px;
  --max-width:       1200px;
  --radius:          8px;
}
```

The block above is the **minimum**. Pages may add more tokens (e.g.
`--shadow-card`, `--gradient-hero`) but every name above must be
present, with a value either inherited from DESIGN.md or computed
deterministically from a value that is.

## Sourcing the values from DESIGN.md

Every token in the block above maps back to a DESIGN.md frontmatter
key. The agent populates the `:root` block by reading `DESIGN.md` and
applying the mapping below.

| `:root` token              | DESIGN.md source                                      |
|----------------------------|-------------------------------------------------------|
| `--heading-font-family`    | `typography.<headingRole>.fontFamily`                 |
| `--body-font-family`       | `typography.<bodyRole>.fontFamily`                    |
| `--heading-xxl`...`--heading-md` | `typography.heading-*.fontSize` (or computed scale) |
| `--body`, `--body-sm`      | `typography.body.fontSize`, `typography.body-sm.fontSize` |
| `--line-height-heading`    | `typography.<headingRole>.lineHeight`                 |
| `--line-height-body`       | `typography.<bodyRole>.lineHeight`                    |
| `--color-bg`               | `colors.<background-role-name>`                       |
| `--color-fg`               | `colors.<text-primary-role-name>`                     |
| `--color-accent`           | `colors.<primary-role-name>`                          |
| `--spacing-xs`...`--spacing-2xl` | `spacing.xs`...`spacing.2xl` (Stitch keys)      |
| `--section-padding`        | `spacing.section` (or `spacing.2xl` if absent)        |
| `--max-width`              | DESIGN.json `extensions.breakpoints.containerMaxWidth` |
| `--radius`                 | `rounded.primary` (Stitch key)                        |

Color role names are **brand-native** per the divergence-toolkit § 4
rule. The agent references them by their actual role name in DESIGN.md
(`Pomodoro`, `Vault`, `Zenith`) when building the `:root` block, with
a comment showing the role name above the token.

## Why these names

The `--heading-*` / `--body-*` / `--color-*` / `--spacing-*` token
families predate impeccable's DESIGN.md format and are familiar to
designers across multiple Adobe-internal redesign projects. Stardust
preserves them for continuity. Impeccable's Stitch tokens
(`typography.heading-xxl.fontSize`, `colors.warm-ash-cream`,
`spacing.lg`) are the *source*; the `:root` block is the *interface*.

A future tool that wants to consume stardust's output reads the `:root`
block, not DESIGN.md, because the `:root` block is one stable
vocabulary across all prototypes and migrated pages.

## Per-section overrides

Local tokens may override the root for a single section:

```css
section[data-section="hero"] {
  --color-bg: var(--color-accent);   /* hero uses the accent as ground */
  --color-fg: var(--color-bg);       /* and the ground as text — read DESIGN.md to make sure this contrast passes */
}
```

Per-section overrides must respect impeccable's contrast rules (WCAG
AA min) and be reasoned in the prototype's provenance comment. They
are normal — the token contract is the **inheritance default**, not a
ceiling.

## Editability

Designs are rendered to be **edited in place** inside the prototype's
HTML file. When the user gives feedback during iteration:

- Change `:root` values for global tweaks (type scale, spacing,
  radius). Re-render and refresh.
- Change per-section style for local tweaks. Re-render and refresh.
- A change persists into DESIGN.md when the user approves the
  prototype (during the approval step, the agent diffs the prototype's
  `:root` against DESIGN.md and proposes patches; the user accepts or
  rejects per token).

## What this contract is **not**

- It is not the entire visual system. It is the **token interface**.
  Components, motion, breakpoints, and component-specific tokens live
  in DESIGN.md / DESIGN.json and feed the contract.
- It is not a framework choice. Tokens render fine in any framework
  that supports CSS custom properties (every modern one).
- It is not negotiable. A prototype without the `:root` block above
  is non-compliant; `prototype` refuses to mark such a page
  `prototyped`.

## Who reads, who writes

- **`prototype`** writes the `:root` block as the first child of the
  proposed page's `<style>`. Refuses without it.
- **`migrate`** writes the same block on every migrated page,
  re-derived from the latest DESIGN.md so token edits propagate.
- **`extract`** does not touch this block (extract describes the
  current site, which has its own arbitrary tokens).
- Downstream consumers (e.g., a future EDS skill) read the block from
  migrated pages as the canonical token interface.
