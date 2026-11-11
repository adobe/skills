# Split Sections: Section A/B (contract section 6a)

`Personalization Source | split` runs an A/B(/n) test on one section. Each visitor is assigned
either the authored content, which is the **control**, or one of the variants. The visitor keeps
that assignment for the browser session.

```
| Section Metadata          |                                               |
| Personalization           | hero-message                                  |
| Personalization Source    | split                                         |
| Personalization Variants  | /fragments/personalization/hero-message/speed |
|                           | /fragments/personalization/hero-message/team  |
| Personalization Split     | 40, 30          (optional)                    |
```

## Weights

- `Personalization Split` gives the percentage of visitors per variant, in Variants order. The
  default gets the rest. `40, 30` gives speed 40 %, team 30 %, default 30 %. `0, 100` sends
  everyone to `team` (a rollout).
- Without the row, the split is even across the default and every variant.
- Values may carry `%`. More values than variants, a total over 100, or a value that isn't a
  number is an error. A split section has no Rule rows.

## Assignment

- The draw takes a number in [0, 1) (`drawSplit` in `section-spec.js`), so the boundaries are
  tested exactly. For `40, 30`:
  - [0, 0.4) gives the first variant;
  - [0.4, 0.7) gives the second;
  - [0.7, 1) gives the default.
- **Storage.** The first view in a session draws. The result is kept in sessionStorage
  (`pzn-split:<id>`) and in the session cookie `pzn-split=<id>:<arm>,…` (`Path=/; SameSite=Lax;
  Secure`), so new tabs and the edge agree. A variant that is no longer listed is drawn again.
- **Consent is needed**, because the assignment is stored. Without it the visitor sees the default
  and isn't assigned (outcome `no-consent`, never `control`). Only the approved `split` exception
  changes this (`consent.md`).
- Bots are never assigned and nothing is stored for them.
- `?pzn=hero-message:team` forces an arm on preview hosts without assigning it.

## Edge

The edge decides split sections with the same code. It reads the `pzn-split` cookie, or draws and
sets it with `Set-Cookie`, then applies the arm in the HTML (`data-pzn-where="edge"`). It does this
only with the consent cookie or the `split` exception. Nothing is hidden and nothing flickers, so
a split on the first section belongs at the edge.

## Reporting

- **Events.** `pzn:decided` and `pzn:applied` carry `outcome` `variant` or `control` and
  `test: { type: "split", weights: [40, 30] | "even" }`, on every view where measurement is
  allowed. The A/B population is every visitor assigned to an arm, failures included
  (`decisions-and-measurement.md`).
- **RUM.** On successful application, the RUM `experiment` checkpoint
  `{ source: <id>, target: <arm> }`, the checkpoint AEM Experimentation uses.
- **Results.** The site team reads them (Analytics through the data layer for the full population,
  RUM for the applied view) and picks the winner. The skill computes no statistics.

## Split, Target or AEM Experimentation

- `split` tests one section, with fragments as variants.
- Target A/B (`target.md`) is for when Target should assign visitors and report.
- AEM Experimentation covers page-level experiments. A page that runs one (`Experiment` or
  `Campaign` page metadata) gets no personalized sections, and a section can't carry both: the
  validator rejects either case.

## Tests

- `npm test` checks the boundaries with fixed numbers.
- `validate-placeholders.mjs` prints the split it read.
- `simulate.mjs` lists the arms the weights allow (`allowed`).
- `verify-preview.mjs --split-runs 30` checks the following:
  - the arm stays the same across reloads and a new tab;
  - it is an allowed arm;
  - bots and visitors without consent are not assigned;
  - over 30 fresh visitors, every allowed arm appears and no excluded arm does. This random draw
    is a smoke check, not proof of the weights.
