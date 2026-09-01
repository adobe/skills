# The RV pattern rule — how to verify any migration

Every pattern is verified the same way: **two gates**. This is the template —
add a new pattern by filling in these two files.

## Gate 1 — Source (offline, no instance)
Read the migrated code, assert the Cloud-Service contract from that pattern's
`code-assessment/<pattern>/SKILL.md`.

- File: `invariants/<pattern>-source.js` → `check(src) → {result, checks, failure_class}`
- Registered in `verify.js` → `SOURCE_CHECKS`

## Gate 2 — Runtime (needs a Cloud SDK)
Prove the migrated behaviour actually works on a live instance, using one oracle:

> **trigger the behaviour → observe a repository / side-effect change**

- File: `invariants/<pattern>.js` → `check({probe, target}) → {result, checks}`
- Self-triggering patterns just observe; others need a small test trigger (servlet).

## The oracle per pattern (the rule, applied)

| Pattern | Source gate | Runtime trigger | Observable signal (proof) | Status |
|---|---|---|---|---|
| **scheduler** | ✅ | self-fires | job runs — marker/log advances | ✅ runtime-proven on Cloud SDK |
| **asset-manager** (delete) | ✅ | GET test servlet | node **gone** — `exists` 200 → 404 | ✅ runtime-proven on Cloud SDK |
| **replication** | ✅ | trigger distribution | content lands on target | source-proven · runtime template ready |
| **event-migration** | ✅ | fire an event | handler enqueues job / side-effect appears | source-proven · runtime template ready |
| asset-manager (create) | ✅ | upload | node **present** — 404 → 200 | source-proven · runtime template ready |
| resource-change-listener | — | change a resource | listener side-effect appears | template ready |

## Why this generalises
Both proven patterns reduce to the same shape:
1. put the system in a known state,
2. invoke the migrated code,
3. assert the expected repository/side-effect change.

That is the reusable rule — new patterns only supply *what to trigger* and
*what change to look for*. The runner, probe, outcome record, and fixture
generation are shared.
