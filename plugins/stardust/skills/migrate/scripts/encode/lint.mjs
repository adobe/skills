/**
 * migrate/encode/lint.mjs — the map's authoring checks, dispatched by `encode.mjs --lint` and `encode.mjs --sweep`.
 * A library module (no CLI). Placeholder: both checks report "not implemented" and return exit 1, so no caller can
 * mistake a missing check for a passing one.
 *
 *   runLint(ctx)  → Promise<exit code>   the map checks against the archetype
 *   runSweep(ctx) → Promise<exit code>   a dry run over every sibling capture of the template; writes nothing
 *
 * ctx (built by encode.mjs): { root, template: {id, archetype, pages[]}, vocab, tf, vocabFile, transformFile,
 * mapErrors[], site, engine, dom, loadDeploy, readCapture(slug), encodeTemplate, loadEncoderDeps, json, out(line),
 * err(line) }.
 */

export async function runLint(ctx) {
  ctx.err(`encode --lint: not implemented yet (template ${ctx.template.archetype})`);
  return 1;
}

export async function runSweep(ctx) {
  ctx.err(`encode --sweep: not implemented yet (template ${ctx.template.archetype})`);
  return 1;
}
