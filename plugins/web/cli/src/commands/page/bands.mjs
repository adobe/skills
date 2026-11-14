import { Option } from 'commander';
import { parseIntArg } from '#src/args.mjs';
import { captureTree } from '#src/commands/page/tree.mjs';
import { bands, bandsText, fixedLayers } from '#src/page/bands.mjs';
import { runPageCommand } from '#src/page/run.mjs';

const HELP = `
Example:
  web page bands https://example.com --depth all --format text
Output:
  { depth, bands, fixed, text, url, session, durationMs }
  bands[]: { id, top, bottom, left, right, side, text, selectors, children? }
  fixed[]: { selector, top, bottom, left, right }
Notes:
  Slices the page top to bottom along its visual tree: a cut passes between elements, through
  at most the 8 px where two neighbours overlap.
  Elements sharing a vertical range are one band with parts side by side (side: true); a run of
  text elements (paragraphs, headings, images) is one band (text: true). The header and footer
  are bands like any other, unless fixed: fixed elements float over the page and are listed
  in fixed, where they sit at the top of the page. --depth all slices every band again until nothing is left to cut;
  ids nest: B2, B2.1, B2.1.3. Positions are page px at the browser's width (1280 by default).
  Bands say where things are, not what they are.
Exit codes:
  3 when the page is blocked by bot protection.
`;

/**
 * Register `page bands [url]`.
 * @param {import('commander').Command} group
 * @param {object} deps
 */
export function registerBands(group, deps) {
  group
    .command('bands [url]')
    .description('slice a page into bands, level 1 or all levels')
    .addHelpText('after', HELP)
    .addOption(new Option('--depth <depth>', 'levels to slice').choices(['1', 'all']).default('1'))
    .option('--min-width <n>', 'tree minimum element width in px', parseIntArg, 250)
    .option('--settle-ms <n>', 'wait after scrolling for lazy content', parseIntArg, 2000)
    .action((url, _opts, command) =>
      runPageCommand(command, deps, {
        url,
        fn: (driver, session, opts) => {
          const { tree } = captureTree(driver, session, opts);
          const list = bands(tree, { depth: opts.depth });
          return {
            depth: opts.depth,
            bands: list,
            fixed: fixedLayers(tree),
            text: bandsText(list),
          };
        },
      }),
    );
}
