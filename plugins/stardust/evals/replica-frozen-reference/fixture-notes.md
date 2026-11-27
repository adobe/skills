# Fixture provenance and known limitations

`fixture/` is the replica project of `../replica-round-cap/fixture/` before
its first round: the same crawl output and state files, the 1440 source spec
only, no `stardust/replica/gates/`, and the prototype with the opening-hours
defect corrected (12 px), so the verdict of the stable page is not what the
scenario is about.

What the two rounds do on the fixture site (`../fixture-site/`), as run when
the fixture was built:

- `gate.sh visit http://localhost:8780/visit/ <prototype> 1440 iter1` freezes
  the reference first: `reference: frozen 1440×1258, primed, noise floor
  1.52% in 1 variable region(s) (rows 812–928) → mask 812:116; outside them
  0.00%`, then prints `gate.sh: reference: frozen <time>, noise floor 1.52%
  in 1 region(s) — 116 rows excluded` under the pixel line. The varying rows
  are the "today" band the server repaints on every load.
- `gate.sh visit-notice "http://localhost:8780/visit/?unstable=1" <prototype>
  1440 iter1` ends with `gate.sh: reference: UNSTABLE — heights 1348 vs 1418
  after priming; not frozen`, exit 5, and leaves `reference-unstable.json`
  and the `ref-*.png` captures. The heights depend on the server's load
  counter; the spread is 70 px or a multiple of it, against the 8 px the
  freeze allows.

Both rounds were run from a copy of this fixture after `setup.sh`: the first
exits 0 (`pixel: 0.00% … → PASS`, height delta 0, one counted round) although
the prototype paints the band in other colours than any capture: the 116
rows are masked. The second exits 5 and counts nothing. Without `--marker`
the second round stops earlier, at exit 4: the identity check looks for the
slug in the served prototype, and `visit-notice` is not in it. The task gives
the flag, since that check is not what the scenario is about.

`setup.sh` starts the fixture site and copies the plugin's scripts in both
runs of a comparison. The run installs the gate's dependencies and Chromium
itself (the skill's Setup, step 2): about two minutes of a run, and it needs
the npm registry and the browser download. On the machine the fixture was
built on, a freeze took 45 to 60 seconds and a round with its freeze about
80 seconds.
