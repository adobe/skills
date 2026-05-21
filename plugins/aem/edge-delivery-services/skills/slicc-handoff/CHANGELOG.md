# Changelog

All notable changes to this skill are documented here. Versioned releases below
this section are managed automatically by `semantic-release` from Conventional
Commits.

## Unreleased — Initial Version

Introduces the **slicc-handoff** skill, a bridge between the host coding agent
and the [SLICC](https://www.sliccy.ai) browser agent.

### What this skill is for

Use this skill when the user wants to:

- **Hand off** the current task to SLICC so it can continue the work inside a
  real browser (for example: drive a live signup flow, test against a deployed
  site, or use a tool that only exists in SLICC).
- **Upskill** a running SLICC instance by installing a skill from a GitHub
  repo, optionally scoped to a sub-path/branch via a `tree/<branch>/<path>`
  URL.

The skill triggers a yes/no approval card inside SLICC's Chat tab. Nothing
runs in SLICC until the user accepts.

### What's included

- `SKILL.md` — activation guidance, usage examples, and a "How it works"
  section that documents the dual-delivery design (localhost POST + RFC 8288
  `Link` header observed by the SLICC extension).
- `scripts/slicc-handoff` — a small Node 18+ helper that builds the
  `https://www.sliccy.ai/handoff?...` URL, POSTs a structured payload to
  `http://localhost:${SLICC_PORT ?? 5710}/api/handoff` (profile-independent
  fallback for the CLI/Electron float), and optionally `--open`s the URL so
  the SLICC extension can pick it up from its own browser profile.
- `package.json`, `.releaserc.json` — wired into the repo's per-skill
  semantic-release setup.

### Verb prefixes

The instruction string passed to the script is verb-prefixed so SLICC can
dispatch it correctly:

- `handoff:<free-text>` — continue the task in SLICC.
- `upskill:<github-url>` — install a skill from GitHub.

If no recognised verb prefix is present, `handoff:` is prepended for you.

### Environment

- `SLICC_PORT` (optional, default `5710`) — port of the local SLICC
  node-server. Set this when running multiple parallel SLICC instances.

### Security notes

Treat the user-supplied instruction string as untrusted input that will be
displayed in SLICC for approval — do **not** embed secrets or credentials in
it. The localhost POST is best-effort and silently falls through to `--open`
when no local SLICC server is running.
