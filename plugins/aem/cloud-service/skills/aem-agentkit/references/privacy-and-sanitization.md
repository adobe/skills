# Privacy deny-list and string sanitization

> **Beta Skill:** Outputs must be reviewed before applying to production.

This reference is the single source of truth for the skill's two
runtime safety contracts: which files the skill never reads, and how
extracted strings are sanitized before they land in a generated
artifact. [`SKILL.md`](../SKILL.md) § "What this skill never does" and
§ Rules summarize the contracts and link here for the exhaustive lists.

## 1. Privacy deny-list

Match is **case-insensitive on every platform** (so `Credentials.json`,
`SECRETS.txt`, and `.ENV` are denied). Globs use POSIX `/` separators.
**Fail closed**: when a path's classification is ambiguous, skip it,
emit a `warningStubs` entry, and never read on uncertainty.

### 1.1 Categories

| Category | Patterns |
|---|---|
| Cloud Manager scoped | `.cloudmanager/env*.json`, `.cloudmanager/secrets*` (only `.cloudmanager/java-version` is read) |
| Environment files | `.env`, `.env.*` |
| Generic credential / secret / token shapes | `**/credentials*`, `**/credential*`, `**/*creds*`, `**/*cred`, `**/*secret*`, `**/*secrets`, `**/*password*`, `**/*passwd*`, `**/*token*`, `**/api[-_]key*`, `**/apikey*`, `**/auth.json`, `**/auth-config*` |
| PKI / keystores | `**/*.pem`, `**/*.key`, `**/*.p12`, `**/*.pfx`, `**/*.p8`, `**/*.jks`, `**/*.jceks`, `**/*.keystore`, `**/*.truststore`, `**/keystore`, `**/truststore`, `**/*.p7b` |
| SSH keys | `**/id_rsa*`, `**/id_dsa*`, `**/id_ecdsa*`, `**/id_ed25519*`, `**/.ssh/**`, `**/*.ovpn` |
| Cloud SDK credentials | `**/.aws/**`, `**/.gcp/**`, `**/*.key.json` (covers GCP service-account JSONs; note that `*.key` does **not** glob-match `.key.json`), `**/.azure/**`, `**/.kube/**`, `**/kubeconfig` |
| Package registry / build secrets | `**/.npmrc`, `**/.yarnrc`, `**/.yarnrc.yml`, `**/.pypirc`, `**/.gem/credentials`, `**/.dockercfg`, `**/.docker/config.json`, `**/.m2/**/settings.xml`, `**/.m2/**/settings-security.xml` (denied by path alone to avoid the reading-to-classify bootstrap loop; project-local `pom.xml` and `settings.xml` outside `.m2/` are not denied), `**/.netrc`, `**/_netrc`, `**/.htpasswd` |
| Adobe IO / IMS | `**/.adobe-aio*`, `**/aio-config.json`, `**/*-private.pem`, `**/*ims*credentials*`, `**/serviceuser*key*` |
| IaC state / secret vars | `**/*.tfvars`, `**/*.tfstate`, `**/*.tfstate.backup`, `**/.terraform/**` |
| PGP / encrypted archives | `**/*.gpg`, `**/*.asc`, `**/*.kdbx`, `**/wallet.dat`, `**/.gnupg/**` |
| `.git/` (scoped exception) | Only `.git/HEAD` (top-of-tree branch) and `.git/refs/heads/*` (current SHA). `.git/config` is never read because it may contain `https://oauth2:<TOKEN>@…` URLs. |

### 1.2 Symlink hardening

Before opening any file:

1. Resolve canonical realpath.
2. Reject if the realpath escapes the workspace root.
3. Reject if the realpath matches any pattern above.
4. Reject if the walk has already visited that realpath (loop guard).
5. Open with `O_NOFOLLOW` (or platform equivalent: `FILE_FLAG_OPEN_REPARSE_POINT` on Windows, `O_NOFOLLOW_ANY` on macOS) and re-check the opened descriptor's canonical path before reading — closes the TOCTOU window between resolve and open.

Hard depth cap: 32 directories from the workspace root. Hard file-walk
cap: 100,000 files; on overflow, mark every index `truncated: true` and
emit a `warningStubs` entry (see
[`codified-context.md`](./codified-context.md) § Discovery scope).

## 2. String sanitization

Any string extracted from customer source (evidence-pointer line
snippets, `cq:title` values, Content Fragment model titles, taxonomy
node names, Java package names) and baked into a generated Markdown
file passes the following sanitization, in order:

1. **Length cap.** 80 characters maximum. Truncate with `…` suffix.
2. **Inline-code wrap.** Wrap the sanitized value in backticks so it
   cannot be parsed as instruction text by a downstream agent.
3. **Strip code points** from the exhaustive list below. A string with
   any code point in this list, post-strip, is **dropped** in favor of
   a TODO marker — never a partial value.

### 2.1 Code points to strip

- **Control characters:** U+0000 through U+001F **except** `\t` (U+0009).
- **Line / paragraph separators that escape inline-code wrap:** U+2028, U+2029.
- **Zero-width / invisible:** U+00AD (soft hyphen), U+180E (Mongolian vowel separator), U+200B – U+200F (zero-width set), U+2060 (word joiner), U+FEFF (zero-width no-break space / BOM).
- **Bidirectional / directional overrides:** U+061C (Arabic letter mark), U+202A – U+202E, U+2066 – U+2069.

### 2.2 Implementation roadmap

This rule is at the limit of what an LLM can execute deterministically
over arbitrary Unicode input. A future release will move sanitization
into a deterministic helper invoked from the skill (Python one-liner
over `unicodedata` plus the explicit code-point set above). Until then,
regenerate `glossary.md` only when content drifts and review TODO
markers after every run.

## 3. Where these contracts apply

- **Discovery scope** (`codified-context.md` § 1) — the deny-list is
  checked on every file the walk would open.
- **Per-module AGENTS.md generation** (`per-module-agents-md.md` § 5)
  — `.cloudmanager/java-version` is the only file inside `.cloudmanager/`
  that may be read, and its content is regex-validated before inlining.
- **Glossary / conventions / avoid / test-patterns extraction**
  (`codified-context.md` § 5 – § 8) — every extracted value passes the
  sanitization above before being written.
- **Error diagnostics** (`SKILL.md` § Rules "Diagnostic-path scrubbing")
  — error paths are always workspace-relative; absolute paths or `~/`
  are never emitted.

## 4. PII heuristics (glossary.md only)

In addition to the sanitization above, glossary values are filtered
through a deterministic PII heuristic — see
[`codified-context.md`](./codified-context.md) § 7. Static regex set, no
LLM judgement, fail-closed TODO fallback on any match.
