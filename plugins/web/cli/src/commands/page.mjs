import { registerTree } from '#src/commands/page/tree.mjs';
import { registerReduce } from '#src/commands/page/reduce.mjs';
import { registerCollect } from '#src/commands/page/collect.mjs';
import { registerLangs } from '#src/commands/page/langs.mjs';
import { registerOverlays } from '#src/commands/page/overlays.mjs';

const GROUP_HELP = `
Use to analyze a page. Pass a <url> for a one-shot run in an ephemeral browser that is closed
afterwards, or --session <name> to reuse an open browser; with a <url> it is opened under that name if
needed. The session browser is left open. Each command prints one
JSON document with url, session and durationMs added; --format text is supported on tree.
`;

/**
 * Register the `page` group.
 * @param {import('commander').Command} program
 * @param {object} deps
 */
export function registerPage(program, deps) {
  const group = program
    .command('page')
    .description('analyze a page: tree, reduce, collect, langs, overlays')
    .addHelpText('after', GROUP_HELP);
  registerTree(group, deps);
  registerReduce(group, deps);
  registerCollect(group, deps);
  registerLangs(group, deps);
  registerOverlays(group, deps);
}
