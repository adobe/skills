import { CliError } from '#src/errors.mjs';
import { listDocs, loadDoc } from '#src/docs/index.mjs';

const HELP = `
Prints Markdown, like --help does; --format has no effect here.
Topics:
  web doc              list the topics
  web doc extending    add your own commands on top of web (library surface, example, rules)
`;

/**
 * Register `doc [topic]`: long-form documentation shipped inside the binary.
 * @param {import('commander').Command} program
 * @param {{ stdout?: { write(c: string): unknown } }} deps
 */
export function registerDoc(program, deps) {
  const out = deps.stdout ?? process.stdout;
  program
    .command('doc [topic]')
    .description('read the long-form docs shipped with the CLI (text)')
    .addHelpText('after', HELP)
    .action((topic) => {
      if (!topic) {
        out.write(
          `${listDocs()
            .map((t) => `web doc ${t}`)
            .join('\n')}\n`,
        );
        return;
      }
      const text = loadDoc(topic);
      if (text === null) {
        throw new CliError('USAGE', `unknown doc topic: ${topic}`, {
          hint: `topics: ${listDocs().join(', ')}`,
        });
      }
      out.write(text);
    });
}
