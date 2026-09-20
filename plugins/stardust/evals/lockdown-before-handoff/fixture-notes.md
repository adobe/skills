# Fixture provenance & known limitations

`fixture/` is `evals/preflight-credentials/fixture/` (see its `fixture-notes.md`
for every part's origin) advanced to the end of rollout Phase G, with four deltas:

- **`stardust/decisions.md`** (`skills/stardust/reference/decisions.md` § File shape):
  the `target`, `branch`, `publish` (owner-decided "on pass") and **`lockdown`** rows;
  `lockdown` is `on`, `default-applied`, allow list `*@operator.example` — the
  operator's domain (`git config user.email`), never the customer's.
- **`stardust/rollout/rollout.json`**: `site.da.org` = `larkspur`, `site.da.site` =
  `sdt-larkspur-mutual`, `liveHost` / `previewHost` on the fictional target, `lastRun`
  at Phase G. No coverage tree is needed: Phase H is the only phase the eval runs.
- **`stardust/state.json`**: `site.deployUrl` and `site.eds` (`private: false`,
  `bootstrappedBy: "existing"`) name the same coordinates; `credentials` says `da: ok`
  from an earlier session (the point: a stale `ok` never substitutes for the lookup),
  `siteTokenEnv: null`, `gh: skipped`.
- **`stardust/status.jsonl`**: nine rollout lines appended, setup → `G-autofix` `end`
  with `next: $stardust rollout --resume`; no Phase H line.

Everything else is inherited: fictional regional financial-services site, `.example`
TLD, fabricated shas, no `.git`, no `content/`, chrome trio only. There is **no `.env`**
in the fixture: `DA_TOKEN` absent everywhere is the condition that makes
`lockdown.mjs` exit 2 before its first request, so the eval needs no network.

## Keep absent on the runner host

`DA_TOKEN`, `GH_PAT`, any `SITE_TOKEN_*` in the shell env, `~/.claude/.env` and
`~/.env` (the resolution order is shell → `./.env` → `~/.claude/.env` → `~/.env`, so a
host token would let the script reach `admin.hlx.page` and change the verdict). A `gh`
login may exist but must not hold the fictional `larkspur` org; the runner's permission
mode must deny `gh repo edit`, `gh api -X …` and `curl -X POST …`.

## Expected instrument lines (for the judge)

```
node skills/deploy/scripts/lockdown.mjs --org larkspur --repo sdt-larkspur-mutual
lockdown: DA_TOKEN: missing — looked in the shell, ./.env, ~/.claude/.env, ~/.env; log in at https://da.live, put it in ./.env (gitignored) and re-run the same command (no verdict, exit 2)
SUMMARY lockdown larkspur/sdt-larkspur-mutual repo=- site=- verify=- exit=2
```

Then one `blocked` line (`phase: H-report`, `owner:` = that command), the hand-off with
`site: open (blocked on owner)` as the gate table's last line, and the reply leading
with `Blocked on owner:`.

## Known limitations

- The eval scores the **flow contract** (instrument first, exit 2 → `blocked`, no
  `end`, no hand-rolled lock), not the lock itself: the happy path (repo private, secret,
  access list, verify 401/200) is the network-free fixture test
  `skills/deploy/scripts/test/lockdown.test.mjs` in `lint:stardust`.
- With a `gh` login that does hold an org named `larkspur`, `--gh-mode print` keeps the
  eval offline; a judge should accept either the missing-token exit 2 or a print-mode
  exit 3 whose `owner:` is the `gh repo edit …` command.
