# Maven Release Reference

Detailed commands and troubleshooting for Maven releases using the Maven Release Plugin.

---

## Even/Odd Versioning (AEM Maven Convention)

| Phase | Version pattern | Example |
|-------|----------------|---------|
| Active development | `MAJOR.ODD.PATCH-SNAPSHOT` | `1.3.0-SNAPSHOT` |
| Release | `MAJOR.EVEN.PATCH` | `1.4.0` |
| Next dev cycle | `MAJOR.(ODD+2).PATCH-SNAPSHOT` | `1.5.0-SNAPSHOT` |

Rules:
- Odd minor = development (`-SNAPSHOT`)
- Even minor = released artifact (no `-SNAPSHOT`)
- Never release with an odd minor version
- Never have a `-SNAPSHOT` on an even minor version

**Common version progressions:**

```
1.3.0-SNAPSHOT  →  1.4.0  →  1.5.0-SNAPSHOT
2.1.4-SNAPSHOT  →  2.2.4  →  2.3.4-SNAPSHOT
3.7.0-SNAPSHOT  →  3.8.0  →  3.9.0-SNAPSHOT
```

---

## Pre-Release Commands

```bash
# 1. Verify clean working tree
git status

# 2. Verify tests pass
mvn verify -B

# 3. Check for unintended SNAPSHOT deps (exclude own project version)
CURRENT=$(mvn help:evaluate -Dexpression=project.version -q -DforceStdout)
SNAPSHOTS=$(mvn dependency:list | grep -F SNAPSHOT | grep -vF "$CURRENT" || true)
if [ -n "$SNAPSHOTS" ]; then
  echo "ERROR: Unintended SNAPSHOT dependencies found:"
  echo "$SNAPSHOTS"
  exit 1
fi

# 4. Dry-run: simulate prepare — makes local-only changes (release.properties, backup poms)
#    but does NOT commit or push; clean up with: rm -f release.properties pom.xml.releaseBackup
mvn release:prepare --dry-run -B \
  -DreleaseVersion=<RELEASE_VERSION> \
  -DdevelopmentVersion=<NEXT_DEV_VERSION>-SNAPSHOT   # <NEXT_DEV_VERSION> is base only, e.g. 1.5.0
```

---

## Release Prepare

Creates the release commit + tag and bumps `pom.xml` to the next SNAPSHOT version.

```bash
mvn release:prepare -B \
  -DreleaseVersion=<RELEASE_VERSION> \
  -DdevelopmentVersion=<NEXT_DEV_VERSION>-SNAPSHOT   # <NEXT_DEV_VERSION> is base only, e.g. 1.5.0
```

What this does:
1. Validates no SNAPSHOT dependencies
2. Changes `pom.xml` version to `<RELEASE_VERSION>`, commits and pushes
3. Tags the commit as `<TAG_NAME>` (default format: `<artifactId>-<RELEASE_VERSION>`; check `<tagNameFormat>` in root `pom.xml` if different)
4. Changes `pom.xml` version to `<NEXT_DEV_VERSION>-SNAPSHOT`, commits and pushes

**Multi-module note:** All modules are version-bumped in a single commit. Verify tag naming in the root `pom.xml` `<scm>` section.

---

## Release Perform

Checks out the tag, builds from it, and deploys to Nexus / Maven Central.

```bash
mvn release:perform -B
```

---

## Full Even/Odd Example

```bash
# Current: 1.3.0-SNAPSHOT → Release: 1.4.0 → Next dev: 1.5.0-SNAPSHOT

mvn release:prepare --dry-run -B \
  -DreleaseVersion=1.4.0 \
  -DdevelopmentVersion=1.5.0-SNAPSHOT

mvn release:prepare -B \
  -DreleaseVersion=1.4.0 \
  -DdevelopmentVersion=1.5.0-SNAPSHOT

mvn release:perform -B
```

---

## Rollback

Use only if `release:perform` has NOT yet deployed the artifact.

```bash
# Reverts pom.xml changes and deletes the local tag
mvn release:rollback

# Delete the remote tag if it was pushed
git push origin :refs/tags/<TAG_NAME>
```

If `release:rollback` fails (e.g. `release.properties` is missing):

```bash
git log --oneline -5    # find the commit before release:prepare started
git reset --hard <COMMIT_HASH>
git push --force-with-lease origin <BRANCH>
git push origin :refs/tags/<TAG_NAME>
```

---

## Troubleshooting

**`SCM operation failed`** — verify SSH keys or HTTPS credentials, and check `<scm>` in `pom.xml` matches `git remote -v`

**`You have local modifications`** — run `git status` and stash or commit the changes

**Stale `release.properties` from a previous failed run** — `rm release.properties`

**`Artifact already deployed`** — delete it from Nexus or bump the version

**`No SCM URL configured`** — add to root `pom.xml`:
```xml
<scm>
  <connection>scm:git:https://github.com/OWNER/REPO.git</connection>
  <developerConnection>scm:git:git@github.com:OWNER/REPO.git</developerConnection>
  <url>https://github.com/OWNER/REPO</url>
  <tag>HEAD</tag>
</scm>
```
