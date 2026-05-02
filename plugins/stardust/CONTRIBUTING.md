# Contributing to the stardust learning corpus

Welcome. You've been invited because someone trusts your eye for design,
and the stardust plugin needs that eye more than it needs another line
of code.

This doc is the floor: it tells you what stardust's learning corpus is,
what we're asking from you, and how to do your first capture and your
first critique. Plan to spend **15–20 minutes reading and trying it**.
After that you'll know whether this is for you.

> If you're here to contribute *code* (sub-skill changes, runtime
> behavior, the schema), that goes through normal PR review against
> this repo. This doc is specifically about contributing to the
> **learning corpus** — the human signal that makes stardust's design
> output less generic over time.

---

## What this is

Stardust generates redesigns of existing websites. Out of the box it's
fine. Left unattended, its proposals share a skeleton across unrelated
brands and differ mostly on color tokens. That's the failure mode the
**learning corpus** exists to fix.

The corpus has three parts:

- **Exemplars** — curated reference designs that demonstrate what
  "stunning" or "slop" looks like for a given brand territory.
- **Captures** — *"I saw something striking; here's the one-line note
  about why."* Frictionless contribution. They cluster into named
  *moves* over time.
- **Critiques** — designer judgments of stardust's own output. They
  catch failure modes and seed new exemplars.

Designers (you) submit captures and critiques. A **curator** (currently
the maintainer team — one or two people) clusters captures into named
moves, gets your signoff on the abstraction, and PRs them into the
moves catalog. A **lead designer** runs periodic audits to keep the
catalog from bloating with accidental defaults.

Read `plugins/stardust/design/learning-system.md` if you want the full
rationale. It's not required reading to contribute.

---

## What we're asking from you

In rough order of effort:

| activity                      | time per occurrence | frequency             |
|-------------------------------|---------------------|-----------------------|
| **Capture**                   | ~30 seconds         | whenever you see something striking (irregular) |
| **Quick critique**            | ~30 seconds         | per proposal in a critique session |
| **Qualified critique**        | ~5–10 minutes       | opt-in, when a proposal merits depth |
| **Comparative critique**      | ~2–5 minutes for a set | when reviewing multiple proposals together |
| **Conversation critique**     | ~30 minutes recorded | when you'd rather talk than write |
| **Signoff on a candidate**    | ~5 minutes          | when the curator abstracts captures *you* originated into a candidate move |

You're not committing to all of these. The minimum that makes you a
contributor is **one capture**.

---

## Your first capture (5 minutes)

A capture is the lowest-friction contribution: a source (URL, image,
Figma frame) plus one sentence about what's distinctive.

### Walkthrough

```
$ stardust capture --new-contributor
```

The `--new-contributor` flag walks you through your first capture
with a short explainer. Subsequent captures don't need it.

You'll be prompted for:

1. **A source.** A URL, file path, Figma frame ref, PDF, or video.
   Format is detected automatically. Example:
   `https://example-publisher.com/about`.
2. **One sentence.** *"What is this doing that's different?"* No
   tags, no axis, no verdict. Just the noticing. Example:
   *"the way the editorial sidebar competes with the main column
   instead of supporting it — feels deliberate, not accidental."*

Stardust writes a YAML file at
`<your-project>/stardust/captures/<timestamp>-<slug>.yaml`. That's
your capture. It now sits in the queue.

### What good captures look like

Three fictional examples to anchor expectations:

```yaml
# Good: specific, structural, locatable
source:
  kind: url
  ref:  https://example-publisher.com/about
sentence: "the way the editorial sidebar competes with the main
           column instead of supporting it — feels deliberate, not
           accidental"
```

```yaml
# Good: a strong negative observation
source:
  kind: image
  ref:  /Users/me/Downloads/regional-museum-home.png
sentence: "the kinetic typography on a museum site reads as a
           startup pitch deck cosplaying as institutional"
```

```yaml
# Less useful: too abstract; no underlying mechanism named
source:
  kind: url
  ref:  https://example-bakery.com
sentence: "feels nice and warm"
```

The third one isn't *wrong* — but it doesn't give the curator
anything to abstract. *"What about it is doing the warmth?"* would
be a better capture.

### What happens next

Your capture sits in the queue until a cluster of similar captures
forms (≥2–3 captures observing the same idea). Lone captures wait
for company — that's intentional. When a cluster forms, the curator
drafts a candidate move from it and asks you to sign off on the
abstraction. You either confirm or correct.

If your capture never finds a cluster, it stays in the queue
indefinitely as historical signal. It's not lost.

---

## Your first critique (15–30 minutes)

A critique is a judgment of a stardust-generated proposal. The corpus
needs critiques to learn which moves land and which don't, *for whom*.

There are four modes; you pick what fits your time and depth.

### Quick mode (~30 seconds per proposal)

Verdict (`stunning | strong | competent | slop`) plus 1–3 lines.
Default mode. Most session critiques are quick.

```yaml
# Fictional example: critiquing a stardust prototype of a publisher
verdict: competent
moves:   [layout/asymmetric-grid, type/editorial-serif-display, image/no-imagery]
brand_axes: [editorial, niche]
why:     "the typography is doing the work; layout is clean. but
          the asymmetric grid never collapses on mobile, which
          breaks the rhythm. competent because it survives, not
          because it wins."
critique_mode: quick
```

### Qualified mode (~5–10 minutes per proposal)

Use this for proposals that merit depth. Adds per-dimension
assessment, working/failing moves, a counterfactual ("this would be
stunning if..."), and your perspective ("editorial sensibility,"
"type designer," etc.).

```yaml
# Fictional example: a qualified critique of the same proposal
verdict: competent
moves:   [layout/asymmetric-grid, type/editorial-serif-display, image/no-imagery]
brand_axes: [editorial, niche]
critique_mode: qualified

per_dimension:
  layout:  "the asymmetric grid is right for the brand register but
            collapses to a single column on mobile, which kills the
            'authored voice' read."
  type:    "editorial-serif-display is doing the heavy lifting and
            doing it well."
  palette: "duotone is correct; the warm cream is one shade too
            cream — drifts toward 'archival default'."
  motion:  "still-but-precise is right; nothing to add."
  image:   "no-imagery commits, then the footer slips in two stock
            silhouettes that undermine the rest."
  tone:    "declarative is correct register but the welcome copy
            hedges."

working_moves:    [type/editorial-serif-display, image/no-imagery]
failing_moves:    [palette/duotone-high-contrast]   # too cream-default

counterfactual:   "would be stunning if the asymmetric grid stayed
                   asymmetric on mobile (stacked but offset, not
                   centered) and the palette dropped one stop on
                   the warm side toward stark cream."

anchor_read:      appropriate    # the cited anchor was the right choice
designer_context: "editorial / publishing sensibility; I read brand
                   voice as the load-bearing axis."

why:              "competent because the foundation is right.
                   misses stunning by 2–3 specific decisions, all
                   listed above."
```

### Comparative mode (~2–5 minutes for a set)

When you're reviewing 2+ proposals on the same page side-by-side.
Pairwise judgment is sharper than absolute. Don't write per-proposal
critiques — write one comparison.

```yaml
# Fictional example: comparing three variants of the same page
critique_mode: comparative
subject: [proposal-A, proposal-B, proposal-C]
ranking: [proposal-B, proposal-A, proposal-C]
differentiating_moves:
  - "B's editorial-serif-display + asymmetric-grid combo is what
     puts it ahead of A. A picks one, not both."
  - "C's full-bleed-cinematic is wrong for this brand register."
designer_context: "editorial / publishing sensibility"
why: "B commits to a design grammar; A is partial; C is performing
      a different brand."
```

### Conversation mode (~30 minutes recorded)

When you'd rather talk than write. Schedule a call with the curator,
record it (with consent), and the curator extracts critique entries
afterward for your signoff. Useful for senior designers whose ideas
land better in dialogue.

### Where critiques go

Today: write the YAML file under
`<your-project>/stardust/critiques/<session>-<n>.yaml`. To make it
part of the canonical corpus, open a PR adding it to
`plugins/stardust/exemplars/` (with `verdict` and `why` populated).

A `$stardust critique` sub-skill is on the roadmap to remove the
manual-YAML friction; until then this is the path.

---

## What happens to your contribution

Every contribution carries provenance: who submitted it, when, from
what session. Captures cite their submitter; promoted moves cite
their originating designer; exemplar entries cite their author.

When the curator runs a pass:

1. They cluster captures by underlying idea.
2. They draft candidate moves from clusters of ≥2.
3. **They contact you** if your captures originated a cluster, and
   ask you to sign off on the abstraction.
4. Once you sign off, the candidate is PR'd into the moves catalog
   (`plugins/stardust/skills/stardust/reference/divergence-toolkit.md`
   §1a) with you cited.

You can read the full curator workflow in
`plugins/stardust/design/curator-pass.md` if you want to see what
the curator actually does.

---

## FAQ

**Why one sentence? Can't I add more context?**
Frictionless contribution is load-bearing for the system. Every field
we add to capture costs us contributions. If a thought needs more
than one sentence, it's not a capture — it's an exemplar entry, and
it goes through a different (slower) flow.

**What if my capture is similar to someone else's?**
Good. Two voices noticing the same thing is what produces a
candidate move. Lone captures wait for company; clusters of ≥2
become candidates. Your duplicate isn't redundant — it's
corroboration.

**What if a candidate I sign off on gets rejected later?**
The candidate stays in the queue with a note. Maybe it surfaces
again in a future cluster, or maybe it's quietly archived. Either
way, the original captures aren't lost.

**Do I get credit?**
Yes. Provenance fields (`added_by`, `originating_designer`,
`signed_off_by`) carry your handle. Promoted moves cite you. Audit
writeups attribute observations.

**Can I disagree with a move that's already in the catalog?**
Yes — submit a critique against a proposal that uses it (qualified
mode is the right vehicle). If multiple critiques converge on the
move being a slop default in disguise, the curator will surface it
for retirement at the next audit.

**How often is the curator pass run?**
Queue-driven, not on a calendar. When a cluster of captures hits
≥2–3 observations, the curator triggers a pass. Expect days to
weeks between passes early on; faster as the corpus matures.

**Can I see what's been promoted from my contributions?**
Yes. The catalog at
`plugins/stardust/skills/stardust/reference/divergence-toolkit.md`
§1a lists every move with `provenance.added_by` and
`provenance.captures[]`. Search for your handle to see your
contributions.

**Is there a way to talk to the curator directly?**
For now, open a GitHub issue against this repo with the `corpus`
label, or contact the maintainer team directly. A more structured
contributor channel may come later.

---

## Where to go from here

- `plugins/stardust/design/learning-system.md` — the full rationale
  for why the system exists and how it's structured.
- `plugins/stardust/design/curator-pass.md` — the curator's
  workflow (what happens after your capture lands).
- `plugins/stardust/design/house-style-audit.md` — the audit that
  prevents the catalog from bloating with defaults.
- `plugins/stardust/skills/stardust/reference/divergence-toolkit.md`
  §1a — the moves catalog itself.
- `plugins/stardust/exemplars/` — the canonical corpus you're
  helping grow.

---

Thank you for your time. Stardust gets less generic with every
capture, every critique, and every signed-off candidate — and the
whole point is that it gets there because of designers who actually
know what stunning looks like.
