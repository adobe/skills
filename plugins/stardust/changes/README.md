# Change notes

A pull request does not edit `../CHANGELOG.md`. It adds one file here, named for what changed
(`gate-reads-schema.md`, lower-case words with dashes):

```markdown
# <the entry's title, without a version>

<the entry, as it should stand in the changelog>
```

The release puts every note into `CHANGELOG.md` as `## <version> — <title>` and removes the
file. Two pull requests that each add an entry at the top of `CHANGELOG.md` conflict; two new
files do not. `node scripts/check-changes.mjs` (CI) fails a pull request that edits
`CHANGELOG.md` or adds a note without a title or an entry.

When you merge `main` into an older branch that edited `CHANGELOG.md`: take `main`'s
`CHANGELOG.md` and move your entry into a note.
