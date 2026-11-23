// Reads the app's project link (.aio) and action list, keeping only allowlisted, non-secret fields.
// Anything it can't read with certainty is an error, so callers never mistake "unreadable" for "nothing to check".
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aio, parseJsonOutput } from './run.mjs';

const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k] ?? null]));
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isWebValue = (value) => value === true || value === 'yes' || value === 'raw';

function readProjectLink() {
  if (!existsSync('app.config.yaml')) throw new Error('No app.config.yaml here. Run this from the app folder.');
  if (!existsSync('.aio')) throw new Error('This app is not linked to a Developer Console project (no .aio file).');
  const project = parseJsonOutput(readFileSync('.aio', 'utf8'))?.project;
  if (!project?.id || !project.workspace?.id || !project.org?.id) {
    throw new Error('The .aio file has no org, project or workspace. Link the folder with `aio app use`.');
  }
  return project;
}

// Package and action maps may be absent (a UI-only app) but, when present, must be objects of objects.
function actionsOf(config, extensionName) {
  const packages = config.manifest?.full?.packages;
  if (packages === undefined || packages === null) return [];
  const bad = () => new Error(`The action configuration of ${extensionName} is malformed. Run \`aio app build\` to see configuration errors.`);
  if (!isObject(packages)) throw bad();
  return Object.entries(packages).flatMap(([pkg, def]) => {
    if (!isObject(def) || (def.actions !== undefined && !isObject(def.actions))) throw bad();
    return Object.entries(def.actions ?? {}).map(([action, a]) => {
      if (!isObject(a)) throw bad();
      // Same rule as the CLI (aio-lib-runtime): `web` or the `web-export` annotation makes a web action, and
      // require-adobe-auth only creates the __secured_ action for web actions; it's ignored on the others.
      const web = isWebValue(a.web) || isWebValue(a.annotations?.['web-export']);
      return {
        name: `${pkg.replace(/__APP_PACKAGE__/g, config.ow.package)}/${action}`,
        web,
        secured: web && Boolean(a.annotations?.['require-adobe-auth']),
        runtime: a.runtime ?? null,
      };
    });
  });
}

function readExtensions() {
  // `aio app info` resolves .env values into action inputs, so only names and flags are read from it.
  const info = aio(['app', 'info', '--json', '--mask']);
  if (info.notFound) throw new Error('The aio CLI was not found. Install it with the app-builder-setup skill.');
  if (!info.ok) throw new Error(`aio app info failed${info.timedOut ? ' (timed out)' : ''}. Run \`aio app build\` to see configuration errors.`);
  const all = parseJsonOutput(info.stdout)?.all;
  const configs = isObject(all) ? Object.entries(all) : [];
  if (!configs.length || !configs.every(([, c]) => isObject(c?.app) && isObject(c?.ow))) {
    throw new Error('Could not read the app configuration from `aio app info`. Run `aio app build` to see configuration errors.');
  }
  return configs.map(([name, config]) => ({
    name,
    frontend: Boolean(config.app.hasFrontend),
    namespace: config.ow.namespace ?? null,
    actions: actionsOf(config, name),
  }));
}

export function readAppContext() {
  const project = readProjectLink();
  const extensions = readExtensions();
  if (!extensions.some((e) => e.frontend || e.actions.length)) {
    throw new Error('The app configuration lists no UI and no actions. Check app.config.yaml.');
  }
  return {
    org: pick(project.org, ['id', 'name']),
    project: pick(project, ['id', 'name', 'title']),
    workspace: pick(project.workspace, ['id', 'name']),
    extensions,
  };
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('This helper does not accept arguments.');
    console.log(JSON.stringify({ ok: true, ...readAppContext() }, null, 2));
  } catch {
    console.log(JSON.stringify({ ok: false, error: 'Could not read app configuration safely. No configuration output was returned.' }));
    process.exitCode = 1;
  }
}
