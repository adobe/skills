import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aio, parseJsonOutput } from './run.mjs';
import { redact } from './redact.mjs';

const MAX_METADATA_CHARS = 256;
const MIN_TOKEN_VALIDITY_MS = 60_000;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value) => {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw new Error('Invalid CLI configuration.');
  return value;
};
const metadata = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.length <= MAX_METADATA_CHARS && !/[\u0000-\u001f\u007f]/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw new Error('Invalid CLI metadata.');
};
const RESOURCE_DETAIL_FIELDS = {
  services: [{ id: true, name: true, code: true, type: true, sdkCode: true }],
  credentials: [{ id: true, name: true, integration_type: true }],
  events: { registrations: [{ id: true, name: true, description: true }] },
};
const ORG_FIELDS = { id: true, name: true, code: true, ims_org_id: true, details: RESOURCE_DETAIL_FIELDS };
const WORKSPACE_FIELDS = { id: true, name: true, action_url: true, details: RESOURCE_DETAIL_FIELDS };
const PROJECT_FIELDS = { id: true, name: true, title: true, description: true, org: ORG_FIELDS, workspace: WORKSPACE_FIELDS };
const PUBLIC_DETAIL_FIELDS = {
  console: { org: ORG_FIELDS, project: PROJECT_FIELDS, workspace: WORKSPACE_FIELDS },
  project: PROJECT_FIELDS,
  workspace: WORKSPACE_FIELDS,
};
const pickPublicDetails = (value, allowedFields) => {
  if (allowedFields === true) {
    return typeof value === 'string' ? redact(value) : metadata(value);
  }
  if (Array.isArray(allowedFields)) {
    if (!Array.isArray(value)) throw new Error('Invalid CLI details.');
    return value.map((item) => pickPublicDetails(item, allowedFields[0]));
  }
  const source = object(value);
  return Object.fromEntries(Object.entries(allowedFields)
    .filter(([key]) => Object.hasOwn(source, key))
    .map(([key, nestedFields]) => [key, pickPublicDetails(source[key], nestedFields)]));
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
        && Number.isFinite(Number(expiry)) && Number(expiry) > Date.now() + MIN_TOKEN_VALIDITY_MS
      )),
      selection: {
        org: metadata(org.name), orgId: metadata(org.id), orgCode: metadata(org.code),
        project: metadata(project.title ?? project.name), projectId: metadata(project.id),
        workspace: metadata(workspace.name), workspaceId: metadata(workspace.id),
      },
      ...(includeDetails ? Object.fromEntries(
        Object.entries(PUBLIC_DETAIL_FIELDS)
          .filter(([key]) => Object.hasOwn(config, key))
          .map(([key, allowedFields]) => [key, pickPublicDetails(config[key], allowedFields)]),
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
