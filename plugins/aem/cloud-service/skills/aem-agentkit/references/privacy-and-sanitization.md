# Privacy deny-list and string sanitization

> **Beta Skill:** Outputs must be reviewed before applying to production.

This reference is the single source of truth for the skill's two
runtime safety contracts: which files the skill never reads, and how
extracted strings are sanitized before they land in a generated
artifact. [`SKILL.md`](../SKILL.md) § "What this skill never does" and
§ Rules summarize the contracts and link here for the exhaustive lists.
Every rule below is enforced by the deterministic helper documented in
[`helpers.md`](./helpers.md).

## 1. Privacy deny-list

Match is **case-insensitive on every platform** using the **ASCII
lowercase casefold** pinned in [`helpers.md`](./helpers.md) § 3 (so
`Credentials.json`, `SECRETS.txt`, and `.ENV` are denied without
depending on the platform's Unicode casefold). Globs use POSIX `/`
separators.

Matching is applied to **every path segment**, not only the file's leaf
name: a directory whose name (or whose realpath segment) matches a deny
pattern prunes the entire subtree from the walk. A path is denied if
**any** segment matches **any** pattern below.

**Fail closed:** when a path's classification is ambiguous, when
realpath resolution fails, when the resolved realpath contains `..`,
when an intermediate component is inaccessible (`EACCES`,
`ENOENT`-on-an-intermediate), or when the path crosses a rejected
special filesystem (see § 1.2), skip the path, emit a `warningStubs`
entry, and never read on uncertainty.

### 1.1 Categories

| Category | Patterns |
|---|---|
| Cloud Manager scoped | `.cloudmanager/env*.json`, `.cloudmanager/secrets*` (only `.cloudmanager/java-version` is read, with a 256-byte read cap and BOM strip) |
| Environment files | `.env`, `.env.*`, `**/*.env`, `**/*.env.*` |
| Generic credential / secret / token shapes | `**/credential*`, `**/credentials*`, `**/*creds*`, `**/*cred`, `**/*secret*`, `**/*secrets`, `**/*password*`, `**/*passwd*`, `**/*token*`, `**/api[-_]key*`, `**/apikey*`, `**/auth.json`, `**/auth-config*`, `**/auth-tokens*` |
| PKI / keystores | `**/*.pem`, `**/*.key`, `**/*.p12`, `**/*.pfx`, `**/*.p8`, `**/*.jks`, `**/*.jceks`, `**/*.keystore`, `**/*.truststore`, `**/keystore`, `**/truststore`, `**/*.p7b`, `**/*.crt` (private-key bundles), `**/*.csr` |
| SSH keys | `**/id_rsa*`, `**/id_dsa*`, `**/id_ecdsa*`, `**/id_ed25519*`, `**/.ssh/**`, `**/*.ovpn`, `**/.netrc.gpg` |
| Cloud SDK credentials | `**/.aws/**`, `**/aws-exports.js`, `**/.aws-sam/**`, `**/.gcp/**`, `**/*.key.json` (covers GCP service-account JSONs), `**/*-service-account*.json`, `**/*-firebase-adminsdk-*.json`, `**/firebase.json`, `**/.firebaserc`, `**/.azure/**`, `**/.kube/**`, `**/kubeconfig`, `**/.databricks-cfg`, `**/.snowflake/**`, `**/.dbt/profiles.yml` |
| Package registry / build secrets | `**/.npmrc`, `**/.yarnrc`, `**/.yarnrc.yml`, `**/.pypirc`, `**/.gem/credentials`, `**/.dockercfg`, `**/.docker/config.json`, `**/.m2/**/settings.xml`, `**/.m2/**/settings-security.xml` (denied by path alone to avoid the reading-to-classify bootstrap loop; project-local `pom.xml` and `settings.xml` outside `.m2/` are not denied), `**/.netrc`, `**/_netrc`, `**/.htpasswd`, `**/.config/composer/auth.json`, `**/composer-auth.json` |
| Adobe IO / IMS | `**/.adobe-aio*`, `**/.aio/**`, `**/aio-config.json`, `**/*-private.pem`, `**/*ims*credentials*`, `**/serviceuser*key*`, `**/.fbc/**`, `**/asset-compute-devtool/.env*` |
| IaC state / secret vars | `**/*.tfvars`, `**/*.tfstate`, `**/*.tfstate.backup`, `**/.terraform/**`, `**/*.pulumi.yaml` (with secrets), `**/*.sops.yaml` |
| Password managers | `**/.password-store/**`, `**/.config/op/**`, `**/.config/Bitwarden/**`, `**/.bitwardenrc` |
| PGP / encrypted archives | `**/*.gpg`, `**/*.asc`, `**/*.kdbx`, `**/wallet.dat`, `**/.gnupg/**`, `**/*.pgp` |
| IDE secret stores | `**/.idea/dataSources*.local.xml`, `**/.idea/sshConfigs.xml`, `**/.idea/webServers.xml`, `**/.idea/security*.xml`, `**/.vscode/sftp.json`, `**/.vscode/launch.local.json`, `**/.vscode/secrets*.json` |
| AEM SDK local state | `**/crx-quickstart/install/**`, `**/crx-quickstart/launchpad/config/**`, `**/crx-quickstart/repository/datastore/**`, `**/crx-quickstart/repository/version/**`, `**/crx-quickstart/repository/segmentstore/**` |
| Backup / swap artifacts | `**/*.bak`, `**/*.orig`, `**/*.swp`, `**/*.swo`, `**/.#*`, `**/*~`, `**/*.rej` |
| `.git/` (scoped exception) | Only `.git/HEAD` (top-of-tree branch) and `.git/refs/heads/*` (current SHA). `.git/config` is never read because it may contain `https://oauth2:<TOKEN>@…` URLs. |

In addition to the file patterns above, the walk **prunes** the
following directory names at every depth so they are never descended
into: `.git/`, `target/`, `node_modules/`, `dist/`, `build/`, `out/`,
`crx-quickstart/`, `.idea/`, `.vscode/` (except for the single
documented read of `.vscode/extensions.json`), `.terraform/`,
`.gnupg/`, `.ssh/`, `.aws/`, `.gcp/`, `.azure/`, `.kube/`, `.aio/`,
`.adobe-aio*/`, `.fbc/`, `.password-store/`, `.config/op/`,
`.config/Bitwarden/`, `.databricks-cfg/`, `.snowflake/`, `.dbt/`,
`.aws-sam/`, `.m2/`, `node_modules/`. This list is the source of
truth for the helper's `walk` operation; it composes with the
file-shaped patterns above so that a directory named `auth-tokens/`
prunes the whole subtree, not just its leaf file.

### 1.2 Symlink hardening and workspace boundary

Before opening any file:

1. Resolve the **workspace root**'s canonical realpath once at startup
   and cache the result for the lifetime of the run. On macOS this
   resolves prefixes like `/var/folders → /private/var/folders` so a
   workspace under one of these locations is compared correctly.
2. Resolve the candidate path's canonical realpath.
3. Reject when realpath resolution fails for any reason (broken
   symlink, `EACCES` on an intermediate component, `ENOENT` on an
   intermediate, returns a path containing `..`). Fail closed.
4. Reject if the realpath does not have the cached workspace realpath
   as its prefix (workspace-escape rejection).
5. Reject if any path segment of the resolved realpath matches any
   pattern in § 1.1 after ASCII lowercase casefold.
6. Reject if the resolved realpath traverses **any** of these special
   filesystems, even when the workspace root happens to live under one
   of these prefixes (the check looks at the realpath segments, not
   the workspace's parent):
   - `/proc/`, `/sys/`, `/dev/`, `/var/run/`, `/run/` on Linux / macOS.
   - `\\?\` device paths, `\\server\share\` UNC roots, `\\.\pipe\`,
     `\\.\Global*` on Windows.
7. Reject if the walk has already visited that realpath (visited-set
   loop guard) so a symlink chain that resolves into a previously seen
   subtree does not double-visit.
8. Open with `O_NOFOLLOW` on Linux, `O_NOFOLLOW_ANY` on macOS 11+
   (falling back to `openat2` with `RESOLVE_NO_SYMLINKS` on
   Linux 5.6+), `FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS`
   on Windows. Older platforms without the necessary flag are rejected
   at startup with the diagnostic `aem-agentkit: platform lacks the
   syscall surface needed for the symlink-hardening contract; aborting.`
   The skill never silently relaxes this rule.
9. Re-resolve the opened descriptor's canonical path and reject if it
   differs from the realpath resolved in step 2 — closes the TOCTOU
   window.

Hard depth cap: 32 directories from the workspace root. Hard global
file-walk cap: 100,000 files; per-immediate-child-of-root cap: 10,000
files; on any cap, mark every affected index `truncated: true`, list
the offending subtrees in `truncatedSubtrees`, emit a `warningStubs`
entry, and downstream slash commands (`/new-component`,
`/new-sling-model`) refuse to proceed on a `truncated: true` index
until the customer either narrows the workspace or raises the cap via
`.aem/agentkit-overrides.yml`. Silent half-completion is the failure
mode being blocked.

### 1.3 `_disable_agentkit` opt-out semantics

The `_disable_agentkit` opt-out is checked by `lstat`-by-name at the
workspace root and at each candidate nested AEM sub-project root. The
inode named `_disable_agentkit` is the **signal regardless of what it
points at**; the skill never dereferences a symlink with this name.
Reasoning: if the deny-list inside § 1.2 later rejected the realpath,
the customer's opt-out intent would be silently disregarded.

A regular file `_disable_agentkit` is constrained to `<= 1024 bytes`;
files larger than that are reported in `warningStubs` and **ignored**
(opt-out does not engage) to prevent an accidentally-committed large
binary from disabling the skill. A directory or empty file engages
opt-out immediately. Contents are ignored otherwise.

## 2. String sanitization

Any string extracted from customer source (evidence-pointer line
snippets, `cq:title` values, Content Fragment model titles, taxonomy
node names, Java package names) and baked into a generated Markdown
file passes the following sanitization, in order, executed by the
deterministic helper's `sanitize-string` operation (see
[`helpers.md`](./helpers.md) § 2.7):

1. **NFC normalize.** Idempotent normalization so equivalent code
   sequences hash identically.
2. **Drop on strip-list hit.** A string containing **any** code point
   in § 2.1 is **dropped** in favor of a TODO marker — partial
   sanitization is never returned. This guarantees no zero-width,
   bidi, or format characters can survive into a generated artifact.
3. **Length cap.** 80 characters maximum. Truncate with `…` suffix.
4. **Inline-code wrap.** Wrap the sanitized value in backticks so it
   cannot be parsed as instruction text by a downstream agent. When
   the value already contains backticks, escalate to the next-longer
   fence (` `` `, ` ``` `).
5. **Self-validate.** Re-scan the returned bytes for any strip-list
   code point. Any survivor (which would indicate a helper bug) drops
   the value.

The self-validation pass after step 12 of the generation order
re-scans every output Markdown file end-to-end for strip-list code
points; any survivor aborts the manifest write.

### 2.1 Code points to strip

- **Control characters:** U+0000 through U+001F **except** `\t` (U+0009).
- **Line / paragraph separators that escape inline-code wrap:** U+2028, U+2029.
- **Zero-width / invisible:** U+00AD (soft hyphen), U+180E (Mongolian vowel separator), U+200B – U+200F (zero-width set), U+2060 (word joiner), U+FEFF (zero-width no-break space / BOM), U+FFFD (replacement character — drops on detection because it indicates upstream decode failure).
- **Bidirectional / directional overrides:** U+061C (Arabic letter mark), U+202A – U+202E, U+2066 – U+2069.

## 2.2 What the helper does NOT sanitize automatically

The `sanitize-string` operation runs on string fragments the helper is
**told** to sanitize: extracted `cq:title` values, derived package
names, glossary terms, evidence pointer paths. It does NOT run on raw
file bytes returned by `op_open`. When the orchestrating LLM uses
`op_open` to read a customer file (Java source, HTL, `pom.xml`, README)
and places those bytes into LLM context, prompt-injection payloads in
the file are NOT filtered.

This is the **orchestrator's responsibility**. A malicious or tampered
customer repo can embed bidi-override, zero-width, or "ignore prior
instructions" tokens in Java comments, HTL files, or `pom.xml`
`<description>` fields; if the orchestrator passes those bytes
verbatim into agent context, the agent's behavior can be subverted.

Recommended orchestrator pattern (until a helper-side
`op_read_for_context` ships):

1. Read bytes via `op_open`.
2. Decode to a UTF-8 string.
3. Strip the same code-point set in § 2.1 from the decoded string.
4. Hard-cap the resulting text at a sensible size (e.g. 64 KB).
5. Wrap the result in a fenced code block before placing into LLM
   context.

This bracketing keeps customer file content as **data**, not as
instructions. The skill's own per-module `AGENTS.md` rules block
already advises agents to treat customer files as untrusted input.

## 3. Where these contracts apply

- **Discovery scope** (`codified-context.md` § 1) — the deny-list is
  checked on every file the walk would open, segment-by-segment,
  pruning matching directories before descent.
- **Per-module AGENTS.md generation** (`per-module-agents-md.md` § 5)
  — `.cloudmanager/java-version` is the only file inside `.cloudmanager/`
  that may be read. The helper enforces a 256-byte read cap and BOM
  strip; the value is regex-validated against `^(8|11|17|21|25)$`
  against the first whitespace-trimmed line before being inlined.
- **Glossary / conventions / avoid / test-patterns extraction**
  (`codified-context.md` § 5 – § 8) — every extracted value passes
  the sanitization above before being written.
- **Error diagnostics** (`SKILL.md` § Rules "Diagnostic-path scrubbing")
  — error paths are always workspace-relative; absolute paths or `~/`
  are never emitted.
- **Slash-command input** (`per-tool-artifacts.md` § 3.1) — every
  templated `<name>` and `<FQCN>` argument passes an anchored regex
  before any shell or filesystem interpolation. `MVN_CMD` is
  restricted to `{"mvn", "./mvnw"}` literally.

## 4. PII heuristics (glossary.md only)

In addition to the sanitization above, glossary values are filtered
through a deterministic PII heuristic — see
[`codified-context.md`](./codified-context.md) § 7. Static regex set, no
LLM judgement, fail-closed TODO fallback on any match. The full regex
set is the single source of truth in codified-context.md; the
heuristic covers provider-prefixed tokens (`AKIA*`, `ghp_*`, `gho_*`,
`ghs_*`, `xoxb-*`, `xoxp-*`, `sk_live_*`, `sk_test_*`, `pat_*`,
`AIza*`, `EAACEdEose0cBA*`), JWTs (`eyJ` + base64url segments), base64
blobs ≥ 40 chars, generic high-entropy tokens, IPv4 / IPv6 / IBAN /
postal / phone / email shapes, internal-domain URLs (`.corp.`,
`.internal.`, `.intranet.`), and human-name + date shapes.
