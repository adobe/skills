# Fixture: every cross-plugin cite form that must be flagged

1. `npx impeccable detect --json stardust/current/` — the npm form the installed skill does not ship.
2. Read impeccable's `reference/teach.md` for the interview (renamed to init.md in 4.x).
3. `<dir>/scripts/impeccable load-context` — a verb no launcher ever answered.
4. `$impeccable teach` — a command the registry does not list.
5. `scripts/command-metadata.json` and impeccable's `reference/init.md` resolve (not findings).
6. `npx impeccable detect --json` <!-- script-paths: ignore — hypothetical, must not be flagged -->
7. `npx impeccable frobnicate` — the npm form AND a verb no engine answers.
8. A span that wraps across a line break is still code: `$impeccable
   teach` must be flagged like line 6.
9. A stray ` backtick in prose about $impeccable teach is a literal, not an opener: the prose is not code,
   and `$impeccable frobnicate` on this next line is still the paragraph's cite.

Indented code blocks are code too:

    $impeccable teach --indented
