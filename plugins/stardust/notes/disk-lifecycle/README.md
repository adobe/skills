# Disk lifecycle — design note

Status: shipped in 0.37.0 (#150): the ignore file, `gate-all.mjs` and `gate.sh`. This note keeps the reasoning, what
was measured, and what was left out.

## The problem, measured

A recorded site-scope replica run (550 pages, a hosted harness with a 20 GB container disk) published every page,
then failed: the disk was full and the final checkpoint commit could not be written. The harness commits the whole
`stardust/` folder at every checkpoint, so a restarted container finds the same files. The run's tracked tree:

| Path | Size | Files |
|---|---|---|
| `replica/gates/` | 3.4 GiB | 4,203 (PNG 3.34 GiB; JSON and text 27 MiB) |
| `.work/` | 768 MiB | 7,075 (~680 MiB media saved for upload) |
| `current/assets/screenshots/` | 756 MiB | 694 |
| `current/pages/` | 222 MiB | 1,388 |
| `migrated/` (HTML, JSON) | 218 MiB | ~1,370 |

5.3 GiB, 82 % PNG, and every byte paid twice on disk (worktree and `.git`). In the gate folders: `origin.png`,
`eds.png` and `diff.png` for every page that had passed, 2–27 MiB each, and 765 MiB of extra origin captures the agent
had left beside a page's own (`origin-prev.png`, `origin-restitch.png` and the like). Gate images grow with the page
count, so the longest runs hit the limit.

## Why the harness could not just follow the ignore file

The ignore file dropped whole folders, and two of them hold what a resumed run reads:

| Was ignored | Read on resume by | Lost on a restart |
|---|---|---|
| `replica/gates/**` JSON and text (tables, `pixel.json`, verdicts, capture records) | `gate-all.mjs --skip-existing`, `gate-evidence.mjs`, `update-coverage.mjs` | every page's gate result: the final all-pages gate re-captures the roster (hours, origin hits on a bot-walled site) |
| `replica/gates/<slug>-<w>/baseline.png` | `gate.sh --gate-against-baseline` | the frozen origin |
| `current/assets/` fonts, logo, media | prototype, migrate, deploy | an extract re-run |

The state a resume starts from (`state.json`, `status.jsonl`, the `progress.json` files, the deploy ledgers) was
always tracked, and `gate-evidence.mjs` never removes a recorded pass, so nothing was lost for correctness — only
time and requests to the origin.

## Design

Three classes of file, one rule each:

1. **Run state** — tracked: everything not listed in the ignore file. The file now ignores gate images, not gate
   folders (`**/gates/**/*.png`, a frozen `baseline.png` excepted), and tracks `current/assets/` except its
   screenshots. On the measured run: 0.5 GiB tracked instead of 5.3 GiB. `**/gates/` also covers
   `first-page/gates/`, whose PNGs were tracked before.
2. **Costly to remake, ignored** — captures of a page that has not passed yet, extract screenshots. They stay on
   disk; a restart that loses them re-captures.
3. **Disposable** — deleted by the instrument that wrote them once their result is saved: a passed page's PNGs
   (`gate-all.mjs`, every PNG in the page dir, so extra captures go too; a reuse run takes the recorded pass while
   its masks and eds URL hold), and earlier rounds' diff images in an archetype gate dir (`gate.sh`).

The recorded pass is what lets a resumed run skip a page, so it has to be invalidated before anything can make it
wrong: a page captured again loses it first, and a missing capture is written to `pixel.json`. Deleting at the end
of a run would still let one run hold every page's captures at once, so pages go through in batches of 25 and a
passed batch's PNGs go before the next batch is captured.

Deleting inside the instrument needs no new rule for the agent and no separate prune step: the files never pile up.

## Left out, and why

- **A prune command.** With deletion inside `gate-all.mjs` and `gate.sh`, nothing safe is left for it to delete.
- **Deleting media saved for upload** (`da-media-upload.mjs` source fetches under `.work/`). `build-harness.mjs`
  points the local QA harness at those files, because the DA content host answers 401 to anonymous requests; a page
  converted later can reuse an image an earlier page uploaded. Safe only once every page using it has passed its
  local asserts — revisit if `.work/` grows past what the disk allows.
- **`visual-diff.mjs` reusing `live.png` / `build.png`** instead of two full-page shots of its own per `--full` round.
  Keeping only the latest round bounds the disk; the time saved would be the reason to do it.
- **Extract screenshots as JPEG.** They are the origin fallback for a bot-walled page in `gate-all.mjs`; lossy bytes
  would move its pixel %. Not needed once the screenshots are no longer committed.

## Harness side

A harness that commits `stardust/` for its restarts can now use the plugin's ignore file instead of tracking
everything: version-gate it on the plugin release (a run pinned to an older plugin keeps the old file), and a
restart needs only a shallow clone of the last checkpoint.
