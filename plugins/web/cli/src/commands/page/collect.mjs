import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError } from '#src/errors.mjs';
import { loadBundle } from '#src/bundles/index.mjs';
import { writeIcons } from '#src/page/icons.mjs';
import { runPageCommand } from '#src/page/run.mjs';
import { artifactDir } from '#src/session.mjs';

export const COLLECTORS = ['all', 'icons', 'metadata', 'text', 'forms', 'videos', 'socials'];
const DATA_COLLECTORS = COLLECTORS.slice(2);

function extract(driver, session, what) {
  const which = JSON.stringify(what === 'all' ? null : [what]);
  const code = `async page => page.evaluate((c) => window.__pageCollect.extract(c), ${which})`;
  const data = driver.run(session, { code });
  return typeof data === 'string' ? JSON.parse(data) : data;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function takeScreenshot(driver, session, path, stderr) {
  try {
    driver.screenshot(session, { path });
    return path;
  } catch (err) {
    stderr.write(`Warning: screenshot failed - ${err.message}\n`);
    return undefined;
  }
}

const HELP = `
Example:
  web page collect metadata https://example.com
Output:
  one collector: { ...collectorFields, files, url, session, durationMs }
  all:           { url, collectedAt, screenshot?, collectors: {...}, files, session, durationMs }
Notes:
  <what> is one of: all, icons, metadata, text, forms, videos, socials. Files go under
  --output/<session>-collect/ with stable names (metadata.json, forms.json, collection.json,
  screenshot.jpg); icons/ holds the .svg files plus icons.json. Unknown <what> exits 2 (USAGE).
`;

/**
 * Run collectors on the current page and write their output under `outputDir`.
 * @param {object} driver
 * @param {string} session
 * @param {{ what: string, outputDir: string, stderr?: { write: Function } }} spec
 * @returns {object} collector fields (or the collection for `all`) plus `files`
 */
export function collectPage(driver, session, { what, outputDir, stderr = process.stderr }) {
  driver.inject(session, loadBundle('page-collect.js'));
  const data = extract(driver, session, what);
  const { url } = driver.pageHealth(session);
  const dir = artifactDir(outputDir, session, 'collect');
  const path = (name) => join(dir, name);
  const files = {};
  const results = {};
  if (data.svgs) {
    const iconsDir = path('icons');
    results.icons = writeIcons(data.svgs, url, iconsDir);
    files.icons = iconsDir;
  }
  for (const name of DATA_COLLECTORS.filter((n) => data[n])) {
    results[name] = data[name];
    files[name] = writeJson(path(`${name}.json`), data[name]);
  }
  if (what !== 'all') return { ...results[what], files };
  const screenshot = takeScreenshot(driver, session, path('screenshot.jpg'), stderr);
  const collection = {
    url,
    collectedAt: new Date().toISOString(),
    screenshot,
    collectors: results,
  };
  files.collection = writeJson(path('collection.json'), collection);
  return { ...collection, files };
}

/**
 * Register `page collect <what> [url]`.
 * @param {import('commander').Command} group
 * @param {object} deps
 */
export function registerCollect(group, deps) {
  group
    .command('collect <what> [url]')
    .description(`collect page resources: ${COLLECTORS.join(', ')}`)
    .addHelpText('after', HELP)
    .action((what, url, _opts, command) => {
      if (!COLLECTORS.includes(what)) {
        throw new CliError('USAGE', `unknown collector ${what}`, {
          hint: `one of: ${COLLECTORS.join(', ')}`,
        });
      }
      return runPageCommand(command, deps, {
        url,
        fn: (driver, session, opts) =>
          collectPage(driver, session, {
            what,
            outputDir: opts.output,
            stderr: deps.stderr,
          }),
      });
    });
}
