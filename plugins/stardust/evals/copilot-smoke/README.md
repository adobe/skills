# Copilot smoke

`run.sh` is the recorded per-harness smoke for GitHub Copilot CLI. It answers
one question per release: can an authenticated Copilot session see, load and
set up stardust? It is not a quality eval; the runner under `../runner/`
does that on Claude Code.

Three checks, each a headless `copilot -p` call:

1. The skill list contains all fifteen stardust skills and `impeccable`.
2. `skill(extract)` loads by its bare name (Copilot CLI flattens plugin
   skill names; `stardust:extract` does not resolve there).
3. The `stardust` master skill's Setup section completes with impeccable
   found and no step failing on a missing file or command.

Run it against the installed marketplace copy, or against this checkout
with `--plugin-dir plugins/stardust`, which swaps the installed plugin for
the checkout and restores it afterwards. Logs land in `results/`
(gitignored). Paste the summary line into `RECORDED.md` when the run is
the release evidence.
