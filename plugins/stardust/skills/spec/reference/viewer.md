# Viewer

`viewer/` is a Cloudflare Worker (API, chat, chat-built views, spec) plus a React Spectrum 2 UI. It reads the D1 copy
of `spec.sqlite`; it never crawls or judges. `viewer/README.md` lists every table and the meta contract.

## Publish (spec-load.mjs)
1. `--step render`: copies the template to `<project>/viewer/`, installs, creates the D1 database and R2 bucket once,
   writes `wrangler.jsonc` from `viewer.{worker,d1,r2,foundryEndpoint,chatModel}`.
2. Secrets (operator, in `<project>/viewer/`): `wrangler secret put FOUNDRY_API_KEY`, `EDITOR_KEY`; for media only,
   `ADMIN_TOKEN` (export the same value as `SPEC_ADMIN_TOKEN`), deleted after the upload — verify with `secret list`.
3. `--step data` replaces the spec tables and keeps question_answer, chat_log, usage, view_spec.
4. `--step deploy`, then `--step media`.

## Public by default
Anyone with the URL can read and chat; recording a decision needs the editor key. The chat has a per-IP rate limit,
a daily token budget and read-only SQL. Do not name another migration or engagement in public text; keep internal
evaluations out of the database.
