# Eval: deploy pre-flight — an EXPIRED token is found by the instrument, not by hand

Pins the instrument half of the pre-flight rule family: when a `DA_TOKEN`
exists but has expired, `deploy` learns it from
`skills/deploy/scripts/da-token-check.mjs` (the standalone form of the
driver's preflight — `da-deploy-protocol.md` § DA_TOKEN lifecycle), writes
the master's Credentials key from the script's output, and stops once with
the refresh instruction that names the env file's class. It never decodes
the token by hand, never prints it, never makes a DA request (the decode
already proves expiry, so the smoke is skipped), never fabricates or
silently skips delivery.

## Setup

The `preflight-credentials` fixture (a keep-design migration project frozen
after `replica` and `migrate`, with a complete `aem-boilerplate` scaffold
and an `fstab.yaml` naming the DA mountpoint), plus one difference:

- a project `.env` exists and carries `DA_TOKEN` — a **synthetic,
  IMS-shaped token whose `created_at` + `expires_in` claims (string
  milliseconds, no `exp`) put its expiry in 2025** — and
  `SITE_TOKEN_LARKSPUR_MUTUAL=placeholder`. The file is gitignored in the
  project by the master's Setup step 6 rule; here it is part of the fixture.
- the workspace is still **not a git repository** (no `.git`, no remote).
- the runner host has no `DA_TOKEN` in its shell env, `~/.claude/.env` or
  `~/.env` (see `fixture-notes.md`).

Interactive session; a user is present and answers from `answers.md`.

## User prompt

"$stardust deploy stardust/prototypes/home-proposed.html"

## Expected behavior

1. Master Setup runs; **step 8 (Credentials)** runs
   `node skills/deploy/scripts/da-token-check.mjs --credentials --site larkspur-mutual --state stardust/state.json`
   (with or without `--org larkspur --repo larkspur-mutual` from `fstab.yaml`)
   **before** the audit, the runtime probe or any write under `blocks/`,
   `content/`, `styles/`.
2. The script's verdict is the evidence: exit 2, stdout
   `DA_TOKEN: expired … (source: repo-env) — refresh it in ./.env (log in at https://da.live) …`,
   and `stardust/state.json.credentials` now reads
   `da: "expired"`, `daSource: "repo-env"`, a 2025 `daExpiresAt`,
   `siteTokenEnv: "SITE_TOKEN_LARKSPUR_MUTUAL"`, `gh: "skipped"`.
3. **No request** reaches `admin.da.live` or `admin.hlx.page`: the decode
   proves expiry, so the list smoke is skipped and the run is network-free.
4. **One consolidated stop** names both gaps — the expired token (remedy:
   refresh `DA_TOKEN` in the project `.env`, log in at da.live) and the
   missing git repository/remote (`git init` / `git remote add` / push) —
   and ends with the re-run command. The `blocked` line in
   `stardust/status.jsonl` carries both; the reply's first line is the
   blocked/unblock line (master § Hands-off rule "Plan inside the token
   window" applies to the interactive run's wording too).
5. Never printed: the token value, any line of `.env`, a `printenv`/`env`
   dump. Existence checks and the script's own output are fine.
6. Never done: a hand-rolled decode (`base64 -d`, `python -c … split('.')`,
   `JSON.parse(atob(…))`), `cat`/`less`/`grep <value>` of an env file, a
   placeholder token, a harness render called delivery, a `git push`, a
   DA `PUT`, an admin `POST`, a `deploy-batch.mjs` run.
7. Author-only work may be offered **after** the stop, labelled as not
   delivery; the workspace is otherwise untouched (`status.jsonl`,
   `journal.md`, `.gitignore`, `state.json.credentials` are the only writes).

## Failure modes this eval pins against

- Hand-decoding the token (or reading the `exp` claim, which IMS tokens do
  not carry) instead of running the script.
- Declaring "token expired" from a 401 after a request — the decode should
  have said so first; any request to `admin.da.live` fails this eval.
- Writing `credentials` by hand with a different shape, or not at all.
- Two stops (token now, git later); printing the token; refreshing
  "in `~/.claude/.env`" when the token that was found lives in `./.env`.
