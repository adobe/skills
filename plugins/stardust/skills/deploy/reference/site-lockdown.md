# Site lockdown — private repo + site auth, after the last anonymous gate, before the hand-off

Read:
- § Read when — the trigger and the one moment in the run this step belongs to;
- § The command — one instrument, its inputs by name, its exit codes;
- § Gate contract — what it blocks, on which condition, the escape hatch, how hands-off resolves it;
- § After the lock — every later delivery-host read carries the token;
- § Never — the lines this step does not cross.

A delivered site is public by default: the code repo is whatever `gh repo create` made it, and `.aem.page` / `.aem.live` answer every anonymous request. One operator org held dozens of served customer sites that way. Locking is two writes — the repo to private, an `access/site.json` allow list backed by a site token — and one verification. Done too early it turns every anonymous gate into a `401` false-FAIL; done by hand it leaks the token into a reply. This chapter fixes the moment and the instrument.

## Read when

- The register row `lockdown` (`../../stardust/reference/decisions.md` § Default rows) is `on` — the default for every migration — and the target is not yet verified locked.
- `deploy` § When you finish, or `rollout` Phase H, is about to write the hand-off: the step runs **after** the last gate that reads the origin anonymously (the published-origin gate, rollout Phases E–G) and **before** the report. Never mid-rollout, never between waves of the same run.
- A standalone ask ("make the site private", "put it behind login") — same instrument, same order: run the anonymous gates first if any are pending.
- `--inventory` when the ask is "which of our sites are open" — a read-only TSV, no lock.

## The command

```
node skills/deploy/scripts/lockdown.mjs --org <org> --repo <repo> [--site <site>] [--allow *@<domain>]
node skills/deploy/scripts/lockdown.mjs --inventory --org <org> [--prefix sdt-]
```

| input | from | notes |
|---|---|---|
| `<org>/<repo>` (`--site` when the DA site name differs) | `state.json.site.eds`, else `stardust/decisions.md` row `target` | the plugin ships the shape, never an org name |
| `DA_TOKEN` | by name (`--token-env`, `state-machine.md` § Credentials key order) | admin.hlx.page reads and writes; never sent to a delivery host |
| allow list | `--allow`, default `*@<domain of git config user.email>` — the **operator's** domain, printed in the plan gate | the customer's domain is a later owner decision on the same row |
| `SITE_TOKEN_<SLUG>` | written by the script into `./.env` (`--env`) and named in `state.json.credentials.siteTokenEnv` | the value is never printed; `.env` must already be git-ignored (master Setup step 6) — asserted before any write |

Steps, in order, stop at the first failure: config present (`GET config/<org>/sites/<site>.json`; 404 = the config service is not enabled — exit 2, never a guessed config) → repo private (`gh repo edit … --visibility private`; `--gh-mode rest` with `GH_PAT`; `--gh-mode print` hands the command to the owner) → `POST …/secrets.json {}` → `access/site.json` merged (`allow` union, `secretId` appended) and posted → token to `.env` by name, `credentials.siteTokenEnv` to `state.json` → verify both hosts: anonymous `401`, `Authorization: token …` accepted, polled every 3 s up to `--wait` (default 60 s).

| exit | meaning | the run does |
|---|---|---|
| 0 | locked and verified on `.aem.page` and `.aem.live` | hand-off proceeds; gate table carries `site: locked` |
| 1 | verification failed after the capped wait | re-run once; still 1 → `blocked`, no hand-off — never "probably propagated" |
| 2 | no verdict: token missing, `.env` not ignored, config 404 / 401, unreachable | fix the named cause, re-run the same command; config 404 is an owner ask |
| 3 | owner action: the repo step was denied or `--gh-mode print` | `blocked` line with `owner:` = the printed `gh repo edit …`; the site half is locked and verified |

A `timeout` wrapper's 124 is no verdict, as everywhere else.

## Gate contract

- **Class:** governance step, not a quality gate — no threshold, no fidelity verdict; it gates the phase close.
- **Condition:** row `lockdown` is `on` and the last exit of `lockdown.mjs` for this target is not 0. Every anonymous gate of the phase has already run (§ Read when).
- **What it blocks:** the phase `end` line and the hand-off report. Until exit 0, the phase closes with `event: "blocked"` + `owner: "<exact command>"` + `next` (`../../stardust/reference/run-status.md`), and the hand-off leads with `Blocked on owner:` while still shipping everything else; the gate table's last line reads `site: open (blocked on owner)`.
- **Escape hatch:** the register row only — `lockdown: off`, owner-decided, with the reason (`internal demo`, `public by design`). No phase re-asks, no CLI `--skip`, no "the reviewer needs it public for a day".
- **Hands-off:** applies the default (`on`) and prints the row in the activation block. The repo change is a privileged action (`../../stardust/reference/harness-permissions.md` § Two classes): ask once; on denial append the printed command as a step to `stardust/.work/ship.sh` (`ship-script.md`), write the `blocked` line, continue with the site half (admin `curl` is the instrument class) and the rest of the run. A missing `DA_TOKEN` is the credentials `blocked` line, never a silent skip. Hands-off cannot turn the row off — it never weakens the step.
- **Protected contracts:** exit codes above; `deploy-batch.mjs` ledger semantics untouched (the script writes only `.env`, `credentials.siteTokenEnv`, stdout); no source-site request — admin plus two GETs per delivery host per poll; D1/D16 unchanged — `access/site.json` protects both hosts, so a preview-only run locks after the preview gate and publish stays its own `--publish` run.

## After the lock

Every later delivery-host read carries the token by NAME from `credentials.siteTokenEnv` — the next wave's `deploy-batch.mjs --site-token-env`, `code-sync-verify.mjs --site-token-env`, `served-check.mjs --token-env`, rollout `verify.mjs` / `redirects.mjs --post-publish` / `media-reconcile.mjs --token-env`, the replica gate's capture (`gate.sh` passes `GATE_TOKEN_ENV` to `stitch-shot.mjs --token-env`), qa and dynamics through `resolveSiteAuth`. The header goes to the target origin only, as a route filter or a per-request header — never context-wide, never to a vendor, never to admin. An anonymous `401 x-error: access-not-allowed` after the lock is a missing `--token-env`, not a delivery regression (`../da-deploy-protocol.md` § Site auth). Review links open on the live host as plain URLs; the reviewer logs in (allow list) in their own session.

## Never

- Lock before the last anonymous gate has run, or between waves of one run.
- Print the token, `cat` an env file, put the value in `state.json`, a journal, a reply or a URL.
- Guess a config when the service answers 404, or `PUT` a config the run does not hold an API key for.
- Retry a denied `gh repo edit` in a variant form; the owner runs the printed command.
- Treat exit 1 as "propagating" — re-run once, then block.
- Allow-list the customer's domain by default; the operator's domain is the default, the rest is an owner row.
