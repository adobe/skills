---
marp: true
theme: default
paginate: true
size: 16:9
---

# RV — Render & Validate
### Verifying AEM Cloud Service Migrations End-to-End

*Closing the loop from "code compiles" to "verified on Cloud Service"*

---

## The Problem

Migration skills fix legacy AEM code for Cloud Service — but until now:

- We only knew the code **compiled**
- We never knew if it **actually worked** on a real Cloud SDK
- No record of what the skill got right or wrong in the field
- No way to improve the skill from real customer outcomes

**Question we couldn't answer:** *"Did this migration actually work?"*

---

## The Solution — RV

**Render & Validate**: a verification layer that

1. Boots/attaches a real AEM Cloud SDK
2. Builds + deploys the customer's migrated code
3. Checks the actual runtime state (not just "it compiled")
4. Records a structured outcome for every verification

**Two commands. One skill. One MCP tool. One database.**

---

## Customer Experience

Zero flags in the happy path:

```bash
rv-init                 # once per session
cd my/module
rv-check <pattern>       # per fix
```

In the IDE, even simpler — just ask:

> *"Verify my scheduler migration."*

The agent handles setup, verification, retries, and reporting — automatically.

---

## What Actually Gets Checked

Not just "did it compile" — **real OSGi runtime state**:

| Check | Example |
|---|---|
| Bundle state | Is it `Active` on the SDK? |
| Component state | Did the OSGi DS component activate? |
| Cloud Service contract | `scheduler.runOn`, `concurrent:Boolean`, etc. |
| Legacy API removal | No more `com.day.cq.dam.api` imports |
| Dialog markup | Coral 3, not Classic UI / Coral 2 |

---

## 5 Migration Patterns Verified Today

| Pattern | Verification |
|---|---|
| **scheduler** | Cloud Service scheduler contract (expression, concurrency, runOn) |
| **asset-manager** | Legacy DAM API removed, `ResourceResolver` used correctly |
| **event-migration** | `EventHandler` → `JobConsumer`, topic wired correctly |
| **replication** | `CQ Replicator` → `Sling Distribution API` |
| **legacy-ui** | Classic UI / Coral 2 dialogs → Coral 3 (offline check, no SDK) |

Adding a new pattern = ~30–50 lines. Framework is generic.

---

## The Full Loop

```
Customer's IDE
      │  "verify my migration"
      ▼
 RV Skill  →  rv-check  →  real AEM Cloud SDK
      │
      ▼
 MCP Tool (report-rv-outcome)
      │
      ▼
 Cloud Adoption Service  →  MongoDB (rv-outcomes)
```

Every verification — pass or fail — becomes durable, structured data.

---

## What We Capture on Failure

Not just "it failed" — **actionable evidence**:

- `failure_class` — frozen enum (build failed / bundle not active / contract mismatch / …)
- `bundle_state` / `component_state` — exact OSGi lifecycle state
- `unsatisfied_references` — which `@Reference` couldn't be wired
- `evidence` — the real error, truncated to 2 KB

The agent translates this into plain language for the customer —
never raw stack traces.

---

## Smart Retry Logic

The skill (not the code) decides what to retry:

| Failure type | Action |
|---|---|
| SDK unreachable, deploy timeout | **Retry** up to 3× with backoff |
| Contract mismatch, build error | **Don't retry** — it's a code issue |

Only **one** outcome is reported per verification — not one per retry attempt.
Clean telemetry, no noise.

---

## Real Proof — Not a Demo

Verified live against a real **AEM Cloud SDK 2026.8**:

- Migrated WKND's legacy `SimpleScheduledTask` (Felix SCR → OSGi DS)
- Built, deployed, verified — bundle + component both `Active`
- All 3 Cloud Service contract properties correct
- Outcome POSTed through MCP → persisted in MongoDB
- Fail path also verified (broken build → clean, honest failure record)
- Idempotency confirmed — no duplicate records on retry

---

## Engineering Discipline

Started as a 50-file research prototype. Reduced to:

| | Before | After |
|---|---|---|
| Customer-facing files | 50+ across 5 folders | **7 files** |
| Entry points | 6 competing commands | **2 commands** |
| Required flags (happy path) | Many | **0** |
| Telemetry | None | **Full MCP → DB loop** |

Every file that shipped serves the two customer commands. Nothing else.

---

## What This Enables Next

- **Skill mutation** — aggregate real failure data to auto-improve migration skills
- **Field pass-rate dashboards** — know which patterns work well in the wild
- **More patterns** — dispatcher, run-modes, filevault deps, custom templates
- **Content-package verification** — beyond bundles, verify full package deploys

---

## Summary

RV turns migration from *"I hope this works"* into
**"I proved this works, and here's the evidence."**

- Two commands, zero friction
- Real runtime verification, not just compilation
- Structured telemetry for every fix, pass or fail
- A foundation for making migration skills smarter over time

**Status:** Shipped — PR open for review.
