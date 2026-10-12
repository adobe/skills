// evals/harness-smoke/checks.mjs — the conformance checks: one prompt each, verified from the
// workspace on disk wherever possible (a model's own "done" is not evidence). Pure: no harness, no
// browser, no network — run.mjs drives these, test/checks.test.mjs tests them.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SKILLS = ['stardust', 'extract', 'direct', 'prototype', 'migrate', 'prepare-migration', 'replica', 'reskin', 'audit', 'uplift', 'diff', 'deploy', 'rollout', 'dynamics', 'qa', 'spec'];
export const VISION_TOKEN = ['KESTREL', '7351']; // painted into fixture/vision.png; never written into a workspace

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Skill names a model listed: strip bullets, backticks, `/`, `$`, `stardust:` / `skill:` prefixes. */
export function listedNames(text) {
  return new Set(String(text).split('\n').map((l) => l.trim().replace(/^[-*•\d.)\s]+/, '').replace(/[`*]/g, '').replace(/^[/$]/, '')
    .replace(/^(stardust|skill|impeccable):(?=[a-z])/, '').split(/\s+[—–:-]\s+|\s+\(/)[0].trim().toLowerCase()).filter(Boolean));
}

/** First `## ` heading of a SKILL.md, without the hashes. */
export const firstH2 = (md) => (String(md).match(/^## (.+)$/m) || [])[1]?.trim() || null;

const norm = (s) => String(s).toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The checks, in run order. `ws` is the workspace the prompt ran in; ctx = { harness, version,
 * skillsDir, siteUrl, out } (out: the model's final text). `verify` returns { pass, detail }.
 * `workspace: 'gate'` runs in its own workspace seeded with the direct-from-phrase fixture.
 */
export const CHECKS = [
  {
    id: 'listing',
    prompt: () => 'Do not run any tools. List the names of every skill available to you, one per line, and nothing else.',
    verify: (ws, { out }) => {
      const names = listedNames(out);
      const missing = [...SKILLS, 'impeccable'].filter((s) => !names.has(s));
      return { pass: !missing.length, detail: missing.length ? `missing: ${missing.join(' ')}` : 'all 16 stardust skills and impeccable listed' };
    },
  },
  {
    id: 'load',
    prompt: () => 'Load the stardust skill named `extract` (not impeccable\'s extract command) through your skill mechanism. Reply with the exact text of its first second-level heading (a line starting with `## `), and nothing else.',
    verify: (ws, { out, skillsDir }) => {
      const want = firstH2(read(join(skillsDir, 'extract', 'SKILL.md')));
      return { pass: !!want && norm(out).includes(norm(want)), detail: `expected "${want}"` };
    },
  },
  {
    id: 'setup',
    prompt: ({ harness }) => `Use the \`stardust\` skill and run its Setup section only, then stop. This is an unattended smoke test in an empty project: do not ask questions; a step that needs a site or prior state just reports it absent. When Setup runs the runtime preflight, run it as \`node stardust/scripts/stardust/runtime-preflight.mjs --harness ${harness} --json > stardust/.work/preflight.json\` (create the directory first). Finish with the line SMOKE_SETUP_DONE.`,
    verify: (ws, { version }) => {
      const v = read(join(ws, 'stardust', 'scripts', 'VERSION'))?.trim();
      const synced = existsSync(join(ws, 'stardust', 'scripts', 'diff', 'visual-diff.mjs'));
      const pf = readJson(join(ws, 'stardust', '.work', 'preflight.json'));
      const pass = v === version && synced && !!pf;
      return { pass, detail: `scripts VERSION ${v ?? 'missing'} (want ${version}), diff copy ${synced ? 'present' : 'missing'}, preflight.json ${pf ? 'written' : 'missing'}` };
    },
  },
  {
    id: 'runtime',
    prompt: null, // reads the preflight the setup check saved: what the harness's own shell could do
    verify: (ws) => {
      const pf = readJson(join(ws, 'stardust', '.work', 'preflight.json'));
      if (!pf) return { pass: false, detail: 'no stardust/.work/preflight.json (setup check failed)' };
      const by = Object.fromEntries(pf.results.map((r) => [r.check, r]));
      const bad = ['node', 'playwright', 'chromium', 'localhost', 'outbound'].filter((c) => by[c]?.status !== 'ok');
      return { pass: !bad.length, detail: bad.length ? bad.map((c) => `${c} ${by[c]?.status ?? 'absent'}${by[c]?.fix ? ` (fix: ${by[c].fix})` : ''}`).join('; ') : 'node, playwright, chromium, localhost, outbound all ok' };
    },
  },
  {
    id: 'capture',
    prompt: ({ siteUrl }) => `Run exactly this command from the project root, then reply with its exit code only: node stardust/scripts/extract/crawl.mjs --url ${siteUrl} --max 1 --out stardust/current`,
    verify: (ws) => {
      const dir = join(ws, 'stardust', 'current', 'assets', 'screenshots');
      const shots = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')) : [];
      return { pass: shots.length > 0, detail: shots.length ? `screenshots: ${shots.join(', ')}` : 'no screenshot under stardust/current/assets/screenshots/' };
    },
  },
  {
    id: 'vision',
    prompt: () => 'Look at the image file `smoke-vision.png` in the project root with your file or image reading tool. Reply with exactly the word and the number painted in it, and nothing else.',
    verify: (ws, { out }) => {
      const pass = VISION_TOKEN.every((t) => String(out).toUpperCase().includes(t));
      return { pass, detail: pass ? 'read the painted token' : `answer did not contain ${VISION_TOKEN.join(' ')}` };
    },
  },
  {
    id: 'gate',
    workspace: 'gate',
    prompt: () => 'Use the stardust skill: direct — make it more expressive for a young audience.',
    verify: (ws, { out }) => {
      const wrote = ['PRODUCT.md', 'DESIGN.md'].filter((f) => existsSync(join(ws, f)));
      const blocked = (read(join(ws, 'stardust', 'status.jsonl')) || '').split('\n').some((l) => /"event"\s*:\s*"blocked"/.test(l));
      const asked = /\?[*_"'”’)\]]*\s*(?:\n|$)/.test(String(out)); // a line ending in a question, markdown emphasis allowed
      const pass = !wrote.length && (blocked || asked);
      return { pass, detail: `${wrote.length ? `wrote ${wrote.join(', ')} without an answer` : 'no target files written'}; ${blocked ? 'blocked ledger line' : 'no blocked line'}; ${asked ? 'asked a question' : 'asked nothing'}` };
    },
  },
];

/** Golden path A: the core pipeline, hands-off, on the fixture site. */
export const GOLDEN_A = {
  id: 'golden-a',
  prompt: ({ siteUrl }) => `Use the stardust skill in hands-off mode (--hands-off). Extract ${siteUrl} (both pages), then direct "calm and editorial, for people who buy handmade things", then prototype the home page only, then run the diff skill's content diff between the captured home page and its prototype with --json saved to stardust/.work/diff.json. Do not deploy. Stop after the diff.`,
  verify: (ws) => {
    const pages = existsSync(join(ws, 'stardust', 'current', 'pages')) ? readdirSync(join(ws, 'stardust', 'current', 'pages')).filter((f) => f.endsWith('.json')) : [];
    const target = ['PRODUCT.md', 'DESIGN.md'].every((f) => existsSync(join(ws, f)));
    const protos = existsSync(join(ws, 'stardust', 'prototypes')) ? readdirSync(join(ws, 'stardust', 'prototypes')).filter((f) => /-proposed\.html$/.test(f)) : [];
    const diff = !!readJson(join(ws, 'stardust', '.work', 'diff.json'));
    const pass = pages.length >= 2 && target && protos.length > 0 && diff;
    return { pass, detail: `pages ${pages.length}/2, target spec ${target ? 'written' : 'missing'}, prototypes ${protos.length}, diff.json ${diff ? 'written' : 'missing'}` };
  },
};
