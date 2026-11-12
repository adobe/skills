import { access, readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { distinctSignatures, skillHeader, skillSignature } from './session.mjs';

const PLUGIN_MANIFEST = join('.tessl-plugin', 'plugin.json');

export async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function findPluginRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (await exists(join(dir, PLUGIN_MANIFEST))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function asList(value, fallback) {
  if (value === undefined || value === null) return [fallback];
  return Array.isArray(value) ? value : [value];
}

export async function readSkill(skillDir) {
  const text = await readFile(join(skillDir, 'SKILL.md'), 'utf8');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const name = fm?.[1].match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
  return { name: name ?? basename(skillDir), dir: skillDir, signature: skillSignature(text), header: skillHeader(text) };
}

export async function loadPlugin(root) {
  const manifest = JSON.parse(await readFile(join(root, PLUGIN_MANIFEST), 'utf8'));
  const skills = [];
  for (const entry of asList(manifest.skills, 'skills')) {
    const p = resolve(root, entry);
    if (await exists(join(p, 'SKILL.md'))) {
      skills.push(await readSkill(p));
    } else if (await isDir(p)) {
      for (const child of (await readdir(p)).sort()) {
        const c = join(p, child);
        if (await exists(join(c, 'SKILL.md'))) skills.push(await readSkill(c));
      }
    }
  }
  const rules = [];
  for (const entry of asList(manifest.rules, 'rules')) {
    const p = resolve(root, entry);
    if (await isDir(p)) {
      for (const f of (await readdir(p)).sort()) if (f.endsWith('.md')) rules.push(join(p, f));
    } else if (p.endsWith('.md') && (await exists(p))) {
      rules.push(p);
    }
  }
  const unsupported = [];
  if (manifest.mcpServers || (await exists(join(root, '.mcp.json')))) unsupported.push('mcpServers');
  if (manifest.hooks) unsupported.push('hooks');
  if (manifest.nativeHooks) unsupported.push('nativeHooks');
  return { root, name: manifest.name ?? basename(root), skills: distinctSignatures(skills), rules, unsupported };
}

export async function loadScenario(dir) {
  const taskPath = join(dir, 'task.md');
  const criteriaPath = join(dir, 'criteria.json');
  if (!(await exists(taskPath))) return null;
  if (!(await exists(criteriaPath))) throw new Error(`${dir}: missing criteria.json`);
  const criteria = JSON.parse(await readFile(criteriaPath, 'utf8'));
  if (criteria.type && criteria.type !== 'weighted_checklist') {
    throw new Error(`${dir}: unsupported criteria type ${criteria.type}`);
  }
  if (!Array.isArray(criteria.checklist) || criteria.checklist.length === 0) {
    throw new Error(`${dir}: criteria.json has no checklist`);
  }
  const scenarioJsonPath = join(dir, 'scenario.json');
  const config = (await exists(scenarioJsonPath)) ? JSON.parse(await readFile(scenarioJsonPath, 'utf8')) : {};
  return {
    name: basename(dir),
    dir,
    task: await readFile(taskPath, 'utf8'),
    criteria,
    config,
  };
}

async function scenariosIn(evalsDir) {
  if (!(await isDir(evalsDir))) return [];
  const out = [];
  for (const d of (await readdir(evalsDir)).sort()) {
    const p = join(evalsDir, d);
    if (!(await isDir(p))) continue;
    const s = await loadScenario(p);
    if (s) out.push(s);
  }
  return out;
}

export function matchesFilter(name, filters) {
  if (!filters?.length) return true;
  return filters.some((f) => {
    if (!f.includes('*')) return f === name;
    const re = new RegExp(`^${f.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return re.test(name);
  });
}

export async function resolveTargets(sources, { scenarioFilters = [] } = {}) {
  const byPlugin = new Map();
  for (const src of sources) {
    const abs = resolve(src);
    if (!(await exists(abs))) throw new Error(`Not found: ${src}`);
    const root = await findPluginRoot(abs);
    if (!root) throw new Error(`${src}: not inside a plugin (no ${PLUGIN_MANIFEST} found)`);
    if (!byPlugin.has(root)) byPlugin.set(root, { plugin: await loadPlugin(root), scenarios: new Map() });
    const target = byPlugin.get(root);
    let found;
    if (abs === root) found = await scenariosIn(join(root, 'evals'));
    else if (await exists(join(abs, 'task.md'))) found = [await loadScenario(abs)];
    else found = await scenariosIn(abs);
    for (const s of found) {
      if (matchesFilter(s.name, scenarioFilters)) target.scenarios.set(s.dir, s);
    }
  }
  const targets = [];
  for (const { plugin, scenarios } of byPlugin.values()) {
    if (scenarios.size) targets.push({ plugin, scenarios: [...scenarios.values()] });
  }
  return targets;
}
