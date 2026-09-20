# Fixture provenance & known limitations

`fixture/` is a verbatim copy of `evals/preflight-credentials/fixture/` (see
its `fixture-notes.md` for every part's origin) plus one file: `.env`.

## The `.env`

- `DA_TOKEN` is a **synthetic, IMS-shaped token**: three dot-separated
  base64url segments whose middle segment is a JSON payload with
  `created_at` and `expires_in` as string milliseconds (`1758000000000` +
  `86400000` → expired 2025-09-17) and **no `exp` claim** — the shape real
  IMS tokens have and the reason a hand decode that reads `exp` returns
  nothing. Header and signature are placeholders; it authenticates nothing.
- `SITE_TOKEN_LARKSPUR_MUTUAL=placeholder` is a NAME for the slug match
  (`--site larkspur-mutual` → exact match; `SITE_TOKEN_LARKSPUR` would not).
- The plugin's `.gitignore` excludes `.env`; the fixture file is force-added
  (`git add -f`) because it is the point of the eval. Never put a real token
  in it.

## Keep absent on the runner host

`DA_TOKEN` in the shell env, `~/.claude/.env` and `~/.env` — the resolution
order is shell → `./.env` → `~/.claude/.env` → `~/.env`, so a host token
would win over the fixture's and change the verdict. `env -u DA_TOKEN` and a
temporary `HOME` are enough. No `.git` (see the parent fixture's notes).

## Expected instrument output (for the judge)

```
node skills/deploy/scripts/da-token-check.mjs --credentials --site larkspur-mutual --state stardust/state.json
DA_TOKEN: expired <N>h ago (source: repo-env) — refresh it in ./.env (log in at https://da.live) and re-run the same command
credentials: da=expired daSource=repo-env daExpiresAt=2025-09-17T05:20:00.000Z siteTokenEnv=SITE_TOKEN_LARKSPUR_MUTUAL gh=skipped
credentials → stardust/state.json
exit 2
```

Zero requests: with `--org --repo` the smoke is skipped because the decode
already proved expiry.
