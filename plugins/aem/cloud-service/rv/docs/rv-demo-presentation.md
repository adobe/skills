---
marp: true
theme: default
paginate: true
size: 16:9
---

# RV — Render & Validate
### Do our migration skills actually work in the field?

**Today's demo: what's working, what's breaking, and where to focus next.**

---

## The Problem We Can't Answer Today

We know **how many times** a skill was installed.

We do **not** know:

- Did the fix the skill applied actually work?
- Did the customer's project build successfully after the fix?
- Did it deploy and run correctly on Cloud Service?
- Or did the customer just... stop halfway through?

**Install count tells us adoption. It tells us nothing about success.**

---

## Why This Matters

If a skill is silently failing for 30% of customers:

- We don't know **which skill**
- We don't know **which pattern** (scheduler? replication? dialogs?)
- We don't know **why** it's failing
- We don't know **where to spend engineering time next**

Without this signal, we're guessing. With it, we prioritize with data.

---

## The Flow, End to End

```
Customer project has an issue
         │
         ▼
  Migration skill applies a fix
         │
         ▼
  RV picks up what was fixed
         │
         ▼
  Spin up real AEM Cloud SDK
         │
         ▼
  Build the changed code
         │
         ▼
  Deploy to the SDK
```

---

## Then RV Actually Checks It

```
Deploy succeeded?
         │
   ┌─────┴─────┐
  Yes           No
   │             │
   ▼             ▼
 Verify it    Check WHY it failed
 actually
 works
```

Not "did it compile" — **is it Active, is it running, is the contract correct?**

---

## If It Doesn't Work — RV Doesn't Just Give Up

```
Attempt 1 fails
      │
      ▼
Check the failure reason
      │
      ▼
Retry (if the reason is transient — e.g. SDK still warming up)
      │
      ▼
Attempt 2, then Attempt 3
      │
      ▼
Still failing after 3 tries?
      │
      ▼
Send a clear signal back to us — with the reason
```

---

## How the Signal Reaches Us

**MCP is the pipe.**

```
RV finishes verifying
        │
        ▼
Skill calls the "report outcome" MCP tool
        │
        ▼
MCP tool sends it to our Cloud Adoption Service
        │
        ▼
Stored in our database — every attempt, pass or fail
```

Every verification — success or failure — becomes durable, queryable data.

---

## What We Capture, Every Time

| Field | Why it matters |
|---|---|
| Which pattern (scheduler, replication, dialogs...) | Know which fix type is failing |
| Pass or fail | The headline number we're missing today |
| Why it failed | Bundle didn't activate? Contract wrong? Build broke? |
| How many attempts it took | Distinguish "flaky SDK" from "broken fix" |
| Raw evidence (truncated) | Enough detail for us to actually debug it |

---

## Why This Changes How We Work

**Today:** "The scheduler skill has 400 installs." *(So what?)*

**With RV:** "The scheduler skill has 400 installs, 350 verified passing,
50 failing with the same root cause: a missing OSGi property."

**That's an actionable engineering ticket, not a vanity metric.**

---

## Proven Today — Not a Mockup

Ran live against a real AEM Cloud Service SDK:

- Took a real legacy scheduler class
- Applied the exact migration the skill would apply
- RV built it, deployed it, verified it — **passed**
- Broke it on purpose — RV caught the failure, explained why, reported it
- Every outcome landed in our database, ready to query

**This isn't a plan. It's working, end to end.**

---

## What We Get From Day One

Across every customer running this:

- **Real pass/fail rate** per migration pattern
- **Real failure reasons** — not guesses
- **Signal on where the skill needs work** — backed by field data, not opinion
- **A baseline** to measure improvement against, going forward

---

## Where We Focus Next

1. **Turn on the signal** — start collecting real field data
2. **Build the dashboard** — see pass rates per pattern at a glance
3. **Close the loop** — use failure patterns to fix the skills themselves
4. **Expand coverage** — more patterns, more verification depth

---

## Summary

We're moving from:

> *"We think the skill works."*

to:

> *"Here is the data that proves it works — and here's exactly
> what's broken where it doesn't."*

**That's the difference between shipping and knowing.**
