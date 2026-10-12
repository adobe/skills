# Harness smoke

`run.mjs` is the per-harness conformance smoke for the eight target harnesses
(`../../notes/harness-support-plan.md` § Definition of supported). It answers
one question per harness and release: does an authenticated session load
stardust and impeccable, run Setup, run stardust's scripts with Playwright
against a site, read a screenshot, and stop at a gate when nobody is there to
answer? It is not a quality eval; `../runner/` judges output quality on Claude
Code.

```bash
node evals/harness-smoke/run.mjs --harness <id>              # the eight checks
node evals/harness-smoke/run.mjs --harness <id> --golden a   # + golden path A (slow)
node evals/harness-smoke/run.mjs --harness <id> --checks listing,load
```

`<id>` is one of `claude`, `copilot`, `grok`, `opencode`, `cursor`, `codex`,
`antigravity`, `pi`. The harness CLI must be on PATH and signed in;
`SMOKE_MODEL` picks the model where the harness takes one.

## Checks

Each runs one headless prompt in a fresh workspace and is verified from the
workspace on disk wherever possible, not from the model's report.

| Check | Prompt | Passes when |
|---|---|---|
| `listing` | list every skill | all 16 stardust skills and `impeccable` are named |
| `load` | load stardust's `extract`, quote its first `##` heading | the heading matches the real `SKILL.md` |
| `setup` | run the master Setup only, unattended | `stardust/scripts/VERSION` = the checkout's version, scripts synced, preflight JSON written |
| `runtime` | (reads the setup's preflight) | node, playwright, chromium, localhost and outbound are `ok` in the harness's own shell |
| `capture` | run `crawl.mjs --max 1` on the fixture site | a screenshot lands under `stardust/current/assets/screenshots/` |
| `vision` | read `smoke-vision.png`, report what is painted | the answer has the painted token (never written to the workspace as text) |
| `gate` | `direct` on the direct-from-phrase fixture, no `--hands-off` | no `PRODUCT.md`/`DESIGN.md` written, and a `blocked` ledger line or a question |
| `golden-a` | extract → direct → prototype → diff, hands-off | 2 page records, target spec, a `-proposed.html`, `diff.json` |

The fixture site (`fixture/site/`) is served from the runner's process on
`127.0.0.1`, so `capture` also proves the harness's sandbox allows localhost.
`runtime` failures carry the preflight's fix for that harness.

## Layouts

`harnesses.mjs` holds one adapter per harness. **plugin** (Claude Code,
Copilot CLI): the session loads this checkout with `--plugin-dir`; impeccable
comes from the user's install, and Claude Code disables the marketplace
stardust for the session. **loose** (Grok, OpenCode, Cursor, Codex,
Antigravity, Pi): the workspace gets what `npx skills add --copy` writes —
the sixteen skills under the harness's project skills dir — plus impeccable's
build for that harness from an impeccable checkout (`--impeccable-repo`,
default `../impeccable` beside this repository). An adapter marked
`verified: false` follows vendor docs; its first real run fixes the command
line.

Codex: the default run measures `workspace-write` with network on;
`SMOKE_CODEX_SANDBOX=danger-full-access` measures the documented escalation
for Playwright.

## Results

`results/<stamp>-<id>/log.md` (gitignored) holds every prompt, output tail and
verdict. Workspaces are removed when every check passes (`--keep` keeps them).
Paste the summary line into `RECORDED.md` when a run is release evidence, and
update the README's Verified-on table.
