# Fixture: cross-plugin cite forms that resolve against a 4.3 layout

1. `"<state.json#impeccable.skillDir>/scripts/impeccable" detect --json stardust/current/` — launcher verb.
2. Read impeccable's `reference/init.md` and `reference/document.md` as format specs.
3. `<dir>/scripts/impeccable hooks list` then `$impeccable critique` and `$impeccable polish`.
4. The registry is `scripts/command-metadata.json`; the launcher `scripts/impeccable` ships beside it.
5. `"<dir>/scripts/impeccable" critique-storage` then `"<dir>/scripts/impeccable" live-poll` — verbs the install's own docs cite, absent from any hard-coded list.
6. Prose is not a cite: the launcher scripts/impeccable resolves the engine on first use, and $impeccable is the slash-command prefix — neither "resolves" nor "is" is a verb.
