// skills/reskin/scripts/figma-gate/io.mjs — paths and inputs shared by the figma-gate steps: the work
// dir of a page's gate run, the reskin inputs (a missing required file is a setup error naming its
// path), the included modules and the --confidential guard.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCurrent } from '../figma/cache.mjs';
import { UsageError } from '../figma/errors.mjs';
import { assertIgnored } from '../figma/guard.mjs';
import { readJson } from '../figma/io.mjs';

// A preview run has its own directory, so it never deletes or overwrites the evidence of a local run.
export const workDir = (dir, slug, regime = 'local') => join(dir, '.work', 'reskin', 'gates', slug, regime === 'preview' ? 'figma-preview' : 'figma');

// need names: mapping, contentModel, rules, donorTokens, checks (required when named), ledger (optional).
const FILES = {
  mapping: { rel: () => 'mapping.md', text: true },
  contentModel: { rel: (slug) => join('content-model', slug, 'content-model.json'), slug: true },
  rules: { rel: () => 'curation-rules.json' },
  donorTokens: { rel: () => 'donor-tokens.json' },
  checks: { rel: (slug) => join('figma-checks', `${slug}.json`), slug: true },
  ledger: { rel: () => 'ledger.json', optional: true },
};

export function readInputs(dir, slug, need) {
  const out = {};
  for (const name of need) {
    const spec = FILES[name];
    if (!spec) throw new Error(`readInputs: unknown input "${name}"`);
    if (spec.slug && !slug) throw new UsageError(`${name} is per page: pass --page <slug>`);
    const path = join(dir, 'reskin', spec.rel(slug));
    if (!existsSync(path)) {
      if (spec.optional) { out[name] = null; continue; }
      throw new UsageError(`missing ${path}`);
    }
    try {
      out[name] = spec.text ? readFileSync(path, 'utf8') : readJson(path);
    } catch (e) {
      throw new UsageError(`${path} is not valid JSON: ${e.message}`);
    }
  }
  return out;
}

export function includedModules(rules) {
  const modules = new Map();
  for (const m of rules?.modules || []) if (m.status === 'include' && m.id) modules.set(m.id, m.frame);
  return modules;
}

export function confidentialGuard(dir) {
  if (!readCurrent(dir)?.confidential) return false;
  assertIgnored([
    ['.work/reskin/gates/figma-boxes/probe.json', '.work/'],
    ['reskin/figma-checks/probe.json', 'reskin/figma-checks/'],
  ], { dir });
  return true;
}
