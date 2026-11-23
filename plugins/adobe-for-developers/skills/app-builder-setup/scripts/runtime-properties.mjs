// Request only non-secret properties; never request auth, private keys, or the default full table.
import { aio } from './lib/run.mjs';

function readProperties(flags, timeoutMs = 60_000) {
  const result = aio(['rt', 'property', 'get', ...flags], { timeoutMs });
  if (!result.ok) return null;
  const properties = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^[ \t]*whisk (namespace|API host|API version|CLI version|API build version|API build number)(?:[ \t]+(.*?))?[ \t]*$/);
    if (!match) continue;
    const [, name, value] = match;
    if (Object.hasOwn(properties, name)) return null;
    properties[name] = value ?? '';
  }
  return properties;
}

try {
  if (process.argv.length !== 2) throw new Error();
  const properties = readProperties(['--namespace', '--apihost', '--apiversion', '--cliversion']);
  if (!properties) throw new Error();
  const namespace = properties.namespace;
  const apiversion = properties['API version'];
  const apihost = properties['API host'];
  const cliversion = properties['CLI version'];
  if ([namespace, apiversion, apihost, cliversion].some((value) => value === undefined)) throw new Error();
  // Build information requires a network request; it must not hide locally available properties.
  const build = readProperties(['--apibuild', '--apibuildno'], 5_000) ?? {};
  const buildValue = (value) => value && value !== 'error' ? value : null;
  const apibuild = buildValue(build['API build version']);
  const apibuildno = buildValue(build['API build number']);
  console.log(JSON.stringify({
    ok: true, namespace, apihost, apiversion, cliversion, apibuild, apibuildno,
    ...(!apibuild || !apibuildno ? { warning: 'Runtime API build information is unavailable; local properties are shown.' } : {}),
  }, null, 2));
} catch {
  console.log(JSON.stringify({ ok: false, error: 'Could not read Runtime properties safely. No CLI output was returned. This helper does not accept arguments.' }));
  process.exitCode = 1;
}
