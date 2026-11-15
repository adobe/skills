# ledger.mjs names the readers for a guessed verb (#634)

- **`ledger.mjs summary` exits 2 with one line.** A guessed reader verb (`summary`, `status`, `show`)
  printed the writer's usage; it now prints `ledger: no \`summary\` command — use \`tail [-n 5]\` or
  \`last [<skill>]\`; page states: \`state.mjs summary\``. A known skill with too few arguments keeps
  the arity error. Pointer: `reference/run-status.md` "Reading progress" (0.39.1, #132) loses its
  "does not exist" sentence.
