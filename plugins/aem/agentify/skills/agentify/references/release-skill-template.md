---
name: release
description: >
  Execute the release process for this repository by following docs/release-process.md.
  Handles Maven (even/odd and semver), npm, and CI-managed (Jenkins / GitHub Actions) releases.
  Confirms with the user at every irreversible step. Trigger phrases: "cut a release",
  "release this repo", "run the release process", "do a release", "release version X".
tools: [Bash, Read, Edit, Glob, Grep]
---

# release Skill

Executes this repository's release process step by step, following `docs/release-process.md`
as the single source of truth. Confirms before every irreversible operation.

## Supporting Files

| File | Purpose | Load when |
|------|---------|-----------|
| [references/maven-release.md](references/maven-release.md) | Maven release plugin commands, even/odd versioning, troubleshooting | When the repo uses Maven. Path resolves to `skills/release/references/maven-release.md` in the target repo. |

---

## GLOBAL RULES

1. **Never run `mvn release:prepare` or `mvn release:perform` without explicit user confirmation.** These operations push commits and tags to remote — they cannot be undone without manual cleanup.
2. **Always show the exact commands before running them.** State: what the command does, what it will change, whether it can be reversed. Wait for the user to say yes.
3. **Never skip pre-release checks.** Tests must pass and there must be no unintended SNAPSHOT dependencies before proceeding.
4. **If `docs/release-process.md` does not exist**, stop and tell the user. Do not attempt to infer the release process from `pom.xml` alone.
5. **If a step fails**, stop immediately. Do not attempt rollback without user approval. Show the error and ask how to proceed.
6. **If the release doc specifies CI-managed release, use it.** When `docs/release-process.md` says that a Jenkinsfile or GitHub Actions workflow owns the release, follow that CI workflow and do not run manual Maven commands in parallel. If the doc is ambiguous or silent about this, inspect the CI configuration and ask the user which path (CI-managed vs manual) is canonical before proceeding.

---

## STEP 0 — Read the Release Process Doc

1. Verify `docs/release-process.md` exists:
   ```bash
   cat docs/release-process.md
   ```
   If it does not exist, stop and tell the user.

2. Read the file and identify:
   - Versioning strategy (even/odd, semver, or other)
   - Release method (manual Maven, Jenkins, GitHub Actions, npm)
   - Pre-release checklist items
   - Post-release verification steps

3. Determine the release version:
   - If the user provided a version as an argument (`$ARGUMENTS`), use it
   - Otherwise, read the current version from `pom.xml` / `package.json` and propose the next release version based on the versioning strategy
   - For even/odd: current `1.3.0-SNAPSHOT` → propose release `1.4.0`, next dev `1.5.0` (Maven appends `-SNAPSHOT` via `-DdevelopmentVersion`)
   - For semver: ask the user — PATCH, MINOR, or MAJOR bump?

4. Show the user:
   - Current version
   - Proposed release version
   - Proposed next development version
   - Release method to be used

   Ask: "Is this correct? Confirm to proceed."

   Do not continue until the user confirms.

---

## STEP 1 — Pre-Release Checks

Run every item from the "Pre-Release Checklist" in `docs/release-process.md`. At minimum:

```bash
# Verify tests pass
mvn verify -B          # Maven
# or: npm test         # Node.js

# Check for unintended SNAPSHOT dependencies (Maven only)
# Compute current version once, then filter it out (see references/maven-release.md § Pre-Release Commands)
CURRENT=$(mvn help:evaluate -Dexpression=project.version -q -DforceStdout)
SNAPSHOTS=$(mvn dependency:list | grep -F SNAPSHOT | grep -vF "$CURRENT" || true)
if [ -n "$SNAPSHOTS" ]; then
  echo "ERROR: Unintended SNAPSHOT dependencies found. Please remove them before releasing."
  echo "$SNAPSHOTS"
  exit 1
fi

# Verify working tree is clean
git status
```

Show the output. If any check fails, stop and report the failure — do not proceed.

If all checks pass, tell the user and ask for confirmation to proceed.

---

## STEP 2 — Execute the Release

Choose the correct path based on what `docs/release-process.md` says:

### Path A: CI-managed (Jenkins / GitHub Actions)

Show the user the CI trigger command or UI steps from the release doc. Ask for confirmation. Do not run anything automatically — guide the user through the steps.

Monitor the outcome. Move to STEP 3 once the CI release job completes successfully.

### Path B: Manual Maven

For detailed Maven commands, read **`$SKILL_DIR/references/maven-release.md`**.

Show the user the exact commands that will run:

```bash
mvn release:prepare -B \
  -DreleaseVersion=<RELEASE_VERSION> \
  -DdevelopmentVersion=<NEXT_DEV_VERSION>-SNAPSHOT   # <NEXT_DEV_VERSION> is base version only, e.g. 1.5.0

mvn release:perform -B
```

Ask: "Ready to run these commands? This will commit, tag, and push to remote."

Run only after explicit confirmation.

### Path C: npm

```bash
npm version <patch|minor|major>
npm publish
git push --follow-tags
```

Show the commands first. Ask for confirmation before running.

---

## STEP 3 — Post-Release Verification

Run every item from the "Post-Release Verification" section in `docs/release-process.md`. At minimum:

```bash
# Verify tag was pushed
# TAG_NAME is typically <artifactId>-<RELEASE_VERSION>; check <tagNameFormat> in pom.xml
git ls-remote --tags origin | grep <TAG_NAME>

# Verify current version is now the next SNAPSHOT (Maven)
mvn help:evaluate -Dexpression=project.version -q -DforceStdout
```

If a verification step fails, report it and stop. Do not mark the release as complete.

---

## STEP 4 — Post-Release Report

```
Release complete: <RELEASE_VERSION>

✅ Pre-release checks passed
✅ Release prepared and performed
✅ Tag pushed: refs/tags/<TAG_NAME>
✅ Current dev version: <NEXT_DEV_VERSION>-SNAPSHOT

Next steps:
- Update CHANGELOG.md with [Unreleased] section for next release
- Announce the release to the team
```

---

## Rollback

If the user asks to roll back after a failed release:

1. Read the "Rollback" section in `docs/release-process.md`
2. Show the rollback commands
3. Ask for explicit confirmation before running any of them
4. For Maven: see **`skills/release/references/maven-release.md` § Rollback**
