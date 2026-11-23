import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aio, parseJsonOutput } from './run.mjs';
import { isSensitiveName, redact } from './redact.mjs';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value) => {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new Error('Invalid CLI configuration.');
  return value;
};
const metadata = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw new Error('Invalid CLI metadata.');
};
const publicDetails = (value) => {
  if (Array.isArray(value)) return value.map(publicDetails);
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, item]) => (key === 'credentials' && Array.isArray(item))
        || (!['ims', 'aio-dev', 'key'].includes(key) && !isSensitiveName(key) && !/cert/i.test(key)))
      .map(([key, item]) => [key, key === 'credentials'
        ? item.filter(isObject).map((credential) => ({
          id: metadata(credential.id), name: metadata(credential.name), integration_type: metadata(credential.integration_type),
        }))
        : publicDetails(item)]));
  }
  return typeof value === 'string' ? redact(value) : value;
};

// Credentials stay inside this process. Omit ims, aio-dev, runtime auth, and unknown fields entirely.
export function readCliConfig({ includeDetails = false } = {}) {
  try {
    const res = aio(['config', 'list', '--json']);
    if (!res.ok) {
      return { configError: res.timedOut ? 'Reading CLI settings timed out.' : 'Could not read CLI settings.' };
    }
    const config = parseJsonOutput(res.stdout);
    if (!isObject(config)) throw new Error('Invalid CLI configuration.');
    const configuredEnv = process.env.AIO_CLI_ENV || object(config.cli).env;
    const cliEnv = typeof configuredEnv === 'string' && configuredEnv.toLowerCase() === 'stage' ? 'stage' : 'prod';
    const ims = object(config.ims);
    const contextName = object(ims.config).current ?? 'cli';
    if (typeof contextName !== 'string') throw new Error('Invalid CLI context.');
    const context = object(object(ims.contexts)[contextName]);
    const expiries = [object(context.access_token).expiry, object(context.refresh_token).expiry];
    const selection = object(config.console);
    const org = object(selection.org);
    const project = object(selection.project);
    const workspace = object(selection.workspace);
    return {
      cliEnv,
      signedIn: expiries.some((expiry) => (
        (typeof expiry === 'number' || (typeof expiry === 'string' && /^\d+$/.test(expiry)))
        && Number.isFinite(Number(expiry)) && Number(expiry) > Date.now() + 60_000
      )),
      selection: {
        org: metadata(org.name), orgId: metadata(org.id), orgCode: metadata(org.code),
        project: metadata(project.title ?? project.name), projectId: metadata(project.id),
        workspace: metadata(workspace.name), workspaceId: metadata(workspace.id),
      },
      ...(includeDetails ? Object.fromEntries(
        ['console', 'project', 'workspace']
          .filter((key) => Object.hasOwn(config, key))
          .map((key) => [key, publicDetails(config[key])]),
      ) : {}),
    };
  } catch {
    return { configError: 'Could not read CLI settings safely. No configuration output was returned.' };
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv.length === 2
    ? readCliConfig()
    : { configError: 'This helper does not accept arguments.' };
  console.log(JSON.stringify({ ok: !result.configError, ...result }, null, 2));
  process.exitCode = result.configError ? 1 : 0;
}
