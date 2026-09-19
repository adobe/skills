# Fixture provenance & known limitations

`fixture/` realises this eval's Setup: the shared post-migrate replica
project plus the two things `deploy` needs to start (a prototype and an EDS
scaffold), with every credential deliberately absent. Everything under
`fixture/` is copied verbatim into the eval workspace; this file and
`answers.md` live outside it and are never visible to the agent under test.

## Where each part came from

- `stardust/` — verbatim copy of `evals/_shared/fixture-post-migrate/stardust/`
  (fictional regional financial-services site; `.example` TLD, nothing
  crawled). Its README documents every shape. Unchanged here except for the
  added `prototypes/` directory.
- `stardust/prototypes/home-proposed.html` — hand-authored from the shared
  tree's `stardust/migrated/index.html` so the prototype and the migrated
  page tell the same story. Single-file shape from
  `skills/prototype/reference/proposed-file-shell.md`: `:root` token block
  first in the first `<style>`, semantic sections with `data-section` /
  `data-intent` / `data-layout`. Provenance comment carries `writtenBy: stardust:replica`,
  `mode: preserve`, matching `state.json.flow`.
- `scripts/aem.js`, `scripts/scripts.js`, `head.html` — upstream
  `adobe/aem-boilerplate` files (Apache-2.0 headers retained), copied from a
  local checkout after a grep confirmed they carry no site-specific strings.
- `styles/styles.css`, `styles/fonts.css`, `blocks/{header,footer,fragment}`
  — hand-written to the boilerplate's shape (body `display:none` /
  `.appear` gate, `--nav-height` chrome reservation, `main > .section`
  scaffold, `a.button` conventions, fragment loader). Shorter than upstream
  but structurally equivalent; the runtime-detection probe would classify
  them as `vanilla-eds`.
- `fstab.yaml` — names a DA mountpoint (`larkspur-mutual/www`) so the org
  and site are discoverable and the missing-prerequisite list is not padded
  with "unknown DA target".

## What is deliberately absent, and how to keep it absent

- **No `.env`, no `DA_TOKEN`.** The runner inherits the host's environment
  and the deploy skill's lookup order includes `~/.claude/.env` and
  `~/.env`. Before running, make sure none of these carries `DA_TOKEN` on
  the runner host — e.g. `env -u DA_TOKEN node run.mjs …` and temporarily
  move `~/.claude/.env` aside. A run where a token IS found is a different
  eval (the consolidated list should then contain only the git gap) and its
  `single_consolidated_stop` verdict is invalid.
- **No `.git`.** Git cannot track a nested repository, so the fixture cannot
  ship one; the runner's `cp -R` produces a plain directory. The absence is
  the point: it is the second missing prerequisite and is what makes
  "one consolidated list" testable rather than trivially satisfied.
- **No `content/`, no authored blocks** beyond the chrome trio — the eval
  must stop before any of these appear.

## Known limitations — don't mistake these for skill bugs

- Every sha in `state.json` / `progress.json` is syntactically valid but
  fabricated (inherited from the shared tree).
- `stardust/current/` is absent (as in the shared tree); `deploy` does not
  read it before pre-flight, but a run that gets past pre-flight — which
  this eval scores as a failure — may complain about it.
- The prototype's logo `<img>` points at `../migrated/assets/logo.svg`,
  which resolves inside the fixture; it is not a live URL.
- The upstream `aem.js`/`scripts.js` vintage is whatever the local checkout
  carried on 2026-09-19; the skill's runtime probe is meant to detect drift,
  so a newer boilerplate is not a fixture defect.
