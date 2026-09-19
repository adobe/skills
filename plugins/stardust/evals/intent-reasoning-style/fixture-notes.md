# Fixture provenance & known limitations

`fixture/` is a **verbatim copy** of `../direct-from-phrase/fixture/` — the
fictional conservative B2B bookkeeping site ("Ledgerline") immediately
after `stardust:extract` completed on 5 pages. This eval's Setup is the
same post-extract state (5 pages `extracted`, `stardust/current/`
populated, no project-root PRODUCT.md / DESIGN.md, no
`stardust/direction.md`), so the fixture is shared rather than re-authored.
Provenance for every file, and the schema each one follows, is documented
in `../direct-from-phrase/fixture-notes.md`; the known limitations listed
there (1×1 PNGs, fabricated hashes, no `brand-review.html`) apply here too.

Keep the two trees in sync: if `direct-from-phrase/fixture/` changes,
re-copy it here (`rm -rf fixture && cp -R ../direct-from-phrase/fixture .`).

## What this eval adds

- `answers.md` — a persona that **defers** every clarifying question
  ("I need to check with the team, park it for now"). The eval tests the
  ask-then-stop path, so the simulated user must not resolve the gap;
  answering "make it more distinctive" would push the agent into the
  authoring path that `direct-from-phrase` already covers. The persona
  is needed even so, because the runner only tells the session a user is
  present when a persona exists (see `../runner/README.md`).

## Known limitations

- The brand surface is deliberately signal-strong (see the model notes).
  That does not affect this eval: "I want it to be amazing" moves no
  axis regardless of how much brand signal exists.
