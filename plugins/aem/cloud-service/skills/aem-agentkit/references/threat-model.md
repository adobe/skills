# Threat model and trust boundaries

> **Beta Skill:** Outputs must be reviewed before applying to production.

The skill operates inside a developer's workspace with the privileges of
the developer's user account. It reads files in the customer repo and
writes a bounded set of agent-context files. This reference enumerates
the trust boundaries the helper defends, and the boundaries that are
explicitly out of scope.

## 1. Defended trust boundaries

| Asset | Defended against | Mechanism |
|---|---|---|
| Customer source files / human-curated files | Accidental modification | Allow-list (helper-enforced in `write-atomic`) **plus** helper-enforced overwrite protection: `write-atomic`'s `_is_skill_owned` check ([`helpers.md`](./helpers.md) § 2.5 step 7) refuses to overwrite any pre-existing human-curated file unless the caller passes `allowOverwriteHumanCurated: true` (default `false`). Marker recomputation is the ownership test; this is enforced in the helper, not just orchestrator convention. |
| Privacy-sensitive files (`.env`, `*.pem`, `.aws/`, `.git/config`) | Indexing into LLM context | Deny-list per path segment, ASCII casefold + NFC normalize, applied at both walk-name AND resolved-realpath segments ([`privacy-and-sanitization.md`](./privacy-and-sanitization.md) § 1). |
| Filesystem outside workspace | Reading or writing via symlink | Workspace realpath cached at startup; in-workspace symlinks pointing outside are rejected; special filesystems (`/proc`, `/sys`, `/dev`, `/var/run`, `/run`, macOS `/private/var/run`) rejected even when the workspace lives inside them. |
| TOCTOU on read | Reading a swapped file | `O_NOFOLLOW` + post-open re-check (Linux `/proc/self/fd/N`; macOS `F_GETPATH`); fail-closed when re-check is unavailable. |
| Marker spoofing | Pasting our marker into a customer file | SHA-256 over canonical body bytes is recomputed on every "is this ours?" check; mismatch → human-curated → never overwritten. |
| Concurrent invocations | Racing on `.tmp` files | Advisory `fcntl.flock(LOCK_EX\|LOCK_NB)`; the kernel auto-releases the lock when the helper process exits or is killed (crash-safe) — no PID-reuse defense or stale-lock recovery needed. |

## 2. Explicitly out of scope

- **Prompt injection via raw file content — mitigated for dangerous Unicode; NL injection residual.** The helper provides a `read-for-context` op ([`helpers.md`](./helpers.md) § 2 — `read-for-context`) that runs the same safe-open path as `open`, then NFC-normalizes and removes dangerous Unicode code points (bidi overrides U+202A–U+202E / U+2066–U+2069, zero-width marks, BOM U+FEFF, C0/C1 controls except LF/CR) before the bytes enter LLM context. The orchestrator **MUST** read customer source via `read-for-context`, not raw `open`, when the content will be placed into agent context. Residual: natural-language prompt injection (e.g. literal "ignore previous instructions" prose) survives Unicode sanitization — returned content must still be treated as untrusted and the orchestrator must apply appropriate framing.
- **Supply-chain tampering with the helper binary.** The helper's content-addressable SHA-256 pin is documented in [`upgrade-and-migration.md`](./upgrade-and-migration.md) § 1.1 and baked into the release notes. A plugin marketplace replacement of the helper would be detected only by that pin, not by any in-skill mechanism.
- **Adversarial Windows hosts.** Windows is rejected at startup; no hardening claims apply on that platform. Use WSL.
