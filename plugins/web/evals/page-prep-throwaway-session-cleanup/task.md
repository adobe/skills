# Clean overlays for batch screenshots

We batch-screenshot news homepages with the `web` CLI. Each browser session is
thrown away right after its screenshot, so consent choices never need to persist.
For https://www.20minutes.fr/ the overlay detector already ran in the live session;
its report is in `resources/detection-report.json`. There is no browser in this
environment.

Write `cleanup.sh` with the `web` command(s) to run in that live session (session `s1`),
right before the screenshot, to get the page clear of overlays. Keep it fast: it
runs on thousands of pages. Also include a check that confirms nothing is still
