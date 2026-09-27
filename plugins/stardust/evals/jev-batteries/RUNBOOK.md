# Runbook — the first real A/B of the decision layer

Two arms per site, same day, same prompt, same 10–20 pages: `STARDUST_DECIDER=off` first, then
`assist` (supervisor batteries in `gate` where BASELINE.md says go). Report with
`AB-TEMPLATE.md`, numbers from `collect-ab.mjs`, results appended to BASELINE.md § A/B runs.

## 0. One-time setup (the machine that runs the sessions)

1. The plugin from this branch, not the marketplace release. A local marketplace directory beside
   the checkout, with `.claude-plugin/marketplace.json` naming the plugin `stardust` at source
   `./plugins/stardust`, where `plugins/stardust` is a symlink to `<checkout>/plugins/stardust`
   (a source outside the marketplace directory is rejected). Verified 2026-09-27:
   ```bash
   claude plugin marketplace add <parent>/ab-marketplace                # name: stardust-ab
   ```
   In every A/B project directory install it at project scope and disable the released one there
   (check the scope in the output: a disable that lands at user scope switches the release off in
   every session — `claude plugin enable stardust@adobe-skills --scope user` puts it back):
   ```bash
   cd ab/<role>-off
   claude plugin install stardust@stardust-ab --scope local             # 0.28.0 into the plugin cache
   claude plugin disable stardust@adobe-skills --scope local
   claude plugin list                                                   # stardust@stardust-ab enabled here
   ```
   Repeat in `ab/<role>-assist`. The cache copy is taken at install time: after a new commit on the
   branch, run `claude plugin marketplace update stardust-ab` and reinstall in both directories.
2. Keys in the shell that starts the session, never in a file the skills push:
   ```bash
   set -a; source ~/.claude/.env; set +a       # DA_TOKEN, TYPESAFE_API_KEY, GH_PAT
   ```
3. `promptCacheTtl: "1h"` in `~/.claude/settings.json` for both arms (multi-hour sessions; the
   plugin's own field data: cache re-writes are 65 % of spend).

## 1. Per site

Two project directories side by side, one per arm, e.g. `ab/<role>-off/` and `ab/<role>-assist/`.
Each gets its own private EDS repo (the prompt below asks for it) so the two arms never share a
content bus or a Code Sync installation.

Start the `off` arm:
```bash
cd ab/<role>-off && STARDUST_DECIDER=off claude
```
Start the `assist` arm only after the `off` arm has finished (same origin, same day; a bot-managed
origin must see the two arms one after the other, not at once):
```bash
cd ab/<role>-assist && STARDUST_DECIDER=assist claude
```

The prompt, identical in both arms (fill the three placeholders once, paste twice):

> `/stardust:replica <site URL> — migrate this site to EDS keeping its current design, hands-off,
> no approval gates. Set up a new private EDS repo with my personal skill. Migrate exactly these
> pages and no others: <the page list>. Gate at 1440 and 360. Run the full chain through rollout
> and QA; when done, post the final report and stop.`

Rules during the run: no prompts from you except a DA token refresh (`python3
~/.claude/scripts/refresh_da_token.py`, then tell the session to re-source `.env`) — count every
touch. If either arm is blocked by the origin for more than an hour, stop both and re-run the
site another day; a half-blocked arm is not a comparison.

## 2. After both arms

```bash
node <plugin>/evals/jev-batteries/collect-ab.mjs \
  --off ab/<role>-off --assist ab/<role>-assist \
  --off-transcripts ~/.claude/projects/-<path-of-off-dir-with-dashes> \
  --assist-transcripts ~/.claude/projects/-<path-of-assist-dir-with-dashes> \
  --out <plugin>/evals/jev-batteries/data/AB-<role>-<date>.md
```
Then fill the Findings and Verdict sections of the report by hand: open both live sites at the
same 6 pages, note every defect a reader would see, and mark which gate should have caught it;
read every `REVIEW` line in `ab/<role>-assist/stardust/decisions.jsonl` and judge it right or
wrong; run `decide.mjs compare` in the assist project for the per-battery agreement.

## 3. Sites

The protocol wants one clean origin and one bot-managed origin, 10–20 pages each, both already
migrated once in the recorded corpus so the recorded run is a third reference point:

| role | why | pages |
|---|---|---|
| a broadcaster's site (clean origin; the recorded 100-page run finished in 4 h 15 min with 12/12 archetypes within bar) | the best-behaved origin in the corpus: the A/B measures the layer, not the origin | home, 3 hub pages, 3 browse pages, 2 detail pages, 1 legal page — 10 |
| a pharmacy retailer (bot-managed; the recorded run needed real Chrome, shipped 78 siblings unmeasured and ran a 13-hour fix program) | the case the supervisor and repair-queue batteries were built from | home, 2 category tiers, 2 PDPs, 2 help topics, 2 pharmacy pages, 1 store page — 10 |

The page lists are in the recorded projects' `stardust/state.json` rosters; pick the same slugs
for both arms. Expect 3–6 hours per arm on the clean origin and longer on the bot-managed one.

## 4. What counts as a result

The estimates in `notes/jev-system-one-research.md` § 6 predicted, for the sidecar step alone,
5–10 % fewer turns and no fidelity change. The A/B decides three things: whether the pre-sorted
flags and the round hints reduce gate rounds or turns, whether the supervisor refused anything
and was right, and whether the shadow ledger's agreement on real pages matches the replay
tables. A run where nothing moved is a result too; it goes in BASELINE.md with the numbers.
