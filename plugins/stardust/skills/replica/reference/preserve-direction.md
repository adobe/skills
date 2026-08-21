# Preserve direction (mechanical promotion + inconsistency register)

Replica's Phase 2. Replaces the creative direction step (`stardust:direct`)
with a mechanical promotion: **the captured current state becomes the target
spec, verbatim.** No divergence roll, no anchor, no Mode A/B, no craft
re-direction. The phase makes exactly zero creative decisions — validated
(H3, UC1-E1): a full replica run needed only measurement-policy calls, never
taste calls.

Why not `direct` at all: `direct` Mode A pins palette + typography but still
re-designs surface; `ia-fidelity: verbatim` freezes IA, not surface. Neither
mode expresses "the target is the current state". Until `direct` grows a
native preserve mode (a recorded round-2 candidate), replica owns this step.

## 1. Promotion contract

Two branches, keyed on one observable fact: does
`stardust/current/PRODUCT.md` exist? (`extract --prep` writes the
descriptive synthesis; a bounded `--single`/`--pages` run does not —
crawl.mjs alone writes only `pages/*.json`, screenshots, and
`_crawl-log.json`.) Never mix them: when the `--prep` artifacts exist,
promotion is verbatim and synthesis is forbidden.

### Full-prep branch — verbatim promotion (unchanged)

Copy, verbatim, byte-for-byte:

| From (descriptive, written by extract) | To (target spec, read by downstream) |
|---|---|
| `stardust/current/PRODUCT.md` | `PRODUCT.md` (project root) |
| `stardust/current/DESIGN.md`  | `DESIGN.md` |
| `stardust/current/DESIGN.json` | `DESIGN.json` |

Rules:

- **Verbatim means verbatim.** Do not "clean up", normalize, or fill gaps in
  the promoted files. A gap in the captured spec is a gap the recreation
  phase resolves from the source CSS (recreation-procedure.md), not
  something to invent at promotion time.
- **No per-variant files.** Replica has one target: the current state. Never
  write `DESIGN-A/B/C` files — their presence would trigger prototype's
  multi-variant machinery.
- **Refresh rule.** If extract re-runs (e.g. `--refresh <slug>` after a
  source-site change), re-promote. The promoted spec must never be older
  than `stardust/current/`.

### 1a. Bounded promotion branch (`--single` / `--pages` entry)

When `current/PRODUCT.md` / `DESIGN.md` / `DESIGN.json` are absent, there is
nothing to promote verbatim — and the verbatim rule must NOT be "satisfied"
by inventing prose that looks like an extract synthesis. Instead, replica
**synthesizes a minimal descriptive target spec** from the two sources the
bounded run already has:

- the single page's captured JSON (`current/pages/<slug>.json` — title,
  metadata, headings, content structure, `customProps`);
- the Phase-3 CSS lift (palette, type ramp, container model, button specs —
  exactly the values `recreation-procedure.md` § CSS lifting produces
  anyway; the spec records them, it never invents beyond them).

Write the three root files with that content, each carrying front-matter
provenance `bounded-single`:

```yaml
_provenance:
  writtenBy: stardust:replica
  mode: bounded-single
  synthesizedFrom:
    - stardust/current/pages/<slug>.json
    - <the Phase-3 lifted tokens file>
```

Rules:

- **Descriptive, not creative.** Every value in the synthesized spec traces
  to the captured JSON or a lifted CSS value. A value with no source is a
  fidelity bug, exactly as in recreation.
- **Minimal means minimal.** The spec covers what the single archetype
  needs (palette, type ramp, container, buttons, the page's own structure);
  it does not speculate about page types, module catalogs, or site-wide
  voice — those are `--prep` products.
- **`direction.md` records the branch** (see § 2): downstream skills and a
  later site-scope re-run must be able to tell a `bounded-single` spec from
  a promoted one. When the pilot grows to site scope and Phase 1 re-runs
  with `--prep`, the verbatim promotion REPLACES the synthesized spec.

## 2. `stardust/direction.md` — the preserve-mode record

Downstream skills use `direction.md`'s existence as "the direction step
happened". Write it with the standard provenance shape:

```markdown
---
_provenance:
  writtenBy: stardust:replica
  writtenAt: <ISO-8601>
  againstInput: <URL>
  readArtifacts:
    - stardust/current/PRODUCT.md
    - stardust/current/DESIGN.md
    - stardust/current/DESIGN.json
---

# Direction — preserve mode (same-design migration)

Mode: PRESERVE. The target spec is the captured current state of <URL>,
promoted verbatim (no direct invocation, no creative decisions).

Promoted: current/PRODUCT.md → PRODUCT.md · current/DESIGN.md → DESIGN.md ·
current/DESIGN.json → DESIGN.json (at <ISO-8601>).

Permitted deltas: ONLY the entries of stardust/replica/inconsistency-register.md
(<N> entries / empty — pure replica).

Fidelity: ia verbatim · design verbatim · content verbatim.
```

On the bounded branch (§ 1a), the `Promoted:` line instead reads
`Synthesized (bounded-single): current/pages/<slug>.json + Phase-3 CSS lift
→ PRODUCT.md · DESIGN.md · DESIGN.json (at <ISO-8601>)` and the register
statement is unchanged — the branch changes where the spec came from, never
what is allowed to diverge from it.

## 3. The inconsistency register

`stardust/replica/inconsistency-register.md` — the ONLY permitted design
deltas; the "almost" in almost-pixel-perfect. Everything not listed here is
frozen. The register exists so the improvement scope is an explicit,
reviewable artifact instead of a per-section judgment call during recreation.

**Sources (both optional):**

1. **`stardust:audit` design findings.** Run audit only when the user wants
   improvement candidates surfaced. Consume
   `stardust/audit/<domain-slug>/audit.json` design findings; each adopted
   finding becomes one register entry citing the finding ID. Adopt
   selectively — an audit finding is a *candidate*, not an automatic entry;
   the user (or hands-off policy: adopt none) decides.
2. **User-supplied items** (`--register <file>` or named in chat). Each must
   still be evidenced before it enters the register: capture the
   inconsistency (screenshot crop, measured values) first.

**Empty register = pure replica.** Valid, common, and the default when the
user asked only to re-platform. A valid empty register is the header plus
the freeze statement — this template, verbatim:

```markdown
# Inconsistency register — <site> replica

No entries — pure replica. Everything not listed here is frozen; any design
delta found by the gate is a defect, not an improvement.
```

### Entry schema

One entry per inconsistency. Every field is mandatory:

```markdown
## R-<nn> — <one-line title>

- **Evidence:** <captured proof: screenshot path / measured values /
  audit finding ID. e.g. "footer link color #7a7a7a on #333 = 2.6:1
  contrast (audit finding D-04; capture/crop-footer.png)">
- **Finding:** <what is inconsistent, in the site's own terms — an
  internal inconsistency or a defect, never a taste preference>
- **Minimal change:** <the smallest change that resolves it. e.g.
  "lift footer link color to #9e9e9e (4.5:1); no other footer change">
- **Status:** applied | deferred
- **Where:** <page types / sections affected>
```

Rules:

- **Findings are inconsistencies, not preferences.** "The two card grids use
  different gutters (24px vs 28px) with no responsive cause" qualifies.
  "The hero would look better with more whitespace" does not — that is a
  redesign item; refuse it or send the user to the core pipeline.
- **Minimal change only.** The change resolves the named inconsistency and
  nothing else. If resolving it forces a second change, that second change
  is its own entry.
- **`applied` vs `deferred`:** `applied` entries are exempted zones in the
  source-fidelity gate — the expected delta is documented per entry so a
  gate flag over that zone is *justified*, not a defect. `deferred` entries
  change nothing in this run; they ride along as a handover list.
- **The register is append-only during recreation.** A new inconsistency
  discovered mid-recreation gets an entry (usually `deferred`) — it never
  gets silently fixed.

### Gate interaction

Each `applied` entry adds one expected, bounded delta. When a gate probe
flags inside an applied entry's zone, cross-reference the entry ID in the
gate log and mark the flag justified. When the pixel diff in that zone
exceeds what the minimal change explains, the entry leaked — the recreation
changed more than registered; fix the leak, not the register.
