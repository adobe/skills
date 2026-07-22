import { cp, mkdir, readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
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
