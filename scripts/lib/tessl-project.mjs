// The Tessl project of a plugin, which `tessl eval run` saves its runs to. The CLI takes it
// from the nearest tessl.json above the plugin: `{"name": "<workspace>/<project>"}` must name
// a project that exists, whose source is this repository and the plugin's folder.
//
// A plugin of ours without a tessl.json gets one in this checkout, never committed, named
// after its Tessl target (adobe/web: workspace adobe, project web). The project is looked up
// in that workspace and created when it isn't there, with the same name and source, so a new
// plugin needs nobody to set up Tessl. `tessl project create` can't do this: it first lists
// the projects of the whole organization, and this token gets a 404 there. The calls below
// are the workspace ones the CLI makes (CLI 0.122.0).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IMPORTED, isImported } from './imported.mjs';

const API = 'https://api.tessl.io';

// A plugin brought in from another repository, or one that holds such a copy (run-workflow):
// whether it is evaluated, and under which project, is for its owners.
export const notOurs = (dir) => isImported(dir) || IMPORTED.some(({ path }) => path.startsWith(`${dir}/`));

// "github.com/adobe/skills" from the URL of a remote, as the CLI names a git source.
export function sourceUri(remote) {
  const url = remote.trim().replace(/\.git$/, '');
  const scp = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(url);
  if (scp) return `${scp[1]}/${scp[2]}`;
  try {
    const { host, pathname } = new URL(url);
    const path = pathname.replace(/^\/+/, '');
    return host && path ? `${host}/${path}` : null;
  } catch {
    return null;
  }
}

export function originUri(root) {
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' });
  return remote.status === 0 ? sourceUri(remote.stdout) : null;
}

// Makes sure `dir` has a tessl.json that names an existing project. Resolves to
// { project, action } with action `own` (the plugin brings its tessl.json), `found` or
// `created`, or throws an Error that says what is missing. `dir` is relative to `root`, the
// root of the repository. `request(method, path, body)` resolves to { status, body }.
export async function ensureProject(dir, { request, source, root = '.' }) {
  const manifest = join(root, dir, 'tessl.json');
  if (existsSync(manifest)) return { project: JSON.parse(readFileSync(manifest, 'utf8')).name, action: 'own' };
  const project = JSON.parse(readFileSync(join(root, dir, '.tessl-plugin', 'plugin.json'), 'utf8')).name;
  const [workspaceName, name, ...rest] = String(project ?? '').split('/');
  if (!workspaceName || !name || rest.length > 0) throw new Error(`the Tessl name "${project}" is not <workspace>/<plugin>`);
  if (!source) throw new Error('the origin remote of this checkout names no repository');
  const repoSubpath = dir.replace(/^\.\//, '').replace(/\/+$/, '');

  const workspace = await request('GET', `/v1/workspaces/${encodeURIComponent(workspaceName)}`);
  if (workspace.status !== 200) throw new Error(`workspace ${workspaceName}: ${describe(workspace)}`);
  const workspaceId = workspace.body.data.id;

  const query = new URLSearchParams({ 'filter[workspaceId][eq]': workspaceId, 'filter[name][eq]': name });
  const listed = await request('GET', `/v1/projects?${query}`);
  if (listed.status !== 200) throw new Error(`looking up project ${project}: ${describe(listed)}`);
  const existing = listed.body.data.find((entry) => entry.attributes.name === name);
  let action = 'found';
  if (existing) {
    const { sourceType, sourceUri: uri, repoSubpath: path } = existing.attributes;
    if (sourceType !== 'git' || uri !== source || path !== repoSubpath) {
      throw new Error(`project ${project} exists with the source ${sourceType} ${uri} ${path || '(root)'}, not git ${source} ${repoSubpath}`);
    }
  } else {
    const created = await request('POST', '/v1/projects', { workspaceId, name, sourceType: 'git', sourceUri: source, repoSubpath });
    if (created.status !== 200 && created.status !== 201) throw new Error(`creating project ${project}: ${describe(created)}`);
    action = 'created';
  }
  writeFileSync(manifest, `${JSON.stringify({ name: project, mode: 'vendored', dependencies: {} }, null, 2)}\n`);
  return { project, action };
}

// What an answer of the API says, without anything of the request.
function describe({ status, body }) {
  const detail = body?.errors?.[0]?.detail ?? body?.errors?.[0]?.title ?? body?.error?.message ?? body?.message;
  return `HTTP ${status}${detail ? `, ${detail}` : ''}`;
}

// A request to the Tessl API with the token of the environment.
export function tesslApi(token, base = API) {
  return async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  };
}
