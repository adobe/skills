# breakpoint-lint fails a missing `--dirs` file and negated desktop-first queries (#162)

- **`breakpoint-lint.mjs` gaps (#162, issue #624).** A `--dirs` entry naming a missing
  `.css`/`.js`/`.mjs`/`.html` file exits 2 instead of linting nothing clean (a mistyped
  `<slug>-proposed.html` passed the prototype audit). A lower bound under `not`
  (`not all and (min-width: 900px)`, `not (min-width: 900px)`) is desktop-first. HTML comments
  are blanked outside `<style>`/`<script>`. Under a target, the rewrite hint names the nearest
  target step. Replica's desktop-first float/BFC corollary ("add `flow-root` to the un-floating
  override") is removed.
