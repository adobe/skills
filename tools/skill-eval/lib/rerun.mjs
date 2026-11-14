import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BASELINE, DEFAULT_VARIANT } from './contexts.mjs';
import { exists, readSkill } from './scenarios.mjs';
import { distinctSignatures, parseSessionFile } from './session.mjs';

export const slug = (s) => s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

export function positiveInt(value, flag) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} must be a positive integer`);
  return n;
}

export function modelList(values, fallback) {
  const models = [...new Set(values.flatMap((v) => v.split(',')).map((m) => m.trim()).filter(Boolean))];
  if (!models.length && (values.length || !fallback)) throw new Error('--model needs at least one model id');
  if (!models.length) return [fallback];
  const bySlug = new Map();
  for (const m of models) {
    const key = slug(m).toLowerCase();
    if (bySlug.has(key)) throw new Error(`--model ${bySlug.get(key)} and ${m} collide as dir name ${slug(m)}`);
    bySlug.set(key, m);
  }
  return models;
}

export function attemptDir(runDir, a) {
  const parts = [runDir, 'attempts', a.pluginSlug ?? slug(a.plugin), a.scenario];
  if (a.modelSlug) parts.push(a.modelSlug);
  return join(...parts, `${a.variant}-${a.run}`);
}

export function tagWorkerModels(attempts, fallback) {
  if (!fallback) return;
  for (const a of attempts) if (!a.model) a.model = fallback;
}

export function tagJudgeModels(attempts, fallback) {
  if (!fallback) return;
  for (const a of attempts) if (a.score && !a.score.judgeModel) a.score.judgeModel = fallback;
}

export function judgeLabel(attempts, fallback) {
  const models = new Set(attempts.filter((a) => a.score).map((a) => a.score.judgeModel ?? fallback));
  return models.size ? [...models].sort().join(', ') : fallback;
}

export function workerSucceeded(r) {
  if (r.status === 'ok') return true;
  return r.status === 'error' && /^judge\b/.test(r.error ?? '') && (r.turns ?? 0) > 0;
}

async function loadSkillsDir(dir) {
  const skills = [];
  for (const name of (await readdir(dir)).sort()) {
    if (await exists(join(dir, name, 'SKILL.md'))) skills.push(await readSkill(join(dir, name)));
  }
  return distinctSignatures(skills);
}

export async function loadRunSkills(runDir, meta = {}) {
  const out = Object.create(null);
  const root = join(runDir, 'context');
  if (!(await exists(root))) return out;
  const perVariant = Array.isArray(meta.contexts);
  for (const entry of (await readdir(root)).sort()) {
    if (!perVariant) {
      const dir = join(root, entry, 'skills');
      if (await exists(dir)) (out[DEFAULT_VARIANT] ??= Object.create(null))[entry] = await loadSkillsDir(dir);
      continue;
    }
    for (const plugin of (await readdir(join(root, entry))).sort()) {
      const dir = join(root, entry, plugin, 'skills');
      (out[entry] ??= Object.create(null))[plugin] = (await exists(dir)) ? await loadSkillsDir(dir) : [];
    }
  }
  return out;
}

export async function refreshAttempts(attempts, skillsByVariant, runDir) {
  const out = [];
  for (const a of attempts) {
    const dir = attemptDir(runDir, a);
    const sessionFile = join(dir, 'session.jsonl');
    if (!(await exists(sessionFile))) throw new Error(`missing ${sessionFile}`);
    const skills = a.variant === BASELINE ? [] : (skillsByVariant[a.variant]?.[a.pluginSlug ?? slug(a.plugin)] ?? []);
    const s = await parseSessionFile(sessionFile, { skills });
    out.push({
      ...a,
      dir,
      turns: s.turns,
      tokens: s.tokens,
      cost: s.cost,
      toolCalls: s.toolCalls.length,
      activatedSkills: s.activatedSkills,
      finalAnswer: s.finalAnswer,
    });
  }
  return out;
}
