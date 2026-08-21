import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  access,
  rm,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const RUNNER_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const EVALS_DIR = dirname(RUNNER_DIR);
export const PLUGIN_DIR = dirname(EVALS_DIR); // plugins/stardust

export function evalDir(name) {
  return join(EVALS_DIR, name);
}

export function runDir(label, evalName, i) {
  return join(RUNNER_DIR, "results", label, evalName, `run-${i}`);
}

export async function loadEval(name) {
  const dir = evalDir(name);
  const criteria = JSON.parse(await readFile(join(dir, "criteria.json"), "utf8"));
  const taskMd = await readFile(join(dir, "task.md"), "utf8");
  const steps = extractUserPrompts(taskMd);
  let answers = null;
  try {
    answers = await readFile(join(dir, "answers.md"), "utf8");
  } catch {}
  return { name, dir, criteria, taskMd, steps, prompt: steps[0].prompt, answers };
}

// Each "## User prompt" / "## User prompt (run N — …)" section of task.md is
// one session prompt. Multi-step evals (the migrate family) list several;
// steps beyond the first often need manual workspace edits between runs, so
// the runner currently executes only step 1 (see README).
export function extractUserPrompts(taskMd) {
  const steps = [];
  const re = /^##\s*(User prompt[^\n]*)\n+([\s\S]*?)(?=^##\s|(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(taskMd)) !== null) {
    // Prompts are conventionally quoted or backticked; strip one layer.
    const prompt = m[2]
      .trim()
      .replace(/^"([\s\S]*)"$/, "$1")
      .replace(/^`([^`][\s\S]*)`$/, "$1");
    steps.push({ heading: m[1].trim(), prompt });
  }
  if (!steps.length) throw new Error("task.md has no '## User prompt' section");
  return steps;
}

// The SDK silently drops a plugin whose manifest "dependencies" reference a
// marketplace the session doesn't have (stardust depends on
// impeccable@impeccable, and hermetic sessions register no marketplaces).
// Stage the plugin in a temp dir with a stripped manifest and a COPY of
// skills/ — copying (not symlinking) pins the skill text for the whole
// invocation, so editing skills while runs execute can't feed sessions
// mixed versions.
export async function stagePlugin(srcDir) {
  const stage = await mkdtemp(join(tmpdir(), "eval-plugin-"));
  let manifest = { name: "stardust", version: "0.0.0-staged" };
  try {
    manifest = JSON.parse(
      await readFile(join(srcDir, ".claude-plugin/plugin.json"), "utf8")
    );
  } catch {}
  delete manifest.dependencies;
  await mkdir(join(stage, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(stage, ".claude-plugin/plugin.json"),
    JSON.stringify(manifest, null, 2)
  );
  await cp(join(srcDir, "skills"), join(stage, "skills"), { recursive: true });
  return {
    path: stage,
    name: manifest.name,
    cleanup: () => rm(stage, { recursive: true, force: true }),
  };
}

export async function materializeWorkspace(evalName, dest) {
  const workspace = join(dest, "workspace");
  await mkdir(workspace, { recursive: true });
  const fixture = join(evalDir(evalName), "fixture");
  try {
    await access(fixture);
    await cp(fixture, workspace, { recursive: true });
  } catch {
    // No fixture: from-scratch eval starts in an empty workspace.
  }
  return workspace;
}
