import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { findPluginRoot, loadPlugin } from './scenarios.mjs';

export const BASELINE = 'baseline';
export const DEFAULT_VARIANT = 'with-plugin';

const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function parseContextSpecs(specs) {
  const seen = new Map();
  const out = [];
  for (const spec of specs) {
    const i = spec.indexOf('=');
    if (i <= 0 || i === spec.length - 1) throw new Error(`--context ${spec}: expected <label>=<plugin-dir>`);
    const label = spec.slice(0, i);
    if (!LABEL.test(label)) throw new Error(`--context ${spec}: label may only use letters, digits, . _ -`);
    if (label.toLowerCase() === BASELINE) throw new Error(`--context ${spec}: "${BASELINE}" is reserved for the no-skills variant`);
    const key = label.toLowerCase();
    if (seen.has(key) && seen.get(key) !== label) throw new Error(`--context labels ${seen.get(key)} and ${label} differ only in case`);
    seen.set(key, label);
    out.push({ label, dir: resolve(spec.slice(i + 1)) });
  }
  return out;
}

async function loadContextPlugins(specs) {
  const byLabel = new Map();
  const cache = new Map();
  for (const { label, dir } of specs) {
    if ((await findPluginRoot(dir)) !== dir) throw new Error(`--context ${label}=${dir}: not a plugin root`);
    if (!cache.has(dir)) cache.set(dir, await loadPlugin(dir));
    const plugin = cache.get(dir);
    if (!byLabel.has(label)) byLabel.set(label, new Map());
    const plugins = byLabel.get(label);
    if (plugins.has(plugin.name)) throw new Error(`--context ${label} names plugin ${plugin.name} twice`);
    plugins.set(plugin.name, { ...plugin, skills: [...plugin.skills] });
  }
  return byLabel;
}

export async function gitInfo(dir) {
  const git = (...args) => promisify(execFile)('git', ['-C', dir, ...args]).then((r) => r.stdout.trim());
  try {
    const commit = await git('rev-parse', 'HEAD');
    const dirty = (await git('status', '--porcelain', '--', '.')) !== '';
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

export async function attachContexts(targets, specs, skillFilters = []) {
  const byLabel = await loadContextPlugins(specs);
  const variants = specs.length ? [...byLabel.keys()] : [DEFAULT_VARIANT];
  for (const t of targets) {
    t.contexts = Object.create(null);
    if (!specs.length) {
      t.contexts[DEFAULT_VARIANT] = t.plugin;
      continue;
    }
    for (const [label, plugins] of byLabel) {
      const p = plugins.get(t.plugin.name);
      if (!p) throw new Error(`--context ${label} has no plugin named ${t.plugin.name}`);
      t.contexts[label] = p;
    }
  }
  if (!skillFilters.length) return { targets, variants };

  const all = targets.flatMap((t) => Object.values(t.contexts));
  const known = new Set(all.flatMap((p) => p.skills.map((s) => s.name)));
  const missing = skillFilters.filter((s) => !known.has(s));
  if (missing.length) throw new Error(`Unknown skill(s): ${missing.join(', ')}`);
  const kept = [];
  for (const t of targets) {
    for (const p of Object.values(t.contexts)) p.skills = p.skills.filter((s) => skillFilters.includes(s.name));
    if (Object.values(t.contexts).some((p) => p.skills.length)) kept.push(t);
    else console.error(`warning: ${t.plugin.name} skipped, none of --skill ${skillFilters.join(', ')} belong to it`);
  }
  return { targets: kept, variants };
}
